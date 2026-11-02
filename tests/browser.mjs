import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {C} from '../src/shared/core.js';
import {rawPlan} from './fixtures/data.js';
import '../scripts/build.mjs';
await mkdir('test-results',{recursive:true});
const h=await harness(),steps=[],errors=[];let browser;
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
try{
 const ctx=await h.setup(),url=await h.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
 const action=(name,target=page)=>target.locator('[data-action="'+name+'"]');
 async function login(target=page){await target.locator('#password').fill('1234');await target.locator('#loginButton').click();await target.locator('#appView').waitFor({state:'visible'});}
 await step('Login screen exposes no timetable; HttpOnly cookie is hidden from script',async()=>{await page.goto(url);await page.locator('#uiLock:not([disabled])').waitFor();assert.equal(await page.locator('#teacherA option').count(),1);await login();assert(!await page.evaluate(()=>document.cookie.includes('class_swap_session')));assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0);});
 await step('Official Pretendard font loads and rendered UI uses grayscale colors',async()=>{const design=await page.evaluate(async()=>{await document.fonts.ready;const els=[document.body,document.querySelector('h1'),document.querySelector('.btn.primary'),document.querySelector('.panel')].filter(Boolean);return{family:getComputedStyle(document.body).fontFamily,faces:[...document.fonts].map(f=>({family:f.family,status:f.status})),colors:els.flatMap(el=>['color','backgroundColor','borderTopColor'].map(p=>getComputedStyle(el)[p]))};});assert.match(design.family,/Pretendard Variable/);assert(design.faces.some(f=>f.family.includes('Pretendard Variable')&&f.status==='loaded'));for(const color of design.colors){const rgb=color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(rgb)assert(rgb[1]===rgb[2]&&rgb[2]===rgb[3],color);}});
 await step('Desktop aligned timetable rows, cross-week candidate selection, preserved dates after add',async()=>{
  await page.locator('#teacherA').selectOption('a');await page.locator('#reason').fill('출장');await page.locator('#dateA').fill('2026-11-02');await page.locator('#dateA').dispatchEvent('change');await page.locator('#weekB').fill('2026-11-09');await page.locator('#weekB').dispatchEvent('change');
  await page.locator('[data-action=cellA][data-day="0"][data-period="1"]').click();await page.locator('#teacherB').selectOption('b');await page.locator('[data-action=cellB][data-day="1"][data-period="2"]').click();
  const rows=await page.evaluate(()=>['tableA','tableB'].map(id=>[...document.querySelectorAll('#'+id+' tbody tr')].map(e=>e.getBoundingClientRect().y)));assert(rows[0].every((y,i)=>Math.abs(y-rows[1][i])<=1),JSON.stringify(rows));await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  await action('add').click();assert.equal(await page.locator('#dateA').inputValue(),'2026-11-02');assert.equal(await page.locator('#weekB').inputValue(),'2026-11-09');assert.equal(await page.locator('#itemCount').textContent(),'1건');
 });
 await step('Save error preserves draft; save locks inputs then restores controls',async()=>{
  await context.route('**/api',async route=>{if(route.request().postDataJSON()?.action==='savePlan')await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,code:'CONFLICT',message:'가상 충돌'})});else await route.continue();});
  await action('save').click();await page.locator('#appError').waitFor({state:'visible'});assert.equal(await page.locator('#itemCount').textContent(),'1건');assert.equal(await page.locator('#reason').inputValue(),'출장');assert(!await page.locator('#uiLock').isDisabled());await context.unroute('**/api');
  let release;const gate=new Promise(r=>release=r);await context.route('**/api',async route=>{if(route.request().postDataJSON()?.action==='savePlan')await gate;await route.continue();});
  const saved=page.waitForResponse(r=>r.url().endsWith('/api')&&r.request().postDataJSON()?.action==='savePlan');saved.catch(()=>{});const clicked=action('save').click();await page.locator('#uiLock[disabled]').waitFor();assert(await page.locator('#reason').isDisabled());release();await clicked;assert.equal((await saved).status(),200);await page.locator('#uiLock:not([disabled])').waitFor();await context.unroute('**/api');
 });
 await step('Independent browser loads, edits and cancels saved shared plan',async()=>{
  const other=await browser.newContext(),p=await other.newPage();await p.goto(url);await p.locator('#uiLock:not([disabled])').waitFor();await login(p);await action('nav',p).filter({hasText:'저장된 계획서'}).click();await action('openPlan',p).first().click();await p.locator('#reason').fill('연수');
  const saved=p.waitForResponse(r=>r.url().endsWith('/api')&&r.request().postDataJSON()?.action==='savePlan');await action('save',p).click();assert.equal((await saved).status(),200);await p.locator('#uiLock:not([disabled])').waitFor();await action('nav',p).filter({hasText:'저장된 계획서'}).click();p.once('dialog',d=>d.accept());await action('cancelPlan',p).first().click();await p.locator('#uiLock:not([disabled])').waitFor();assert.equal((await h.state()).reservations.length,0);await other.close();
 });
 await step('Expired session preserves draft through renewed login',async()=>{
  await page.locator('#reason').fill('만료 후 유지');await h.db.prepare("DELETE FROM sessions WHERE role='teacher'").run();await action('save').click();await page.locator('#loginView').waitFor({state:'visible'});await page.locator('#uiLock:not([disabled])').waitFor();await login();assert.equal(await page.locator('#reason').inputValue(),'만료 후 유지');assert.equal(await page.locator('#itemCount').textContent(),'1건');
 });
 await step('Mobile stacked timetables and no horizontal page overflow',async()=>{
  await page.setViewportSize({width:390,height:844});const a=await page.locator('#tableA').boundingBox(),b=await page.locator('#tableB').boundingBox();assert(b.y>a.y+a.height);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 });
 await step('A4 portrait plans paginate every 8 rows; notices use A4 landscape',async()=>{
  const raw=rawPlan('browser_print_00001');raw.items=Array.from({length:9},(_,n)=>({...raw.items[0],dateA:C.addDays('2026-11-16',n*7),dateB:C.addDays('2026-11-17',n*7)}));const result=await h.api('savePlan',{plan:raw,dataRev:ctx.rev},ctx.admin);assert.equal(result.status,200,JSON.stringify(result));
  await action('refresh').first().click();await page.locator('#uiLock:not([disabled])').waitFor();await action('nav').filter({hasText:'저장된 계획서'}).click();page.once('dialog',d=>d.accept());await page.locator('[data-action=openPlan][data-id="'+raw.id+'"]').click();await page.evaluate(()=>window.print=()=>{});await action('printDraft').click();await page.waitForFunction(()=>document.querySelectorAll('#printRoot .print-page').length===2);assert.match(await page.locator('#printPageStyle').textContent(),/A4 portrait/);await page.screenshot({path:'test-results/print-plan.png',fullPage:true});
  await action('noticeDraft').click();assert.match(await page.locator('#printPageStyle').textContent(),/A4 landscape/);assert.equal(await page.locator('#printRoot .notice-page').count(),9);
 });
 assert.deepEqual(errors,[]);await context.close();
}finally{await browser?.close();await h.close();await writeFile('test-results/browser.json',JSON.stringify({steps,errors},null,2)+'\n');}
