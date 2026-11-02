import {mkdir,readFile,writeFile,copyFile,readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'), output=resolve(root,'public');
await mkdir(output,{recursive:true});
const allowed=['index.html','app.js','core.js','xlsx.full.min.js','LICENSE-SheetJS.txt','LICENSE-Pretendard.txt','_headers'];
// Refuse unexpected existing files instead of silently publishing a private artifact.
for(const entry of await readdir(output)) if(!allowed.includes(entry) || !(await lstat(resolve(output,entry))).isFile()) throw Error('Unexpected public asset: '+entry);
for(const name of ['index.html','app.js','xlsx.full.min.js','LICENSE-SheetJS.txt']) await copyFile(resolve(root,'src/client',name),resolve(output,name));
await copyFile(resolve(root,'src/shared/core.js'),resolve(output,'core.js'));
await copyFile(resolve(root,'src/client/LICENSE-Pretendard.txt'),resolve(output,'LICENSE-Pretendard.txt'));
await writeFile(resolve(output,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
`);
const forbidden=/google\.script\.run|classSwapApi|script\.google\.com|googleusercontent\.com|HtmlService|SpreadsheetApp|PropertiesService|CacheService|LockService|Utilities\.|setFrontendOrigin|CLASS_SWAP_CONFIG|frontendOrigin|<\?=?|__CORE_RUNTIME__/;
for(const name of ['index.html','app.js','core.js']) if(forbidden.test(await readFile(resolve(output,name),'utf8'))) throw Error('Legacy runtime dependency in '+name);
console.log('Built '+allowed.length+' allowlisted public assets; no private input required.');
