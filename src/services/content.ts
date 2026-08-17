import type {CoverageLedger,LearningContent,RoadGeometryCollection,RoadTopology,RoutingManifest,TerritoryContent} from '../domain/types'

const configuredBackendBaseUrl=
  import.meta.env.VITE_BACKEND_BASE_URL?.trim()||
  import.meta.env.VITE_OSRM_BASE_URL?.trim()
const backendBaseUrl=(
  configuredBackendBaseUrl||
  (import.meta.env.DEV?'':'https://glasgow-topographical-taxi-osrm.onrender.com')
).replace(/\/$/,'')
function hasSchemaVersion(value:unknown,schemaVersion:string){
  return typeof value==='object'&&value!==null&&
    'schema_version' in value&&value.schema_version===schemaVersion
}
async function load<T>(name:string,schemaVersion='1.0.0'){
  const localUrl=`/api/content/${name}`
  const backendUrl=backendBaseUrl?`${backendBaseUrl}/api/content/${name}`:''
  const candidates=[localUrl,...(backendUrl&&backendUrl!==localUrl?[backendUrl]:[])]
  let lastError:unknown
  for(const url of candidates){
    try{
      const response=await fetch(url)
      if(!response.ok)throw new Error(`Course content returned ${response.status}`)
      const value:unknown=await response.json()
      if(!hasSchemaVersion(value,schemaVersion))
        throw new Error(`Course content uses an unsupported schema version`)
      return value as T
    }catch(error){
      lastError=error
    }
  }
  const detail=lastError instanceof Error?`: ${lastError.message}`:''
  throw new Error(`Unable to load course content ${name}${detail}`)
}
let coreLearningDataPromise:ReturnType<typeof fetchCoreLearningData>|null=null
function fetchCoreLearningData(){
  return Promise.all([
    load<LearningContent>('learning-content.json'),
    load<CoverageLedger>('coverage-ledger.json','1.1.0'),
  ])
}
/** Critical startup payload, shared by startup preloading and the main app. */
export const loadCoreLearningData=()=>
  coreLearningDataPromise??=fetchCoreLearningData()

/** Supporting map and territory payloads, fetched after the first view is usable. */
export const loadSupportingLearningData=()=>Promise.all([
  load<RoadGeometryCollection>('referenced-roads.geojson'),
  load<TerritoryContent>('territories.json'),
  load<RoutingManifest>('routing-manifest.json'),
])

// Kept for callers outside the main app.
export const loadLearningData=async()=>{
  const [[content,ledger],[roads,territories,routing]]=await Promise.all([
    loadCoreLearningData(),loadSupportingLearningData(),
  ])
  return [content,ledger,roads,territories,routing] as const
}
export const loadRoadData=()=>Promise.all([
  load<RoadTopology>('road-topology.json'),
  load<RoadGeometryCollection>('road-network.geojson'),
])
export const loadRoadNetwork=()=>load<RoadGeometryCollection>('road-network.geojson')

export type CoordinateUpdateRequest={recordId:string;sectionCode:string;category:string;featureIndex:number;featureName:string;coordinates:[number,number]}
export async function saveFeatureCoordinates(update:CoordinateUpdateRequest){
  const response=await fetch('/api/coordinates',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(update)})
  const result=await response.json().catch(()=>({error:'The coordinate service returned an invalid response.'}))
  if(!response.ok)throw new Error(result.error||'Unable to save coordinates.')
  return result.update as CoordinateUpdateRequest&{previousCoordinates:[number,number]}
}
