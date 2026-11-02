import {Miniflare,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {synthetic} from './fixtures/data.js';
let bundle;
export async function harness(){
 bundle??=(await build({entryPoints:['tests/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
 const mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-07-30',cf:false,d1Databases:{DB:'swap-'+crypto.randomUUID()},bindings:{INITIAL_TEACHER_PASSWORD:'1234',INITIAL_ADMIN_PASSWORD:'1234'},host:'127.0.0.1',port:0,log:new Log(LogLevel.ERROR)});
 async function sql(payload){const response=await mf.dispatchFetch('http://localhost/__fixture_sql',{method:'POST',body:JSON.stringify(payload)});const r=await response.json();if(!r.ok)throw Error(r.message);return r.data;}
 // These wrappers serialize SQL to the actual workerd D1 binding; they do not emulate SQL or state.
 const db={prepare(query){const s={sql:query,args:[]};s.bind=(...args)=>{s.args=args;return s;};for(const mode of ['first','all','run'])s[mode]=()=>sql({mode,sql:s.sql,args:s.args});return s;},batch(statements){return sql({mode:'batch',statements:statements.map(s=>({sql:s.sql,args:s.args}))});},exec(query){return sql({mode:'run',sql:query,args:[]});}};
 try{
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
   let schema=(await readFile('migrations/'+file,'utf8')).replace(/--[^\n]*/g,'');const triggers=[];
   schema=schema.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,s=>{triggers.push(s);return '';});
   await db.batch([...schema.split(';').filter(s=>s.trim()),...triggers].map(statement=>db.prepare(statement)));
  }
 }catch(e){await mf.dispose();throw e;}
 async function api(action,payload={},cookie='',extra={}){
  const start=performance.now(),response=await mf.dispatchFetch('http://localhost/api',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify({action,payload})});
  return {status:response.status,headers:response.headers,elapsed:performance.now()-start,...await response.json()};
 }
 async function login(role='admin',password='1234'){
  const result=await api('login',{role,password});if(!result.ok)throw Error(JSON.stringify(result));
  return {...result,cookie:result.headers.get('Set-Cookie').split(';')[0]};
 }
 async function setup(){const admin=await login(),teacher=await login('teacher');const data=await api('replaceData',{dataset:synthetic(),dataRev:'0'},admin.cookie);if(!data.ok)throw Error(JSON.stringify(data));return {admin:admin.cookie,teacher:teacher.cookie,rev:data.data.dataRev};}
 let server;
 return {mf,db,api,login,setup,
  async state(){const [s,p,r]=await db.batch([db.prepare('SELECT * FROM state'),db.prepare('SELECT * FROM plans ORDER BY id'),db.prepare('SELECT * FROM reservations ORDER BY teacher_id,actual_date,period')]);return {state:s.results,plans:p.results,reservations:r.results};},
  async listen(){const root=resolve('public');server=createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const response=await mf.dispatchFetch('http://localhost'+url.pathname,{method:req.method,headers:{...req.headers,...(req.headers.origin===url.origin?{origin:'http://localhost'}:{})},...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
    const headers=Object.fromEntries(response.headers);delete headers['set-cookie'];if(response.headers.getSetCookie().length)headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+sep))throw Error('path');
   const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(file)]||'text/plain','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'"});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;},
  async close(){if(server)await new Promise(r=>server.close(r));await mf.dispose();}
 };
}
