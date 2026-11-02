import {ApiError, invalid} from './server/errors.js';
import {authorize, changePassword, clearCookie, login} from './server/auth.js';
import {cancelPlan, readState, replaceData, restoreBackup, savePlan, snapshot} from './server/storage.js';
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const json = (body,status=200,extra={}) => new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
const limit = 8 * 1024 * 1024;
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413,'TOO_LARGE','요청은 8MB 이하로 보내 주세요.');
  const reader=request.body?.getReader(); if(!reader) invalid('요청 내용을 확인해 주세요.');
  const parts=[]; let bytes=0;
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new ApiError(413,'TOO_LARGE','요청은 8MB 이하로 보내 주세요.');}parts.push(value);}
  const body=new Uint8Array(bytes);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  try {const value=JSON.parse(new TextDecoder().decode(body));if(!value || typeof value!=='object' || Array.isArray(value))invalid('요청 형식을 확인해 주세요.');return value;}
  catch(e){if(e instanceof ApiError)throw e;invalid('JSON 요청을 확인해 주세요.');}
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url), isApi=url.pathname==='/api'||url.pathname.startsWith('/api/');
    if(!isApi) {
      const response=await env.ASSETS.fetch(request), h=new Headers(response.headers);
      h.set('X-Content-Type-Options','nosniff'); h.set('Referrer-Policy','same-origin');
      h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return new Response(response.body,{status:response.status,headers:h});
    }
    if(url.pathname==='/api/health' && request.method==='GET') return json({ok:true,data:{service:'class-swap',version:'2026.11.02'}});
    if(url.pathname!=='/api') return json({ok:false,code:'NOT_FOUND',message:'API 경로를 확인해 주세요.'},404);
    if(request.method!=='POST') return json({ok:false,code:'METHOD_NOT_ALLOWED',message:'POST 요청이 필요합니다.'},405,{Allow:'POST'});
    try {
      if(request.headers.get('Origin')!==url.origin) throw new ApiError(403,'FORBIDDEN','같은 사이트에서 요청해 주세요.');
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')) invalid('JSON 요청이 필요합니다.');
      const {action,payload={}}=await readBody(request);
      if(!payload || typeof payload!=='object' || Array.isArray(payload)) invalid('요청 내용을 확인해 주세요.');
      if(action==='login') {const result=await login(env,request,payload);return json({ok:true,data:snapshot(await readState(env.DB),result.role)},200,{'Set-Cookie':result.setCookie});}
      const auth=await authorize(request,env.DB);
      if(action==='logout') {await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(auth.tokenHash).run();return json({ok:true,data:{}},200,{'Set-Cookie':clearCookie(request)});}
      if(['replaceData','exportBackup','restoreBackup','setPassword'].includes(action) && auth.role!=='admin') throw new ApiError(403,'FORBIDDEN','관리자 권한이 필요합니다.');
      if(action==='setPassword') {const setCookie=await changePassword(env.DB,request,auth,payload);return json({ok:true,data:{message:'비밀번호를 변경했습니다.'}},200,setCookie?{'Set-Cookie':setCookie}:{});}
      if(!['load','resume','savePlan','cancelPlan','replaceData','exportBackup','restoreBackup'].includes(action)) throw new ApiError(404,'NOT_FOUND','지원하지 않는 요청입니다.');
      const s=await readState(env.DB); let data;
      if(action==='load'||action==='resume') data=snapshot(s,auth.role,payload);
      else if(action==='savePlan') data=await savePlan(env.DB,s,auth,payload);
      else if(action==='cancelPlan') data=await cancelPlan(env.DB,s,auth,payload);
      else if(action==='replaceData') data=await replaceData(env.DB,s,auth,payload);
      else if(action==='restoreBackup') data=await restoreBackup(env.DB,s,auth,payload);
      else data={type:'class-swap-backup',schema:1,exportedAt:new Date().toISOString(),dataset:s.dataset,plans:s.plans};
      return json({ok:true,data});
    } catch(error) {
      if(error instanceof ApiError) return json({ok:false,code:error.code,message:error.message},error.status,error.status===429?{'Retry-After':'600'}:{});
      return json({ok:false,code:'INTERNAL',message:'서버에서 요청을 처리하지 못했습니다. 작성 내용은 유지됩니다. 관리자에게 문의해 주세요.'},500);
    }
  }
};
