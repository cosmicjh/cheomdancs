import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {validateInput,counts,chunks,reservationRows} from '../src/shared/backup.js';
import {wrangler,root} from './wrangler.mjs';
import {checkDeploy} from './check-deploy.mjs';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export const inputHash=input=>createHash('sha256').update(JSON.stringify({dataset:input.dataset,plans:input.plans})).digest('hex');
export function importSQL(input,hash){
  const job=randomUUID(),statements=[];let part=0;
  // Bound each statement below the D1 SQL-text limit; only the final trigger changes user state.
  function stage(kind,id,value){const characters=Array.from(JSON.stringify(value));for(let offset=0;offset<characters.length;offset+=8000)statements.push(`INSERT INTO import_staging(job_id,part,kind,document_id,content) VALUES(${quote(job)},${part++},${quote(kind)},${quote(id)},${quote(characters.slice(offset,offset+8000).join(''))})`);}
  stage('dataset','dataset',input.dataset);
  for(const plan of input.plans)stage('plan',plan.id,plan);
  chunks(reservationRows(input.plans),20000).forEach((group,n)=>stage('reservations',String(n),group));
  statements.push(`INSERT INTO initial_import(job_id,hash,content) SELECT ${quote(job)},${quote(hash)},${quote(JSON.stringify(counts(input)))} WHERE NOT EXISTS(SELECT 1 FROM imports WHERE hash=${quote(hash)})`);
  return statements.join(';\n')+';\n';
}
function flatten(output){
  const start=output.indexOf('['); if(start<0)throw Error('Wrangler JSON response missing');
  return JSON.parse(output.slice(start)).flatMap(x=>x.results||[]);
}
async function query(sql,remote){
  const result=await wrangler(['d1','execute','DB',remote?'--remote':'--local','--command',sql,'--json'],{capture:true});
  if(result.code!==0)throw Error('D1 query failed. Check the private Wrangler log.');
  return flatten(result.stdout);
}
export async function main(args){
  const [action,file,...flags]=args;
  if(!['check','import','verify'].includes(action) || !file)throw Error('Usage: npm run data:check|data:import|data:verify -- <private JSON path> [--remote --confirm-empty]');
  if(flags.some(f=>!['--remote','--local','--confirm-empty'].includes(f)))throw Error('Unknown flag');
  const remote=flags.includes('--remote');
  if(remote)await checkDeploy();
  const raw=await readFile(resolve(file)); if(raw.byteLength>8*1024*1024)throw Error('Input must be <=8MB');
  const input=validateInput(JSON.parse(raw.toString('utf8'))),hash=inputHash(input),report={kind:input.backup?'class-swap-backup':'schema:1 dataset',...counts(input),hash};
  // Print counts and protected subject codes only, never teacher names or timetable rows.
  console.log(JSON.stringify(report,null,2));
  if(action==='check')return;
  if(action==='import'){
    if(remote && !flags.includes('--confirm-empty'))throw Error('Remote initial import requires --remote --confirm-empty; existing databases are always refused.');
    const found=await query(`SELECT hash FROM imports WHERE hash=${quote(hash)}`,remote);
    if(found.length){console.log('Already imported; database left unchanged. Run data:verify to compare current contents.');return;}
    const state=await query('SELECT dataset IS NULL AS empty,revision,(SELECT count(*) FROM plans) AS plans FROM state WHERE id=1',remote);
    if(!state[0]?.empty || state[0].revision!==0 || state[0].plans!==0)throw Error('Initial import refused: database contains state. Use the authenticated, revision-checked full restore after exporting a backup.');
    await mkdir(resolve(root,'private-data'),{recursive:true}); const fileSQL=resolve(root,'private-data/import-'+randomUUID()+'.sql');
    await writeFile(fileSQL,importSQL(input,hash));
    try{const result=await wrangler(['d1','execute','DB',remote?'--remote':'--local','--file',fileSQL,'--json'],{capture:true});if(result.code!==0)throw Error('Import failed. Inspect the private Wrangler log; no public SQL was generated.');console.log('Initial import completed ('+(remote?'REMOTE':'LOCAL')+').');}
    finally{await unlink(fileSQL);}
  }
  const [s,...plans]=await query("SELECT 'state' AS kind,dataset AS content FROM state WHERE id=1; SELECT 'plan' AS kind,content FROM plans ORDER BY id",remote);
  const actual={dataset:JSON.parse(s.content),plans:plans.map(p=>JSON.parse(p.content))};
  const expected={dataset:input.dataset,plans:input.plans.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
  // Source ordering of plans is not significant; document order and all snapshots inside plans are.
  if(inputHash(actual)!==inputHash(expected))throw Error('Verification failed: current dataset/plans differ from the input.');
  const expectedRows=reservationRows(input.plans).map(r=>JSON.stringify(r)).sort();
  const actualRows=(await query('SELECT teacher_id AS teacher,actual_date AS date,period,plan_id AS plan FROM reservations',remote)).map(r=>JSON.stringify(r)).sort();
  if(JSON.stringify(expectedRows)!==JSON.stringify(actualRows))throw Error('Verification failed: reservation set differs.');
  console.log('Verified exact dataset, plan IDs/versions/status/timestamps/snapshots, and all '+actualRows.length+' reservations.');
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){try{await main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
