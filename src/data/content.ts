import {z} from 'zod'
import type {CoverageLedger,LearningContent,RoadGeometryCollection,RoadTopology} from '../domain/types'
async function load<T>(url:string,schemaVersion='1.0.0'){const response=await fetch(url);if(!response.ok)throw new Error(`Unable to load ${url}`);const value=await response.json();z.object({schema_version:z.literal(schemaVersion)}).parse(value);return value as T}
export const loadLearningData=()=>Promise.all([load<LearningContent>('/data/learning-content.v1.json'),load<CoverageLedger>('/data/coverage-ledger.v1.json','1.1.0'),fetch('/data/referenced-roads.v1.geojson').then(r=>r.json())])
export const loadRoadData=()=>Promise.all([
  load<RoadTopology>('/data/road-topology.v1.json'),
  load<RoadGeometryCollection>('/data/road-network.v1.geojson'),
])
export const loadRoadNetwork=()=>load<RoadGeometryCollection>('/data/road-network.v1.geojson')

export type CoordinateUpdateRequest={recordId:string;sectionCode:string;category:string;featureIndex:number;featureName:string;coordinates:[number,number]}
export async function saveFeatureCoordinates(update:CoordinateUpdateRequest){
  const response=await fetch('/api/coordinates',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(update)})
  const result=await response.json().catch(()=>({error:'The coordinate service returned an invalid response.'}))
  if(!response.ok)throw new Error(result.error||'Unable to save coordinates.')
  return result.update as CoordinateUpdateRequest&{previousCoordinates:[number,number]}
}
