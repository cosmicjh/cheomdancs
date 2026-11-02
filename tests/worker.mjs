import worker from '../src/worker.js';
// Test-only SQL adapter. Production entry is src/worker.js and cannot reach this route.
export default {async fetch(request,env,ctx){
 if(new URL(request.url).pathname==='/__fixture_sql'){
  try{const p=await request.json(),statement=s=>env.DB.prepare(s.sql).bind(...s.args);
   const data=p.mode==='batch'?await env.DB.batch(p.statements.map(statement)):await statement(p)[p.mode]();
   return Response.json({ok:true,data});
  }catch(error){return Response.json({ok:false,message:String(error.message)}, {status:500});}
 }
 return worker.fetch(request,env,ctx);
}};
