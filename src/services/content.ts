import {z} from 'zod'
import type {CoverageLedger,LearningContent,RoadGeometryCollection,RoadTopology,RoutingManifest,TerritoryContent} from '../domain/types'

const configuredBackendBaseUrl=
  import.meta.env.VITE_BACKEND_BASE_URL?.trim()||
  import.meta.env.VITE_OSRM_BASE_URL?.trim()
const backendBaseUrl=(
  configuredBackendBaseUrl||
  (import.meta.env.DEV?'':'https://glasgow-topographical-taxi-osrm.onrender.com')
).replace(/\/$/,'')
async function load<T>(name:string,schemaVersion='1.0.0'){
  const response=await fetch(`${backendBaseUrl}/api/content/${name}`)
  if(!response.ok)throw new Error(`Unable to load backend course content ${name}`)
  const value=await response.json()
  z.object({schema_version:z.literal(schemaVersion)}).parse(value)
  return value as T
}
export const loadLearningData=()=>Promise.all([load<LearningContent>('learning-content.json'),load<CoverageLedger>('coverage-ledger.json','1.1.0'),load<RoadGeometryCollection>('referenced-roads.geojson'),load<TerritoryContent>('territories.json'),load<RoutingManifest>('routing-manifest.json')])
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
