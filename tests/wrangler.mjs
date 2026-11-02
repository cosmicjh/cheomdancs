import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import '../scripts/build.mjs';
import {wrangler,cli,root} from '../scripts/wrangler.mjs';
await mkdir('test-results',{recursive:true});
const persist='test-results/wrangler-'+crypto.randomUUID(),results=[];
for(const args of [['--version'],['d1','migrations','apply','DB','--local','--persist-to',persist],['deploy','--dry-run','--outdir','test-results/bundle']]){
 const result=await wrangler(args,{capture:true});assert.equal(result.code,0,result.stdout+result.stderr);console.log('PASS Wrangler '+args.join(' '));results.push({command:args.join(' '),...result});
}
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn(process.execPath,[cli,'dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',persist,'--config',resolve(root,'wrangler.jsonc')],{cwd:root,windowsHide:true,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(root,'test-results/wrangler-dev.log')},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try{
 const url='http://127.0.0.1:'+port;let ready=false;
 for(let i=0;i<180;i++){if(child.exitCode!==null)throw Error(output);try{if((await fetch(url+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,output);
 for(const pathname of ['/','/app.js','/core.js','/xlsx.full.min.js']){const r=await fetch(url+pathname);assert.equal(r.status,200,pathname);assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);}
 for(const pathname of ['/api/not-found','/api/fake.html']){const r=await fetch(url+pathname);assert.equal(r.status,404);assert.match(r.headers.get('Content-Type'),/json/);assert.equal((await r.json()).ok,false);}
 for(const pathname of ['/private-data/initial-data.json','/legacy/private-data/initial-data.json','/.dev.vars','/wrangler.jsonc','/src/worker.js','/migrations/0001_class_swap.sql','/legacy/apps-script/Code.gs'])assert.equal((await fetch(url+pathname)).status,404,pathname);
 const denied=await fetch(url+'/api',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({action:'load'})});assert.equal(denied.status,401);assert.equal(denied.headers.get('Cache-Control'),'no-store');
 results.push({runtime:'wrangler dev --local',routes:'ASSETS + DB + private exclusions passed'});console.log('PASS live Wrangler: static assets, API JSON errors, anonymous denial, private files excluded');
}finally{child.kill();await new Promise(r=>child.once('exit',r));await writeFile('test-results/wrangler.json',JSON.stringify(results,null,2)+'\n');}
