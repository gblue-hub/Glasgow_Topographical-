import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { bngToWgs84, readGpkgGeometry } from '../data/lib/spatial.mjs'

const root=path.resolve(import.meta.dirname,'..','..')
const out=path.join(root,'public','data')
await mkdir(out,{recursive:true})
const canonicalText=await readFile(path.join(root,'data','generated','canonical-records.v1.json'),'utf8')
const sourceText=await readFile(path.join(root,'data','source','glasgow-taxis.json'),'utf8')
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
const db=new DatabaseSync(path.join(root,'data','source','spatial','oproads_glasgow.gpkg'),{readOnly:true})
const roadRows=db.prepare('SELECT id,name_1,name_2,start_node,end_node,length,road_function,form_of_way,geom FROM glasgow_roads ORDER BY id').all()
const topology=[],geometry=[],networkGeometry=[]
for(const row of roadRows){
 const names=[row.name_1,row.name_2].filter(Boolean)
 topology.push({id:row.id,names,start_node:row.start_node,end_node:row.end_node,length_metres:row.length,road_function:row.road_function,form_of_way:row.form_of_way})
 {const line=readGpkgGeometry(row.geom);const feature={type:'Feature',id:row.id,properties:{road_link_id:row.id,names,start_node:row.start_node,end_node:row.end_node},geometry:{type:'LineString',coordinates:line.coordinates.map(([x,y])=>bngToWgs84({x,y}))}};networkGeometry.push(feature);if(referencedIds.has(row.id))geometry.push(feature)}
}
db.close()

const sections=[...new Map(records.map(record=>[record.section.code,record.section])).values()].map(section=>({...section,record_count:records.filter(record=>record.section.code===section.code).length,association_count:associations.filter(item=>item.section_code===section.code&&item.required).length}))
const report={schema_version:'1.0.0',content_version:contentVersion,coverage_ledger_schema_version:'1.1.0',record_count:records.length,required_association_count:associations.filter(item=>item.required).length,atomic_remediation_association_count:associations.filter(item=>item.scope==='street').length,association_count:associations.length,section_count:sections.length,topology_link_count:topology.length,referenced_geometry_count:geometry.length,network_geometry_count:networkGeometry.length,records_without_associations:records.filter(record=>!associations.some(item=>item.record_id===record.id)).map(record=>record.id)}
await Promise.all([
 writeFile(path.join(out,'learning-content.v1.json'),JSON.stringify({schema_version:'1.0.0',content_version:contentVersion,sections,records})),
 writeFile(path.join(out,'coverage-ledger.v1.json'),JSON.stringify({schema_version:'1.1.0',content_version:contentVersion,associations})),
 writeFile(path.join(out,'road-topology.v1.json'),JSON.stringify({schema_version:'1.0.0',links:topology})),
 writeFile(path.join(out,'referenced-roads.v1.geojson'),JSON.stringify({type:'FeatureCollection',schema_version:'1.0.0',features:geometry})),
 writeFile(path.join(out,'road-network.v1.geojson'),JSON.stringify({type:'FeatureCollection',schema_version:'1.0.0',features:networkGeometry})),
 writeFile(path.join(root,'data','reports','app-content-coverage.v1.json'),JSON.stringify(report,null,2))
])
console.log(report)
