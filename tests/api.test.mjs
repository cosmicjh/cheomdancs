import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {synthetic,rawPlan} from './fixtures/data.js';
import {C} from '../src/shared/core.js';
import {importSQL,inputHash} from '../scripts/data.mjs';
import {validateInput} from '../src/shared/backup.js';
const check=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r));return r.data;};
async function fixture(fn){const h=await harness();try{await fn(h,await h.setup());}finally{await h.close();}}
const save=(h,ctx,p=rawPlan())=>h.api('savePlan',{plan:p,dataRev:ctx.rev},ctx.teacher);
test('authentication: anonymous load/save/restore and role spoofing are blocked',()=>fixture(async(h,c)=>{
 for(const action of ['load','savePlan','restoreBackup'])check(await h.api(action,{role:'admin'}),401);
 for(const action of ['replaceData','exportBackup','restoreBackup','setPassword'])check(await h.api(action,{role:'admin'},c.teacher),403);
}));
test('login/bootstrap, conditional snapshots, resume, logout, cookie protections',()=>fixture(async(h,c)=>{
 check(await h.api('login',{role:'admin',password:'bad-password'}),401);
 const r=await h.login('teacher');assert.match(r.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict/);assert(!('token' in r.data));assert.equal(r.data.dataset.teachers.length,3);
 const known=check(await h.api('load',{dataRev:c.rev,planRev:r.data.planRev},r.cookie));assert.equal(known.dataset,null);assert.equal(known.plans,null);
 assert.equal(check(await h.api('resume',{},r.cookie)).role,'teacher');check(await h.api('logout',{},r.cookie));check(await h.api('load',{},r.cookie),401);
 const https=await h.mf.dispatchFetch('https://example.com/api',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({action:'login',payload:{role:'teacher',password:'1234'}})});assert.match(https.headers.get('Set-Cookie'),/; Secure/);
}));
test('CSRF, malformed requests, size limit, API 404 and sensitive error filtering',()=>fixture(async(h,c)=>{
 check(await h.api('load',{},c.teacher,{Origin:'https://elsewhere.test'}),403);
 check(await h.api('load',{},c.teacher,{'Content-Type':'text/plain'}),400);
 check(await h.api('missing',{},c.teacher),404);
 for(const pathname of ['/api/missing','/api/no.html']){const r=await h.mf.dispatchFetch('http://localhost'+pathname);assert.equal(r.status,404);assert.match(r.headers.get('Content-Type'),/json/);}
 const bad=await h.mf.dispatchFetch('http://localhost/api',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:'{'});assert.equal(bad.status,400);
 const big=await h.mf.dispatchFetch('http://localhost/api',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:' '.repeat(8*1024*1024+1)});assert.equal(big.status,413);
 assert.equal((await h.api('load',{},c.teacher)).headers.get('Cache-Control'),'no-store');
}));
test('save derives snapshots, create retry is idempotent, different content conflicts',()=>fixture(async(h,c)=>{
 const raw=rawPlan();raw.items[0].subjectA='spoof';raw.items[0].teacherBName='spoof';
 const result=check(await save(h,c,raw)),before=await h.state();assert.equal(result.plan.items[0].subjectA,'과학');assert.equal(result.plan.items[0].teacherBName,'나교사');assert.equal(before.reservations.length,4);
 assert.equal(check(await save(h,c,raw)).plan.version,1);assert.deepEqual(await h.state(),before);
 raw.reason='different';check(await save(h,c,raw),409);assert.deepEqual(await h.state(),before);
}));
test('concurrent competing plan IDs: exactly one success, one 409, one revision increment',()=>fixture(async(h,c)=>{
 const before=await h.state(),results=await Promise.all([save(h,c,rawPlan('concurrent_id_0001')),save(h,c,rawPlan('concurrent_id_0002'))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const after=await h.state();assert.equal(after.plans.length,1);assert.equal(after.reservations.length,4);assert.equal(after.state[0].plan_rev,before.state[0].plan_rev+1);assert.equal(after.state[0].revision,before.state[0].revision+1);
 assert(after.reservations.every(r=>r.plan_id===JSON.parse(after.plans[0].content).id));
}));
test('concurrent identical creates return same result without duplicate writes',()=>fixture(async(h,c)=>{
 const results=await Promise.all([save(h,c),save(h,c)]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.deepEqual(results[0].data.plan,results[1].data.plan);assert.equal((await h.state()).plans.length,1);
}));
test('concurrent same-version edits: loser cannot delete reservations or change winner',()=>fixture(async(h,c)=>{
 const first=check(await save(h,c)).plan,before=await h.state();const results=await Promise.all([save(h,c,{...first,reason:'winner A'}),save(h,c,{...first,reason:'winner B'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results.find(r=>r.ok).data.plan,after=await h.state();assert.deepEqual(JSON.parse(after.plans[0].content),winner);assert.equal(after.reservations.length,4);assert.equal(after.state[0].plan_rev,before.state[0].plan_rev+1);
 const snapshot=await h.state();check(await save(h,c,first),409);assert.deepEqual(await h.state(),snapshot);
}));
test('cancel versions, retained history, released reservations and cross-session visibility',()=>fixture(async(h,c)=>{
 const first=check(await save(h,c)).plan;assert.equal(check(await h.api('load',{},c.admin)).plans[0].id,first.id);
 check(await h.api('cancelPlan',{id:first.id,version:0},c.teacher),409);
 const cancelled=check(await h.api('cancelPlan',{id:first.id,version:1},c.teacher)).plan;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.version,2);assert.equal((await h.state()).reservations.length,0);
 check(await save(h,c,first),409);check(await save(h,c,rawPlan('after_cancel_0001')));assert.equal((await h.state()).plans.length,2);
}));
test('same-draft duplicates fail; cover reserves exactly two endpoints',()=>fixture(async(h,c)=>{
 const p=rawPlan();p.items.push({...p.items[0]});check(await save(h,c,p),400);assert.equal((await h.state()).plans.length,0);
 p.items=[{mode:'cover',dateA:rawPlan().items[0].dateA,periodA:1,teacherB:'b'}];check(await save(h,c,p));assert.equal((await h.state()).reservations.length,2);
}));
test('save versus changed timetable race cannot commit a stale validation',()=>fixture(async(h,c)=>{
 const changed=synthetic();changed.lessons[0].subject='새과목';
 const results=await Promise.all([save(h,c),h.api('replaceData',{dataset:changed,dataRev:c.rev},c.admin)]);
 const success=results.filter(r=>r.ok);assert.equal(success.length,1,JSON.stringify(results));
 const state=await h.state(),subject=JSON.parse(state.state[0].dataset).lessons[0].subject;
 if(state.plans.length)assert.equal(subject,'과학');else assert.equal(subject,'새과목');
}));
test('data revisions and future snapshot mismatch preserve complete old state',()=>fixture(async(h,c)=>{
 check(await save(h,c));const before=await h.state(),changed=synthetic();changed.lessons[0].subject='changed';
 check(await h.api('replaceData',{dataset:changed,dataRev:c.rev},c.admin),400);assert.deepEqual(await h.state(),before);
 check(await h.api('replaceData',{dataset:synthetic(),dataRev:'0'},c.admin),409);assert.deepEqual(await h.state(),before);
}));
test('D1 constraint failures mid-save/data change/full restore roll back every table',()=>fixture(async(h,c)=>{
 const before=await h.state();
 await h.db.exec("CREATE TRIGGER fail_reservation BEFORE INSERT ON reservations BEGIN SELECT RAISE(ABORT,'injected_failure'); END;");
 check(await save(h,c),500);assert.deepEqual(await h.state(),before);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM mutation_guard').first()).n,0);
 await h.db.exec('DROP TRIGGER fail_reservation;');const first=check(await save(h,c)).plan,stable=await h.state();
 const backup=check(await h.api('exportBackup',{},c.admin));
 await h.db.exec("CREATE TRIGGER fail_plan BEFORE INSERT ON plans BEGIN SELECT RAISE(ABORT,'injected_restore_failure'); END;");
 const result=await h.api('restoreBackup',{backup,dataRev:c.rev,planRev:String(stable.state[0].plan_rev)},c.admin);check(result,500);assert(!result.message.includes('injected'));assert.deepEqual(await h.state(),stable);
 await h.db.exec('DROP TRIGGER fail_plan;');await h.db.exec("CREATE TRIGGER fail_state BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'injected_data_failure'); END;");
 check(await h.api('replaceData',{dataset:synthetic(),dataRev:c.rev},c.admin),500);assert.deepEqual(await h.state(),stable);assert.equal(first.version,1);
}));
test('zero-row stale CAS raises SQL error and cannot remove winner reservations',()=>fixture(async(h,c)=>{
 const plan=check(await save(h,c)).plan,before=await h.state();
 await assert.rejects(h.db.batch([h.db.prepare('INSERT INTO mutation_guard(id,valid) SELECT ?,CASE WHEN revision=? THEN 1 ELSE 0 END FROM state').bind('stale',0),h.db.prepare('DELETE FROM reservations WHERE plan_id=?').bind(plan.id),h.db.prepare('UPDATE state SET revision=revision+1')]),/CHECK/);
 assert.deepEqual(await h.state(),before);
}));
test('DB unique reservation constraint rolls back a preceding plan write',()=>fixture(async(h,c)=>{
 const p=check(await save(h,c)).plan,before=await h.state(),other={...p,id:'p_constraint_00000001'};
 await assert.rejects(h.db.batch([h.db.prepare('INSERT INTO plans(id,version,status,content) VALUES(?,1,?,?)').bind(other.id,'active',JSON.stringify(other)),h.db.prepare('INSERT INTO reservations VALUES(?,?,?,?)').bind('a',p.items[0].dateA,1,other.id),h.db.prepare('UPDATE state SET plan_rev=plan_rev+1')]),/UNIQUE/);
 assert.deepEqual(await h.state(),before);
}));
test('backup exports no credentials; restore preserves IDs, cancelled history and historical snapshots',()=>fixture(async(h,c)=>{
 const p=check(await save(h,c)).plan;const cancelled={...p,id:'p_cancelled_00000001',status:'cancelled',version:7};
 const ds=synthetic();ds.lessons[0].subject='new term';const historical={...p,id:'p_historical_0000001',items:p.items.map(i=>({...i,dateA:'2025-11-03',dateB:'2025-11-04'}))};
 const backup={type:'class-swap-backup',schema:1,dataset:ds,plans:[historical,cancelled]};
 const restored=check(await h.api('restoreBackup',{backup,dataRev:c.rev,planRev:'1'},c.admin));assert.equal(restored.plans.length,2);assert.equal(restored.plans[0].items[0].subjectA,'과학');assert.equal(restored.plans[1].version,7);assert.equal((await h.state()).reservations.length,4);
 const exported=check(await h.api('exportBackup',{},c.admin));assert.deepEqual(exported.plans.slice().sort((a,b)=>a.id.localeCompare(b.id)),backup.plans.slice().sort((a,b)=>a.id.localeCompare(b.id)));assert(!JSON.stringify(exported).includes('token_hash'));assert(!JSON.stringify(exported).includes('digest'));
 const stable=await h.state();check(await h.api('restoreBackup',{backup,dataRev:c.rev,planRev:'1'},c.admin),409);assert.deepEqual(await h.state(),stable);
}));
test('initial dataset and backup imports are atomic, repeat safe, and nonempty DBs are protected',async()=>{
 for(const full of [false,true]){const h=await harness();try{
  const ds=synthetic(),clean=C.validatePlan(ds,[],rawPlan()),p={...clean,id:rawPlan().id,version:4,status:'active',createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z'};
  const input=validateInput(full?{type:'class-swap-backup',schema:1,dataset:ds,plans:[p,{...p,id:'p_cancelled_import01',status:'cancelled',version:8}]}:ds),sql=importSQL(input,inputHash(input));
  // Each staged statement runs separately, matching Wrangler CLI; trigger apply is one atomic statement.
  for(const statement of sql.split(';\n').filter(Boolean))await h.db.prepare(statement).run();
  const state=await h.state();assert.equal(state.plans.length,full?2:0);assert.equal(state.reservations.length,full?4:0);assert.equal(state.state[0].data_rev,1);
  for(const statement of sql.split(';\n').filter(Boolean))await h.db.prepare(statement.replaceAll(/'([a-f0-9-]{36})'/g,(match,id)=>"'retry-"+id+"'")).run();
  assert.deepEqual(await h.state(),state);
  const other=validateInput({...ds,meta:{label:'different'}});await assert.rejects(async()=>{for(const statement of importSQL(other,inputHash(other)).split(';\n').filter(Boolean))await h.db.prepare(statement).run();},/EMPTY_DATABASE/);assert.deepEqual(await h.state(),state);
 }finally{await h.close();}}
});
test('initial import trigger failure retains empty operational state, including revisions',async()=>{
 const h=await harness();try{const ds=synthetic(),p={...C.validatePlan(ds,[],rawPlan()),id:rawPlan().id,version:1,status:'active',createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z'};
 const input=validateInput({type:'class-swap-backup',schema:1,dataset:ds,plans:[p]}),before=await h.state();
 await h.db.exec("CREATE TRIGGER injected_import BEFORE INSERT ON reservations BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(async()=>{for(const statement of importSQL(input,inputHash(input)).split(';\n').filter(Boolean))await h.db.prepare(statement).run();},/injected/);assert.deepEqual(await h.state(),before);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM imports').first()).n,0);
 }finally{await h.close();}
});
test('large backup import stages bounded documents rather than one oversized D1 row',async()=>{
 const h=await harness();try{
  const ds=synthetic(),base={...C.validatePlan(ds,[],rawPlan()),version:3,status:'cancelled',reason:'검'.repeat(200),createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-02T00:00:00Z'};
  const items=Array.from({length:24},(_,n)=>({...base.items[0],dateA:C.addDays('2025-01-06',n*7),dateB:C.addDays('2025-01-07',n*7),subjectA:'가'.repeat(100),subjectB:'나'.repeat(100),roomA:'다'.repeat(80),roomB:'라'.repeat(80),teacherBName:'마'.repeat(40)}));
  const plans=Array.from({length:100},(_,n)=>({...base,id:'p_large_history_'+String(n).padStart(5,'0'),items}));
  const input=validateInput({type:'class-swap-backup',schema:1,dataset:ds,plans}),bytes=Buffer.byteLength(JSON.stringify(input));assert(bytes>2*1024*1024&&bytes<8*1024*1024,bytes);
  const statements=importSQL(input,inputHash(input)).split(';\n').filter(Boolean);assert(statements.every(s=>Buffer.byteLength(s)<100000));
  for(let n=0;n<statements.length;n+=30)await h.db.batch(statements.slice(n,n+30).map(s=>h.db.prepare(s)));
  const state=await h.state();assert.equal(state.plans.length,100);assert.equal(state.reservations.length,0);assert.equal(state.state[0].data_rev,1);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM import_staging').first()).n,0);
  assert.deepEqual(JSON.parse(state.plans[0].content),input.plans[0]);console.log('Large backup bytes: '+bytes+'; '+statements.length+' bounded SQL statements');
 }finally{await h.close();}
});
test('password rotation invalidates only that role; admin receives a new cookie and secrets do not reset it',()=>fixture(async(h,c)=>{
 const second=await h.login('admin');check(await h.api('setPassword',{role:'teacher',password:'teacher456'},c.admin));check(await h.api('resume',{},c.teacher),401);check(await h.api('resume',{},c.admin));check(await h.api('login',{role:'teacher',password:'1234'}),401);await h.login('teacher','teacher456');
 const changed=await h.api('setPassword',{role:'admin',password:'admin456'},c.admin);check(changed);const next=changed.headers.get('Set-Cookie').split(';')[0];assert.notEqual(next,c.admin);check(await h.api('resume',{},second.cookie),401);check(await h.api('resume',{},c.admin),401);check(await h.api('resume',{},next));check(await h.api('login',{role:'admin',password:'1234'}),401);await h.login('admin','admin456');
 const credentials=await h.db.prepare('SELECT * FROM credentials').all();assert(credentials.results.every(r=>r.salt.length===32&&r.digest.length===64&&!['1234','admin456','teacher456'].includes(r.digest)));
}));
test('D1 persisted login limit survives requests and password KDF executes in workerd',()=>fixture(async(h,c)=>{
 for(let i=0;i<12;i++)check(await h.api('login',{role:'teacher',password:'invalid'},'',{'CF-Connecting-IP':'192.0.2.1'}),401);
 check(await h.api('login',{role:'teacher',password:'1234'},'',{'CF-Connecting-IP':'192.0.2.1'}),429);
 const result=await h.login('teacher');assert(result.elapsed>0);console.log('PBKDF2 100000 iterations: login wall time '+Math.round(result.elapsed)+'ms (local; production CPU unmeasured)');
}));
