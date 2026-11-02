import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function checkDeploy(){
  const config=JSON.parse(await readFile(resolve(import.meta.dirname,'../wrangler.jsonc'),'utf8'));
  const binding=config.d1_databases?.find(x=>x.binding==='DB');
  if(!binding || !/^[a-f0-9-]{36}$/i.test(binding.database_id) || /^0{8}-/.test(binding.database_id)) throw Error('Set a verified, dedicated class-swap D1 database_id in wrangler.jsonc. The zero ID is LOCAL ONLY.');
  if(config.pages_build_output_dir || config.assets?.directory!=='./public' || config.main!=='src/worker.js') throw Error('Workers configuration is required.');
  if(!/^class-swap(?:-[a-z0-9-]+)?$/.test(config.name) || !/^class-swap/.test(binding.database_name)) throw Error('Use dedicated class-swap resources; do not use another tool’s Worker or D1.');
  console.log('Configuration valid: '+config.name+', binding DB, database '+binding.database_name+'. Verify these names against the dashboard before deployment.');
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){try{await checkDeploy();}catch(e){console.error(e.message);process.exitCode=1;}}
