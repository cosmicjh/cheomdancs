import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {C} from '../src/shared/core.js';
import {today} from '../src/shared/backup.js';
import {inputHash} from './data.mjs';
const root=resolve(import.meta.dirname,'..'),[requestedURL,...flags]=process.argv.slice(2);
const context=JSON.parse(await readFile(resolve(root,'private-data/deployment-context.local.json'),'utf8'));
const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
const url=String(requestedURL||context.url).replace(/\/$/,'');
assert.equal(url,context.url,'Refusing to send credentials to an unverified URL');
assert.equal(config.name,context.worker);assert.equal(config.d1_databases[0].database_id,context.databaseId);
assert(new URL(url).protocol==='https:');assert(flags.every(f=>f==='--exercise'));
const exercise=flags.includes('--exercise'),passwords=JSON.parse(await readFile(resolve(root,'private-data/production-bootstrap.local.json'),'utf8'));
async function transport(input,init={}){for(let attempt=0;;attempt++){try{return await fetch(input,init);}catch(error){const action=init.body?JSON.parse(init.body).action:'';const safe=!init.method||['login','load','resume','exportBackup','logout'].includes(action);if(!safe||attempt>=2)throw error;await new Promise(r=>setTimeout(r,350*(attempt+1)));}}}
const observations=[],sessions=[],prefix='p_check_'+randomBytes(8).toString('hex')+'_';let baseline,started=false,failure;
function check(condition,label){assert(condition,label);observations.push({check:label,passed:true});console.log('PASS '+label);}
async function api(action,payload={},cookie='',extra={}){
 const start=performance.now(),response=await transport(url+'/api',{method:'POST',headers:{Origin:url,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify({action,payload})});
 let value;try{value=await response.json();}catch{throw Error(action+' returned non-JSON HTTP '+response.status);}
 return {status:response.status,headers:response.headers,elapsed:Math.round(performance.now()-start),...value};
}
async function login(role){const result=await api('login',{role,password:passwords[role==='admin'?'INITIAL_ADMIN_PASSWORD':'INITIAL_TEACHER_PASSWORD']});assert.equal(result.status,200,role+' login status '+result.status);assert(result.ok,role+' login failed');const cookie=result.headers.get('Set-Cookie');assert(cookie&&/HttpOnly/i.test(cookie)&&/Secure/i.test(cookie)&&/SameSite=Strict/i.test(cookie));assert(!('token' in result.data));sessions.push(cookie.split(';')[0]);observations.push({check:role+' login and secure cookie',passed:true,wallMs:result.elapsed});return {cookie:cookie.split(';')[0],data:result.data};}
function candidate(ds,mode,id){const week=C.monday(C.addDays(today(),7));for(const lesson of ds.lessons){if(C.kind(ds,lesson)!=='regular'||!lesson.room)continue;const dateA=C.addDays(week,lesson.day),args={teacherA:lesson.teacherId,dateA,periodA:lesson.period,mode,weekB:week};const c=C.findCandidates(ds,[],args)[0];if(!c)continue;const choice=c.choices[0];return {id,version:0,teacherA:lesson.teacherId,reason:'Cloudflare 실행 검증',submitter:'Cloudflare 실행 검증',submitDate:today(),items:[{mode,dateA,periodA:lesson.period,teacherB:c.teacherId,dateB:choice.date,periodB:choice.period,roomA:lesson.room}]};}throw Error('No valid '+mode+' test candidate');}
let admin,teacher;
try{
 const page=await transport(url);check(page.status===200,'public UI 200');const html=await page.text();check(html.includes('Pretendard Variable')&&!/google\.script\.run|__CORE_RUNTIME__/.test(html),'official Pretendard and no legacy runtime');
 const health=await transport(url+'/api/health');check(health.ok&&(await health.json()).data.service==='class-swap','health endpoint');
 for(const pathname of ['/api/no-such-route','/api/missing.html']){const r=await transport(url+pathname);const body=await r.json();check(r.status===404&&body.ok===false&&/json/i.test(r.headers.get('Content-Type')||''),'JSON 404 '+pathname);}
 for(const pathname of ['/legacy/private-data/initial-data.json','/.dev.vars','/src/worker.js','/wrangler.jsonc']){const r=await transport(url+pathname);await r.arrayBuffer();check(r.status===404,'private route excluded '+pathname);}
 const denied=await api('load');check(denied.status===401,'anonymous data denied');
 teacher=await login('teacher');admin=await login('admin');
 check(!teacher.data.dataset.teachers.some(t=>html.includes(t.name)),'no teacher names in anonymous HTML');
 check((await api('exportBackup',{},teacher.cookie)).status===403,'teacher admin API forbidden');
 check((await api('load',{},teacher.cookie,{Origin:'https://invalid.example'})).status===403,'CSRF origin rejected');
 const loaded=await api('load',{},admin.cookie);check(loaded.status===200&&loaded.headers.get('Cache-Control')==='no-store','authenticated no-store snapshot');
 check(inputHash({dataset:loaded.data.dataset,plans:[]})===context.datasetHash,'remote dataset hash matches private input');
 const resumed=await api('resume',{dataRev:loaded.data.dataRev,planRev:loaded.data.planRev},teacher.cookie);check(resumed.status===200&&resumed.data.dataset===null&&resumed.data.plans===null,'session resume and conditional snapshot');
 const exported=await api('exportBackup',{},admin.cookie);check(exported.status===200&&exported.data.type==='class-swap-backup','backup export');
 baseline={type:'class-swap-backup',schema:1,dataset:loaded.data.dataset,plans:loaded.data.plans};
 if(exercise){
  assert(context.newDedicatedDatabase===true,'Write exercise requires a newly created dedicated DB');assert.equal(baseline.plans.length,0,'Refusing write exercise against existing plans');
  started=true;const first=candidate(baseline.dataset,'swap',prefix+'a'),second={...first,id:prefix+'b'};
  const save=p=>api('savePlan',{plan:p,dataRev:loaded.data.dataRev},teacher.cookie);
  const created=await Promise.all([save(first),save(second)]);check(JSON.stringify(created.map(r=>r.status).sort())==='[200,409]','remote concurrent reservation: one 200 and one 409');
  let plan=created.find(r=>r.ok).data.plan;const raw=plan.id===first.id?first:second;
  const retried=await save(raw);check(retried.status===200&&retried.data.plan.version===1,'remote create retry is idempotent');
  const edits=await Promise.all([save({...plan,reason:'Cloudflare 실행 검증 A'}),save({...plan,reason:'Cloudflare 실행 검증 B'})]);check(JSON.stringify(edits.map(r=>r.status).sort())==='[200,409]','remote concurrent same-version edit');plan=edits.find(r=>r.ok).data.plan;
  check((await api('cancelPlan',{id:plan.id,version:1},teacher.cookie)).status===409,'remote stale cancel rejected');
  const cancelled=await api('cancelPlan',{id:plan.id,version:plan.version},teacher.cookie);check(cancelled.status===200&&cancelled.data.plan.status==='cancelled','remote cancel keeps history');
  const cover=candidate(baseline.dataset,'cover',prefix+'cover');check((await save(cover)).status===200,'remote cover save after reservation release');
  const after=await api('load',{},admin.cookie);check(after.data.plans.length===2&&after.data.plans.filter(p=>p.status==='cancelled').length===1&&C.reservations(after.data.plans).size===2,'remote saved plans, cancellation history and reservations');
 }
}catch(error){failure=error;}
finally{
 if(started&&baseline&&admin){try{
  const current=await api('load',{},admin.cookie);assert.equal(current.status,200);assert(current.data.plans.every(p=>p.id.startsWith(prefix)),'Unknown user plan found; refusing cleanup');assert.equal(inputHash({dataset:current.data.dataset,plans:[]}),context.datasetHash,'Dataset changed; refusing cleanup');
  const restored=await api('restoreBackup',{backup:baseline,dataRev:current.data.dataRev,planRev:current.data.planRev},admin.cookie);assert.equal(restored.status,200,'Revision-guarded cleanup failed');check(restored.data.plans.length===0,'temporary marked plans removed; initial dataset retained');
 }catch(error){failure??=error;observations.push({check:'safe temporary-plan cleanup',passed:false});}}
 for(const cookie of sessions){try{const r=await api('logout',{},cookie);if(r.status!==200)throw Error('logout');}catch{failure??=Error('Test-session logout failed');}}
 await mkdir(resolve(root,'test-results'),{recursive:true});const summary={url,branch:context.branch,sourceCommit:context.sourceCommit,exercise,success:!failure,checks:observations,error:failure?.message};await writeFile(resolve(root,'test-results/remote.json'),JSON.stringify(summary,null,2)+'\n');
}
if(failure){console.error('Remote validation failed: '+failure.message);process.exitCode=1;}else console.log('REMOTE VALIDATION PASSED ('+observations.length+' checks).');
