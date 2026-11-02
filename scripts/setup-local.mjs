import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
try{await writeFile(resolve(import.meta.dirname,'../.dev.vars'),'# LOCAL VIRTUAL VALUES ONLY\nINITIAL_TEACHER_PASSWORD=1234\nINITIAL_ADMIN_PASSWORD=1234\n',{flag:'wx'});console.log('Created ignored .dev.vars with virtual local defaults.');}
catch(e){if(e.code!=='EEXIST')throw e;console.log('Existing .dev.vars preserved.');}
