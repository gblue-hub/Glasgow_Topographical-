import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { bngToWgs84, readGpkgGeometry } from '../data/lib/spatial.mjs'

const root=path.resolve(import.meta.dirname,'..','..')
const buildRoot=path.join(root,'.content-build')
const out=path.join(buildRoot,'course-content')
await mkdir(out,{recursive:true})
await mkdir(path.join(buildRoot,'reports'),{recursive:true})
const canonicalText=await readFile(path.join(buildRoot,'canonical','canonical-records.json'),'utf8')
const sourceText=await readFile(path.join(root,'content-source','glasgow-taxis.json'),'utf8')
const canonical=JSON.parse(canonicalText)
if(canonical.schema_version!=='1.0.0')throw new Error(`Unsupported canonical schema ${canonical.schema_version}`)
const digest=value=>createHash('sha256').update(value).digest('hex')
const contentVersion=`glasgow-taxis:${digest(sourceText)}:canonical:${digest(canonicalText)}:ledger:1.1.0`

const associations=[]
const records=canonical.records.map(record=>{
 const features=(record.features||[]).map(feature=>{
  const roadLinkIds=feature.role==='middle_road'?(record.geometry_binding?.selectedCorridorLinkIds||record.geometry_binding?.displayComponentLinkIds||[]):[]
  return {index:feature.index,role:feature.role,exam_name:feature.exam_name,map_name:feature.map_name,postcode:feature.postcode,effective_coordinates:feature.effective_coordinates,road_link_id:feature.spatial_validation?.roadLinkId||null,road_link_ids:roadLinkIds,spatial_status:feature.spatial_validation?.status||'unknown'}
 })
 const answerFeatures=features.filter(feature=>record.type==='district'||!['place','middle_road'].includes(feature.role))
 const streetNames=answerFeatures.map(feature=>feature.exam_name)
 const reverseId=`${record.id}:streets-to-category`
 const forwardId=`${record.id}:category-to-streets`
 associations.push({id:reverseId,record_id:record.id,section_code:record.section.code,kind:'streets_to_category',direction:'reverse',prompt:streetNames.join(' | '),answer:record.exam_name,required:true,scope:'record_set',parent_association_id:null,feature_index:null})
 associations.push({id:forwardId,record_id:record.id,section_code:record.section.code,kind:'category_to_streets',direction:'forward',prompt:record.exam_name,answer:streetNames.join(' | '),required:true,scope:'record_set',parent_association_id:null,feature_index:null})
 for(const feature of answerFeatures){
  associations.push({id:`${forwardId}:feature:${feature.index}`,record_id:record.id,section_code:record.section.code,kind:'category_to_streets',direction:'forward',prompt:record.exam_name,answer:feature.exam_name,required:false,scope:'street',parent_association_id:forwardId,feature_index:feature.index})
 }
 return {id:record.id,type:record.type,section:record.section,exam_name:record.exam_name,review_state:record.review_state,features}
})

const referencedIds=new Set(records.flatMap(record=>record.features.flatMap(feature=>[feature.road_link_id,...(feature.road_link_ids||[])].filter(Boolean))))
const db=new DatabaseSync(path.join(root,'content-source','spatial','oproads_glasgow.gpkg'),{readOnly:true})
const roadRows=db.prepare('SELECT id,name_1,name_2,start_node,end_node,length,road_function,form_of_way,geom FROM glasgow_roads ORDER BY id').all()
const topology=[],geometry=[],networkGeometry=[]
for(const row of roadRows){
 const names=[row.name_1,row.name_2].filter(Boolean)
 topology.push({id:row.id,names,start_node:row.start_node,end_node:row.end_node,length_metres:row.length,road_function:row.road_function,form_of_way:row.form_of_way})
 {const line=readGpkgGeometry(row.geom);const feature={type:'Feature',id:row.id,properties:{road_link_id:row.id,names,start_node:row.start_node,end_node:row.end_node},geometry:{type:'LineString',coordinates:line.coordinates.map(([x,y])=>bngToWgs84({x,y}))}};networkGeometry.push(feature);if(referencedIds.has(row.id))geometry.push(feature)}
}
db.close()

const sections=[...new Map(records.map(record=>[record.section.code,record.section])).values()].map(section=>({...section,record_count:records.filter(record=>record.section.code===section.code).length,association_count:associations.filter(item=>item.section_code===section.code&&item.required).length}))
const areaByDistrictSection={A:'east',B:'north',C:'south',D:'west'}
const answerFeatures=record=>record.features.filter(feature=>record.type==='district'||!['place','middle_road'].includes(feature.role))
const recordPoint=record=>{
 const preferred=record.features.find(feature=>feature.role==='place'||feature.role==='middle_road')
 const values=preferred?[preferred]:answerFeatures(record)
 if(!values.length)return null
 return values.reduce((sum,feature)=>[sum[0]+feature.effective_coordinates[0]/values.length,sum[1]+feature.effective_coordinates[1]/values.length],[0,0])
}
const metresBetween=(left,right)=>{
 if(!left||!right)return Number.POSITIVE_INFINITY
 const latitude=((left[1]+right[1])/2)*Math.PI/180
 return Math.hypot((left[0]-right[0])*111320*Math.cos(latitude),(left[1]-right[1])*110540)
}
const polygonSide=(point,centre,competitor)=>(point[0]-centre[0])**2+(point[1]-centre[1])**2-((point[0]-competitor[0])**2+(point[1]-competitor[1])**2)
const clipPolygon=(polygon,centre,competitor)=>{
 const output=[]
 for(let index=0;index<polygon.length;index+=1){
  const start=polygon[index],end=polygon[(index+1)%polygon.length]
  const startSide=polygonSide(start,centre,competitor),endSide=polygonSide(end,centre,competitor)
  const startInside=startSide<=0,endInside=endSide<=0
  if(startInside)output.push(start)
  if(startInside===endInside)continue
  const position=startSide/(startSide-endSide)
  output.push([start[0]+(end[0]-start[0])*position,start[1]+(end[1]-start[1])*position])
 }
 return output
}
const buildPolygons=territories=>{
 const longitudes=territories.map(item=>item.centre[0]),latitudes=territories.map(item=>item.centre[1]),padding=.018
 const bounds=[[Math.min(...longitudes)-padding,Math.min(...latitudes)-padding],[Math.max(...longitudes)+padding,Math.min(...latitudes)-padding],[Math.max(...longitudes)+padding,Math.max(...latitudes)+padding],[Math.min(...longitudes)-padding,Math.max(...latitudes)+padding]]
 return new Map(territories.map(territory=>{
  let polygon=[...bounds]
  for(const competitor of territories){if(competitor.id!==territory.id)polygon=clipPolygon(polygon,territory.centre,competitor.centre)}
  return [territory.id,polygon]
 }))
}
const coordinateKey=point=>`${point[0].toFixed(7)}:${point[1].toFixed(7)}`
const pairKey=(left,right)=>[left,right].sort().join('|')
const districts=records.filter(record=>record.type==='district'&&areaByDistrictSection[record.section.code])
const places=records.filter(record=>record.type==='place')
const mainRoads=records.filter(record=>record.type==='middle_road')
const nearest=(origin,candidates,limit,maximum=Number.POSITIVE_INFINITY)=>candidates
 .map(record=>({record,distance:metresBetween(recordPoint(origin),recordPoint(record))}))
 .filter(item=>item.distance<=maximum)
 .sort((left,right)=>left.distance-right.distance||left.record.exam_name.localeCompare(right.record.exam_name,'en-GB'))
 .slice(0,limit)
 .map(item=>item.record)
let territories=districts.map(district=>{
 const nearby=nearest(district,places,12,2200)
 const approaches=nearest(district,mainRoads,6,3200)
 const neighbours=nearest(district,districts.filter(candidate=>candidate.id!==district.id),4,6500)
 const districtFeatures=answerFeatures(district)
 const targetRoadNames=[...new Set([...districtFeatures,...nearby.flatMap(answerFeatures)].map(feature=>feature.exam_name).concat(approaches.map(record=>record.exam_name)).filter(Boolean))]
 const targetRoadLinkIds=[...new Set([...districtFeatures,...nearby.flatMap(answerFeatures),...approaches.flatMap(record=>record.features)].flatMap(feature=>[feature.road_link_id,...(feature.road_link_ids||[])].filter(Boolean)))]
 return {
  id:`territory:${district.id}`,
  name:district.exam_name,
  area:areaByDistrictSection[district.section.code],
  district_record_id:district.id,
  centre:recordPoint(district),
  associated_road_names:districtFeatures.map(feature=>feature.exam_name),
  associated_road_link_ids:districtFeatures.flatMap(feature=>[feature.road_link_id,...(feature.road_link_ids||[])].filter(Boolean)),
  nearby_record_ids:nearby.map(record=>record.id),
  approach_record_ids:approaches.map(record=>record.id),
  neighbouring_territory_ids:neighbours.map(record=>`territory:${record.id}`),
  target_road_names:targetRoadNames,
  target_road_link_ids:targetRoadLinkIds,
  checkpoint_target_percentage:80
 }
})
const polygons=buildPolygons(territories)
territories=territories.map(territory=>({...territory,polygon:polygons.get(territory.id)}))
const touchingPairs=new Map()
for(let leftIndex=0;leftIndex<territories.length;leftIndex+=1){
 const left=territories[leftIndex],leftVertices=new Set(left.polygon.map(coordinateKey))
 for(let rightIndex=leftIndex+1;rightIndex<territories.length;rightIndex+=1){
  const right=territories[rightIndex]
  const shared=right.polygon.filter(point=>leftVertices.has(coordinateKey(point)))
  if(new Set(shared.map(coordinateKey)).size>=2)touchingPairs.set(pairKey(left.id,right.id),{territory_ids:[left.id,right.id],shared_boundary:shared})
 }
}
const nearestTerritoryId=point=>{
 let winner=territories[0],distance=Number.POSITIVE_INFINITY
 for(const territory of territories){const next=metresBetween(point,territory.centre);if(next<distance){winner=territory;distance=next}}
 return winner.id
}
const stitchCandidates=new Map([...touchingPairs.keys()].map(key=>[key,[]]))
const topologyById=new Map(topology.map(link=>[link.id,link]))
const featureById=new Map(networkGeometry.map(feature=>[feature.id,feature]))
const roadIdentity=name=>name.toLocaleLowerCase('en-GB').replace(/[^a-z0-9]/g,'')
const linkTerritory=new Map()
for(const feature of networkGeometry){
 if(!feature.properties.names.length)continue
 const centre=feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length/2)]
 linkTerritory.set(feature.id,nearestTerritoryId(centre))
 const visited=[...new Set(feature.geometry.coordinates.map(nearestTerritoryId))]
 for(let leftIndex=0;leftIndex<visited.length;leftIndex+=1)for(let rightIndex=leftIndex+1;rightIndex<visited.length;rightIndex+=1){
  const key=pairKey(visited[leftIndex],visited[rightIndex])
  if(stitchCandidates.has(key))stitchCandidates.get(key).push({connection_kind:'crossing_road',road_names:[feature.properties.names[0]],road_link_ids:[feature.id],entry_road_names:Object.fromEntries(visited.map(id=>[id,feature.properties.names[0]])),crossing_coordinate:centre,same_name:true,score:topologyById.get(feature.id)?.length_metres??99999})
 }
}
const linksByNode=new Map()
for(const link of topology){
 if(!link.names.length||!linkTerritory.has(link.id))continue
 for(const node of [link.start_node,link.end_node])linksByNode.set(node,[...(linksByNode.get(node)||[]),link])
}
for(const [node,links] of linksByNode){
 for(let leftIndex=0;leftIndex<links.length;leftIndex+=1)for(let rightIndex=leftIndex+1;rightIndex<links.length;rightIndex+=1){
  const left=links[leftIndex],right=links[rightIndex],leftTerritory=linkTerritory.get(left.id),rightTerritory=linkTerritory.get(right.id)
  if(leftTerritory===rightTerritory)continue
  const key=pairKey(leftTerritory,rightTerritory)
  if(!stitchCandidates.has(key))continue
  const leftName=left.names[0],rightName=right.names[0],sameName=roadIdentity(leftName)===roadIdentity(rightName)
  const leftFeature=featureById.get(left.id),nodeCoordinate=left.start_node===node?leftFeature.geometry.coordinates[0]:leftFeature.geometry.coordinates.at(-1)
  stitchCandidates.get(key).push({connection_kind:'road_junction',road_names:[...new Set([leftName,rightName])],road_link_ids:[left.id,right.id],entry_road_names:{[leftTerritory]:leftName,[rightTerritory]:rightName},crossing_coordinate:nodeCoordinate,same_name:sameName,score:(sameName?0:10000)+left.length_metres+right.length_metres})
 }
}
const namedLinksByTerritory=new Map(territories.map(territory=>[territory.id,networkGeometry.filter(feature=>feature.properties.names.length&&linkTerritory.get(feature.id)===territory.id)]))
for(const [key,touch] of touchingPairs){
 if(stitchCandidates.get(key).length)continue
 const boundaryCentre=touch.shared_boundary.reduce((sum,point)=>[sum[0]+point[0]/touch.shared_boundary.length,sum[1]+point[1]/touch.shared_boundary.length],[0,0])
 const approaches=touch.territory_ids.map(territoryId=>namedLinksByTerritory.get(territoryId).map(feature=>({feature,distance:Math.min(...feature.geometry.coordinates.map(point=>metresBetween(point,boundaryCentre)))})).sort((left,right)=>left.distance-right.distance)[0])
 if(approaches.some(item=>!item))continue
 const roadNames=approaches.map(item=>item.feature.properties.names[0]),roadLinkIds=approaches.map(item=>item.feature.id)
 stitchCandidates.get(key).push({connection_kind:'paired_approach',road_names:[...new Set(roadNames)],road_link_ids:roadLinkIds,entry_road_names:Object.fromEntries(touch.territory_ids.map((id,index)=>[id,roadNames[index]])),crossing_coordinate:boundaryCentre,same_name:roadIdentity(roadNames[0])===roadIdentity(roadNames[1]),score:1000000+approaches.reduce((sum,item)=>sum+item.distance,0)})
}
const stitches=[]
for(const [key,touch] of touchingPairs){
 const candidates=stitchCandidates.get(key).sort((left,right)=>left.score-right.score||left.road_names.join('|').localeCompare(right.road_names.join('|'),'en-GB'))
 const selected=candidates[0]
 if(!selected)continue
 const roadName=selected.road_names.join(' → ')
 stitches.push({id:`stitch:${key.replace('|',':')}`,territory_ids:touch.territory_ids,connection_kind:selected.connection_kind,road_name:roadName,road_names:selected.road_names,entry_road_names:selected.entry_road_names,road_link_ids:selected.road_link_ids,crossing_coordinate:selected.crossing_coordinate,shared_boundary:touch.shared_boundary})
}
const stitchedByTerritory=new Map(territories.map(territory=>[territory.id,stitches.filter(stitch=>stitch.territory_ids.includes(territory.id))]))
territories=territories.map(territory=>{
 const territoryStitches=stitchedByTerritory.get(territory.id)
 return {...territory,
  neighbouring_territory_ids:territoryStitches.map(stitch=>stitch.territory_ids.find(id=>id!==territory.id)),
  stitch_ids:territoryStitches.map(stitch=>stitch.id),
  stitch_road_names:[...new Set(territoryStitches.flatMap(stitch=>stitch.road_names))],
  stitch_road_link_ids:[...new Set(territoryStitches.flatMap(stitch=>stitch.road_link_ids))],
  target_road_names:[...new Set([...territory.target_road_names,...territoryStitches.flatMap(stitch=>stitch.road_names)])],
  target_road_link_ids:[...new Set([...territory.target_road_link_ids,...territoryStitches.flatMap(stitch=>stitch.road_link_ids)])]
 }
})
const missingStitchPairs=[...touchingPairs].filter(([,pair])=>!stitches.some(stitch=>stitch.territory_ids[0]===pair.territory_ids[0]&&stitch.territory_ids[1]===pair.territory_ids[1])).map(([,pair])=>pair.territory_ids)
if(missingStitchPairs.length)throw new Error(`Territory build left ${missingStitchPairs.length} touching district pairs without learned stitch roads.`)
for(const stitch of stitches)for(const linkId of stitch.road_link_ids){if(!geometry.some(feature=>feature.id===linkId)){const feature=networkGeometry.find(item=>item.id===linkId);if(feature)geometry.push(feature)}}
const routingManifest={schema_version:'1.0.0',routing_version:`osrm:scotland-2026-07-24:car-v5.27.1:${digest(await readFile(path.join(root,'server','osrm','glasgow-taxi-area.osm.pbf')))}`,profile:'car',source_snapshot:'2026-07-24'}
const report={schema_version:'1.0.0',content_version:contentVersion,coverage_ledger_schema_version:'1.1.0',record_count:records.length,required_association_count:associations.filter(item=>item.required).length,atomic_remediation_association_count:associations.filter(item=>item.scope==='street').length,association_count:associations.length,section_count:sections.length,topology_link_count:topology.length,referenced_geometry_count:geometry.length,network_geometry_count:networkGeometry.length,territory_touching_pair_count:touchingPairs.size,territory_stitch_count:stitches.length,territory_pairs_without_stitch:missingStitchPairs,records_without_associations:records.filter(record=>!associations.some(item=>item.record_id===record.id)).map(record=>record.id)}
await Promise.all([
 writeFile(path.join(out,'learning-content.json'),JSON.stringify({schema_version:'1.0.0',content_version:contentVersion,sections,records})),
 writeFile(path.join(out,'coverage-ledger.json'),JSON.stringify({schema_version:'1.1.0',content_version:contentVersion,associations})),
 writeFile(path.join(out,'road-topology.json'),JSON.stringify({schema_version:'1.0.0',links:topology})),
 writeFile(path.join(out,'referenced-roads.geojson'),JSON.stringify({type:'FeatureCollection',schema_version:'1.0.0',features:geometry})),
 writeFile(path.join(out,'road-network.geojson'),JSON.stringify({type:'FeatureCollection',schema_version:'1.0.0',features:networkGeometry})),
 writeFile(path.join(out,'territories.json'),JSON.stringify({schema_version:'1.0.0',content_version:contentVersion,territories,stitches})),
 writeFile(path.join(out,'routing-manifest.json'),JSON.stringify(routingManifest)),
 writeFile(path.join(buildRoot,'reports','app-content-coverage.json'),JSON.stringify(report,null,2))
])
console.log(report)
