import {describe,expect,it} from 'vitest'
import {createSessionResult,indexLatestSectionResults,randomiseAssociations,sectionResultKey} from './session'
import type {Association} from './types'
const associations=Array.from({length:8},(_,record)=>['streets_to_category','category_to_streets'].map((kind,direction)=>({id:`${record}:${direction}`,record_id:String(record),section_code:'S',kind,direction:direction?'forward':'reverse',prompt:'',answer:'',required:true,scope:'record_set',parent_association_id:null,feature_index:null} as Association))).flat()
describe('section session order',()=>{it('keeps paired directions apart',()=>{const queue=randomiseAssociations(associations,()=>.3);for(let i=1;i<queue.length;i++)expect(queue[i].record_id).not.toBe(queue[i-1].record_id)});it('preserves every association exactly once',()=>{const queue=randomiseAssociations(associations,()=>.71);expect(new Set(queue.map(item=>item.id))).toEqual(new Set(associations.map(item=>item.id)))})})
describe('first-pass results',()=>{it('records score and mistakes independently from corrections',()=>{const result=createSessionResult({sessionId:'seed',sectionCode:'A',questionCount:8,correctCount:6,incorrectAssociationIds:['1:0','2:1'],completedAt:'2026-07-12T12:00:00.000Z'});expect(result).toMatchObject({scope:'section',section_code:'A',question_count:8,correct_count:6,percentage:75,incorrect_association_ids:['1:0','2:1']})});it('does not produce NaN for an empty course session',()=>{expect(createSessionResult({sessionId:'empty',sectionCode:null,questionCount:0,correctCount:0,incorrectAssociationIds:[]}).percentage).toBe(0)})})

describe('latest section score',()=>{
  it('replaces an earlier section percentage with the most recent completed quiz',()=>{
    const earlier=createSessionResult({sessionId:'earlier',sectionCode:'A',practiceDirection:'reverse',questionCount:10,correctCount:10,incorrectAssociationIds:[],completedAt:'2026-07-12T12:00:00.000Z'})
    const latest=createSessionResult({sessionId:'latest',sectionCode:'A',practiceDirection:'reverse',questionCount:10,correctCount:7,incorrectAssociationIds:['a','b','c'],completedAt:'2026-07-13T12:00:00.000Z'})
    expect(indexLatestSectionResults([latest,earlier]).get(sectionResultKey('A','reverse'))).toMatchObject({session_id:'latest',correct_count:7,question_count:10,percentage:70})
  })

  it('keeps section scores separate and ignores course sessions',()=>{
    const sectionA=createSessionResult({sessionId:'a',sectionCode:'A',practiceDirection:'reverse',questionCount:4,correctCount:3,incorrectAssociationIds:['a'],completedAt:'2026-07-13T12:00:00.000Z'})
    const sectionB=createSessionResult({sessionId:'b',sectionCode:'B',practiceDirection:'forward',questionCount:5,correctCount:4,incorrectAssociationIds:['b'],completedAt:'2026-07-13T13:00:00.000Z'})
    const course=createSessionResult({sessionId:'course',sectionCode:null,questionCount:20,correctCount:20,incorrectAssociationIds:[],completedAt:'2026-07-13T14:00:00.000Z'})
    const latest=indexLatestSectionResults([sectionA,sectionB,course])
    expect([...latest.keys()]).toEqual(['A:reverse','B:forward'])
  })

  it('stores a combined selection without replacing individual section scores',()=>{
    const sectionA=createSessionResult({sessionId:'a',sectionCode:'A',practiceDirection:'reverse',questionCount:4,correctCount:3,incorrectAssociationIds:['a']})
    const combined=createSessionResult({sessionId:'east',sectionCode:null,sectionCodes:['E','A','A'],selectionLabel:'East: district + main roads',questionCount:194,correctCount:170,incorrectAssociationIds:['x']})
    expect(combined).toMatchObject({scope:'section_set',section_code:null,section_codes:['A','E'],selection_label:'East: district + main roads'})
    expect(indexLatestSectionResults([sectionA,combined]).get(sectionResultKey('A','reverse'))?.session_id).toBe('a')
  })

  it('keeps recognition and recall scores separate',()=>{
    const recognition=createSessionResult({sessionId:'recognition',sectionCode:'A',practiceDirection:'reverse',questionCount:10,correctCount:9,incorrectAssociationIds:['a']})
    const recall=createSessionResult({sessionId:'recall',sectionCode:'A',practiceDirection:'forward',questionCount:10,correctCount:6,incorrectAssociationIds:['b']})
    const latest=indexLatestSectionResults([recognition,recall])
    expect(latest.get(sectionResultKey('A','reverse'))?.percentage).toBe(90)
    expect(latest.get(sectionResultKey('A','forward'))?.percentage).toBe(60)
  })
})
