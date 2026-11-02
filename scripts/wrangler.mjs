import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {mkdir} from 'node:fs/promises';
export const root=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
export const cli=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
export async function wrangler(args,{capture=false}={}) {
  await mkdir(resolve(root,'test-results'),{recursive:true});
  return new Promise((res,rej)=>{
    const child=spawn(process.execPath,[cli,...args,'--config',resolve(root,'wrangler.jsonc')],{cwd:root,windowsHide:true,
      env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(root,'test-results/wrangler.log')},stdio:capture?['ignore','pipe','pipe']:'inherit'});
    let stdout='',stderr='';if(capture){child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);}
    child.once('error',rej);child.once('exit',code=>res({code,stdout,stderr}));
  });
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)) {
  const result=await wrangler(process.argv.slice(2));process.exitCode=result.code||0;
}
