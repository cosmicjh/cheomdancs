import {C} from '../../src/shared/core.js';
import {today} from '../../src/shared/backup.js';
const futureWeek=C.monday(C.addDays(today(),14));
export function synthetic(){return C.validateDataset({schema:1,meta:{label:'가상 검증 시간표'},slots:[0,1,2,3,4].flatMap(day=>[1,2,3].map(period=>({day,period}))),teachers:[{id:'a',name:'가교사'},{id:'b',name:'나교사'},{id:'c',name:'다교사'}],electives:[{grade:2,subject:'미적분',abbr:'미적분'},{grade:3,subject:'물리학Ⅱ',abbr:'물리Ⅱ'},{grade:3,subject:'중국 문화',abbr:'중문화'}],lessons:[{teacherId:'a',day:0,period:1,subject:'과학',room:'1-1'},{teacherId:'b',day:1,period:2,subject:'수학',room:'1-1'},{teacherId:'c',day:0,period:1,subject:'국어',room:'1-2'},{teacherId:'c',day:1,period:2,subject:'공강B',room:'스터디카'}]});}
export const rawPlan=(suffix='0123456789abcdef')=>({id:'p_'+suffix,version:0,teacherA:'a',reason:'출장',submitDate:'2026-11-02',submitter:'가교사',items:[{mode:'swap',dateA:futureWeek,periodA:1,teacherB:'b',dateB:C.addDays(futureWeek,1),periodB:2}]});
// Entirely generated, no school data. Matches legacy aggregate assertions so all 21 rules run publicly.
export function sourceShaped(){
 const slots=[0,1,2,3,4].flatMap(day=>Array.from({length:day===2?6:7},(_,n)=>({day,period:n+1})));
 const teachers=Array.from({length:64},(_,n)=>({id:'virtual_'+n,name:'가상교사'+String(n+1).padStart(2,'0')}));
 const lessons=Array.from({length:1149},(_,n)=>{const t=Math.floor(n/18),s=slots[(n%18+t*5)%34];return {teacherId:teachers[t].id,...s,subject:'가상과목',room:'3-1'};});
 let linked=0;for(const l of lessons){if(linked===12)break;if(l.blockId)continue;const next=lessons.find(x=>x.teacherId===l.teacherId&&x.day===l.day&&x.period===l.period+1&&!x.blockId);if(next){l.blockId=next.blockId='virtual_block_'+linked;linked+=2;}}
 const singles=lessons.filter(l=>!l.blockId);for(let n=0;n<21;n++)singles[n].subject='공강B';singles[21].subject=singles[22].subject='중문I';
 const electives=[{grade:3,subject:'중국 문화',abbr:'중문화'},...Array.from({length:53},(_,n)=>({grade:n%3+1,subject:'가상선택'+n,abbr:'가선'+n}))];
 return C.validateDataset({schema:1,meta:{label:'2026 가상자료',sourceYear:'2025',warnings:['시간표 내부 학년도(2025)와 파일명 학년도(2026)가 다릅니다.']},slots,teachers,lessons,electives});
}
