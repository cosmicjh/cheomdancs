/** 수업 결·보강 도우미 · Google Apps Script V8 */
const APP_VERSION_ = '2026.10.29';
const DATA_SHEET_ = '결보강_자료';
const PLAN_SHEET_ = '결보강_계획서';
const CORE_ = SwapCoreFactory_();

/** Run once from the Apps Script editor, bound to a NEW private spreadsheet. */
function setupClassSwap() {
  const active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
  if (!active || active !== effective) throw new Error('스프레드시트 소유자가 편집기에서 실행해 주세요.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('새 스프레드시트에 연결된 Apps Script에서 실행해 주세요.');
    if (props.getProperty('DATABASE_ID') && props.getProperty('DATABASE_ID') !== ss.getId()) throw new Error('이미 다른 저장소가 연결되어 있습니다.');
    props.setProperty('DATABASE_ID', ss.getId());
    if (!props.getProperty('PASSWORD_PEPPER')) props.setProperty('PASSWORD_PEPPER', Utilities.getUuid() + Utilities.getUuid());
    if (!props.getProperty('PASS_teacher')) setPassword_('teacher','1234');
    if (!props.getProperty('PASS_admin')) setPassword_('admin','1234');
    ensureSheet_(ss, DATA_SHEET_, ['순번','자료 A','자료 B']);
    ensureSheet_(ss, PLAN_SHEET_, ['계획서 ID','수정 버전','상태','수정 시각','계획서 JSON']);
    if (!props.getProperty('DATA_REV')) props.setProperty('DATA_REV','0');
    if (!props.getProperty('PLAN_REV')) props.setProperty('PLAN_REV','0');
    props.setProperty('OWNER_EMAIL', effective);
    return '초기 설정 완료. App·Bridge HTML 파일과 Core.gs를 확인하고 웹앱을 배포해 주세요.';
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.mode === 'bridge') {
    const origin = String(p.origin || ''), nonce = String(p.nonce || '');
    const props = PropertiesService.getScriptProperties();
    const allowed = String(props.getProperty('FRONTEND_ORIGIN') || '');
    const validOrigin = allowed ? origin === allowed : /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.github\.io$/.test(origin);
    if (!validOrigin || !/^[a-zA-Z0-9_-]{20,100}$/.test(nonce)) return HtmlService.createHtmlOutput('연결 주소를 확인해 주세요.');
    const template = HtmlService.createTemplateFromFile('Bridge');
    template.bridgeConfig = JSON.stringify({origin,nonce}).replace(/</g,'\\u003c');
    return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  const content = HtmlService.createHtmlOutputFromFile('App').getContent()
    .replace('/*__CORE_RUNTIME__*/','window.SwapCore = (' + SwapCoreFactory_.toString() + ')();');
  return HtmlService.createHtmlOutput(content).setTitle('수업 결·보강 도우미')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** The only browser RPC endpoint. No passwords or sheet contents are public. */
function classSwapApi(request) {
  try {
    request = request || {};
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('DATABASE_ID')) return {ok:false,code:'NOT_READY',message:'관리자가 초기 설정을 완료해야 합니다.'};
    const action = String(request.action || ''), payload = request.payload || {};
    if (action === 'login') return locked_(function() { return {ok:true,data:login_(payload)}; });
    const auth = authorize_(request.token);
    if (action === 'logout') { CacheService.getScriptCache().remove(sessionKey_(request.token)); return {ok:true,data:{}}; }
    return locked_(function() {
      authorize_(request.token);
      if (props.getProperty('MAINTENANCE')) throw new Error('자료 복원 상태를 관리자 편집기에서 확인해 주세요.');
      const ss = SpreadsheetApp.openById(props.getProperty('DATABASE_ID'));
      if (['load','resume'].includes(action)) return {ok:true,data:snapshot_(ss,payload,auth)};
      if (action === 'savePlan') return {ok:true,data:savePlan_(ss,payload,auth)};
      if (action === 'cancelPlan') return {ok:true,data:cancelPlan_(ss,payload,auth)};
      if (auth.role !== 'admin') return {ok:false,code:'FORBIDDEN',message:'관리자 권한이 필요합니다.'};
      if (action === 'replaceData') {
        assertRevision_(payload.dataRev,props.getProperty('DATA_REV'));
        const data = CORE_.validateDataset(payload.dataset), plans = readPlans_(ss);
        CORE_.validateExisting(data,plans,today_());
        writeData_(ss,data); return {ok:true,data:snapshot_(ss,{},auth)};
      }
      if (action === 'exportBackup') return {ok:true,data:{type:'class-swap-backup',schema:1,exportedAt:new Date().toISOString(),dataset:readData_(ss),plans:readPlans_(ss)}};
      if (action === 'restoreBackup') return {ok:true,data:restoreBackup_(ss,payload,auth)};
      if (action === 'setPassword') {
        const role = payload.role;
        if (!['teacher','admin'].includes(role) || typeof payload.password !== 'string' || payload.password.length < 4 || payload.password.length > 100) throw new Error('비밀번호는 4–100자로 입력해 주세요.');
        setPassword_(role,payload.password);
        // Invalidate the changed role's old sessions; keep this admin session valid.
        if (role === 'admin') renewSession_(request.token,'admin');
        return {ok:true,data:{message:'비밀번호를 변경했습니다.'}};
      }
      if (action === 'setFrontendOrigin') {
        const origin = String(payload.origin || '').trim().replace(/\/$/,'');
        if (origin && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(origin)) throw new Error('https://로 시작하는 사이트 출처만 입력해 주세요.');
        props.setProperty('FRONTEND_ORIGIN',origin);
        return {ok:true,data:{origin}};
      }
      throw new Error('지원하지 않는 요청입니다.');
    });
  } catch (error) {
    return {ok:false,code:error.code || 'VALIDATION',message:String(error.message || '처리 중 오류가 발생했습니다.').slice(0,600)};
  }
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { const e = new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.'); e.code = 'BUSY'; throw e; }
  try { return fn(); } finally { lock.releaseLock(); }
}
function assertRevision_(expected,actual) {
  if (String(expected) !== String(actual)) { const e = new Error('다른 사용자가 자료를 변경했습니다. 새로 불러온 후 다시 시도해 주세요.'); e.code = 'CONFLICT'; throw e; }
}
function ensureSheet_(ss,name,headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) { sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1); }
  return sheet;
}
function digest_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b => ('0' + ((b+256)%256).toString(16)).slice(-2)).join(''); }
function today_() { return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'); }
function passwordHash_(password,salt) { return digest_(salt + ':' + String(password) + ':' + PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER')); }
function setPassword_(role,password) {
  const props = PropertiesService.getScriptProperties(), salt = Utilities.getUuid();
  props.setProperties({['PASS_' + role]:salt + ':' + passwordHash_(password,salt), ['AUTH_' + role]:Utilities.getUuid()});
}
function sessionKey_(token) { return 'auth:' + digest_(String(token || '')); }
function renewSession_(token,role) {
  const props = PropertiesService.getScriptProperties();
  CacheService.getScriptCache().put(sessionKey_(token),JSON.stringify({role,epoch:props.getProperty('AUTH_'+role),expires:Date.now()+21600000}),21600);
}
function authorize_(token) {
  const error = function() { const e = new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'); e.code='AUTH_REQUIRED'; throw e; };
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return error();
  const raw = CacheService.getScriptCache().get(sessionKey_(token));
  if (!raw) return error();
  const session = JSON.parse(raw);
  if (!['teacher','admin'].includes(session.role) || session.expires < Date.now() || session.epoch !== PropertiesService.getScriptProperties().getProperty('AUTH_'+session.role)) return error();
  return session;
}
function login_(payload) {
  const role = payload.role === 'admin' ? 'admin' : 'teacher';
  const cache = CacheService.getScriptCache(), failKey = 'fail:' + role;
  const failures = JSON.parse(cache.get(failKey) || '{"count":0,"until":0}');
  if (failures.until > Date.now() && failures.count >= 12) throw new Error('로그인 실패가 반복되었습니다. 10분 후 다시 시도해 주세요.');
  const encoded = PropertiesService.getScriptProperties().getProperty('PASS_'+role) || '', parts=encoded.split(':');
  if (parts.length !== 2 || parts[1].length !== 64) throw new Error('관리자가 초기 설정을 완료해야 합니다.');
  const provided = passwordHash_(String(payload.password || ''),parts[0]);
  let diff = 0; for (let i=0;i<64;i++) diff |= provided.charCodeAt(i) ^ String(parts[1] || '').charCodeAt(i);
  if (diff !== 0) {
    const count = failures.until > Date.now() ? failures.count+1 : 1;
    cache.put(failKey,JSON.stringify({count,until:failures.until > Date.now() ? failures.until : Date.now()+600000}),600);
    throw new Error('비밀번호를 확인해 주세요.');
  }
  cache.remove(failKey);
  const token = digest_(Utilities.getUuid()+Utilities.getUuid()); renewSession_(token,role);
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('DATABASE_ID'));
  return Object.assign(snapshot_(ss,{}, {role}),{token,role});
}
function readData_(ss) {
  const props=PropertiesService.getScriptProperties(), rev=props.getProperty('DATA_REV') || '0';
  if (rev === '0') return null;
  const cache=CacheService.getScriptCache(), prefix='data:' + rev + ':', count=Number(cache.get(prefix+'count') || 0);
  if (count) {
    const keys=Array.from({length:count},(_,i)=>prefix+i), values=cache.getAll(keys);
    if (keys.every(k => values[k] != null)) return JSON.parse(keys.map(k=>values[k]).join(''));
  }
  const sheet=ss.getSheetByName(DATA_SHEET_), col=props.getProperty('DATA_SLOT') === 'B' ? 3 : 2;
  const chunks=sheet.getLastRow()>1 ? sheet.getRange(2,col,sheet.getLastRow()-1,1).getValues().map(r=>String(r[0])).filter(Boolean).map(v=>{
    if (!v.startsWith('j:')) throw new Error('저장 자료의 형식을 확인해 주세요.');
    return v.slice(2);
  }) : [];
  if (!chunks.length) throw new Error('저장 자료를 읽을 수 없습니다. 관리자 확인이 필요합니다.');
  const json=chunks.join(''), dataset=JSON.parse(json), values={};
  for (let i=0;i<json.length;i+=22000) values[prefix+(i/22000)] = json.slice(i,i+22000);
  values[prefix+'count']=String(Math.ceil(json.length/22000));
  try { cache.putAll(values,1800); } catch (_) { /* Sheets is authoritative. */ }
  return dataset;
}
function writeData_(ss,dataset) {
  const props=PropertiesService.getScriptProperties(), slot=props.getProperty('DATA_SLOT') === 'A' ? 'B' : 'A', col=slot==='A'?2:3;
  const json=JSON.stringify(dataset), chunks=[];
  for (let i=0;i<json.length;i+=22000) chunks.push(['j:'+json.slice(i,i+22000)]);
  const sheet=ss.getSheetByName(DATA_SHEET_);
  if (sheet.getMaxRows()<chunks.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),chunks.length+1-sheet.getMaxRows());
  if (sheet.getLastRow()>1) sheet.getRange(2,col,sheet.getLastRow()-1,1).clearContent();
  sheet.getRange(2,col,chunks.length,1).setNumberFormat('@').setValues(chunks);
  SpreadsheetApp.flush();
  props.setProperties({DATA_SLOT:slot,DATA_REV:Utilities.getUuid()});
  // Only the completed slot becomes current. The other slot is one overwrite recovery copy.
}
function readPlans_(ss) {
  const sheet=ss.getSheetByName(PLAN_SHEET_);
  if (sheet.getLastRow()<2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,5).getValues().filter(r=>r[0]).map(r=>JSON.parse(String(r[4])));
}
function planRow_(plan) { return [plan.id,plan.version,plan.status,plan.updatedAt,JSON.stringify(plan)]; }
function touchPlans_() { PropertiesService.getScriptProperties().setProperty('PLAN_REV',Utilities.getUuid()); }
function snapshot_(ss,known,auth) {
  const props=PropertiesService.getScriptProperties(), dataRev=props.getProperty('DATA_REV') || '0', planRev=props.getProperty('PLAN_REV') || '0';
  return {version:APP_VERSION_,role:auth.role,dataRev,planRev,
    dataset:String(known.dataRev)!==dataRev ? readData_(ss) : null,
    plans:String(known.planRev)!==planRev ? readPlans_(ss) : null,
    hasDataset:dataRev!=='0',frontendOrigin:auth.role==='admin'?(props.getProperty('FRONTEND_ORIGIN')||''):undefined};
}
function savePlan_(ss,payload,auth) {
  const props=PropertiesService.getScriptProperties();
  assertRevision_(payload.dataRev,props.getProperty('DATA_REV'));
  const ds=readData_(ss); if (!ds) throw new Error('먼저 시간표 자료를 등록해 주세요.');
  const raw=payload.plan || {}, plans=readPlans_(ss), id=String(raw.id || '');
  if (!/^p_[a-zA-Z0-9_-]{12,80}$/.test(id)) throw new Error('계획서 식별자가 올바르지 않습니다.');
  const index=plans.findIndex(p=>p.id===id), old=index>=0?plans[index]:null;
  const clean=CORE_.validatePlan(ds,plans,Object.assign({},raw,{id}));
  // A repeated create after an uncertain network response returns the original result.
  if (old && Number(raw.version)===0 && old.status==='active') {
    const comparable={}; Object.keys(clean).forEach(k=>{comparable[k]=old[k];});
    if (JSON.stringify(comparable)===JSON.stringify(clean)) return {plan:old,planRev:props.getProperty('PLAN_REV')};
  }
  if (old) {
    assertRevision_(raw.version,old.version);
    if (old.status!=='active') throw new Error('취소된 계획서는 새 계획서로 작성해 주세요.');
  } else if (Number(raw.version)!==0) throw new Error('계획서가 삭제되거나 변경되었습니다.');
  const now=new Date().toISOString(), plan=Object.assign({},clean,{id,version:old?old.version+1:1,status:'active',createdAt:old?old.createdAt:now,updatedAt:now,updatedRole:auth.role});
  if (JSON.stringify(plan).length>45000) throw new Error('계획서가 너무 큽니다. 나누어 저장해 주세요.');
  const sheet=ss.getSheetByName(PLAN_SHEET_);
  sheet.getRange(old?index+2:sheet.getLastRow()+1,1,1,5).setValues([planRow_(plan)]);
  SpreadsheetApp.flush(); touchPlans_();
  return {plan,planRev:props.getProperty('PLAN_REV')};
}
function cancelPlan_(ss,payload,auth) {
  const plans=readPlans_(ss), index=plans.findIndex(p=>p.id===payload.id);
  if (index<0) throw new Error('계획서를 찾지 못했습니다.');
  const plan=plans[index]; assertRevision_(payload.version,plan.version);
  plan.status='cancelled'; plan.version++; plan.updatedAt=new Date().toISOString(); plan.updatedRole=auth.role;
  ss.getSheetByName(PLAN_SHEET_).getRange(index+2,1,1,5).setValues([planRow_(plan)]);
  SpreadsheetApp.flush(); touchPlans_();
  return {plan,planRev:PropertiesService.getScriptProperties().getProperty('PLAN_REV')};
}
function restoreBackup_(ss,payload,auth) {
  const props=PropertiesService.getScriptProperties();
  assertRevision_(payload.dataRev,props.getProperty('DATA_REV')); assertRevision_(payload.planRev,props.getProperty('PLAN_REV'));
  const backup=payload.backup;
  if (!backup || backup.type!=='class-swap-backup' || backup.schema!==1 || !Array.isArray(backup.plans) || backup.plans.length>3000) throw new Error('복원 파일 형식을 확인해 주세요.');
  const ds=CORE_.validateDataset(backup.dataset), seen=new Set();
  const plans=backup.plans.map(p=>{
    if (!/^p_[a-zA-Z0-9_-]{12,80}$/.test(String(p.id)) || seen.has(p.id) || !['active','cancelled'].includes(p.status) || !Number.isInteger(p.version) || p.version<1 || !Array.isArray(p.items) || p.items.length>24 || JSON.stringify(p).length>45000) throw new Error('복원할 계획서 자료를 확인해 주세요.');
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(String(p.teacherA)) || !CORE_.text(p.teacherAName) || CORE_.text(p.teacherAName).length>40 || !CORE_.text(p.reason) || CORE_.text(p.reason).length>200 || !p.items.length) throw new Error('복원할 계획서의 교사·사유를 확인해 주세요.');
    CORE_.date(p.submitDate);
    const items=p.items.map(i=>{
      if (!['swap','cover'].includes(i.mode) || !/^[A-Za-z0-9_-]{1,50}$/.test(String(i.teacherB)) || !CORE_.text(i.teacherBName) || !CORE_.text(i.subjectA) || !CORE_.text(i.roomA) || !Number.isInteger(i.periodA) || i.periodA<1 || i.periodA>12 || !Number.isInteger(i.periodB) || i.periodB<1 || i.periodB>12 || CORE_.dayOf(i.dateA)>4 || CORE_.dayOf(i.dateB)>4) throw new Error('복원할 계획서의 수업 정보를 확인해 주세요.');
      if (i.mode==='swap' && (!CORE_.text(i.subjectB) || !CORE_.text(i.roomB))) throw new Error('교체 수업 정보를 확인해 주세요.');
      if (i.mode==='cover' && (i.dateA!==i.dateB || i.periodA!==i.periodB)) throw new Error('보강 날짜·교시를 확인해 주세요.');
      const v={mode:i.mode,dateA:i.dateA,periodA:i.periodA,subjectA:CORE_.text(i.subjectA).slice(0,100),roomA:CORE_.text(i.roomA).slice(0,80),teacherB:i.teacherB,teacherBName:CORE_.text(i.teacherBName).slice(0,40),dateB:i.dateB,periodB:i.periodB};
      if (i.mode==='swap') { v.subjectB=CORE_.text(i.subjectB).slice(0,100); v.roomB=CORE_.text(i.roomB).slice(0,80); }
      return v;
    });
    seen.add(p.id); return {id:p.id,version:p.version,status:p.status,teacherA:p.teacherA,teacherAName:CORE_.text(p.teacherAName),reason:CORE_.text(p.reason),submitter:CORE_.text(p.submitter).slice(0,40),submitDate:p.submitDate,items,createdAt:CORE_.text(p.createdAt).slice(0,40),updatedAt:CORE_.text(p.updatedAt).slice(0,40),updatedRole:'admin'};
  });
  CORE_.validateExisting(ds,plans,today_());
  const oldPlans=readPlans_(ss), oldSlot=props.getProperty('DATA_SLOT'), oldRev=props.getProperty('DATA_REV');
  props.setProperty('MAINTENANCE','restore');
  try {
    writeData_(ss,ds); writeAllPlans_(ss,plans); touchPlans_(); props.deleteProperty('MAINTENANCE');
  } catch (error) {
    try {
      // Data uses alternate slots, so roll back its pointer rather than rewriting bytes.
      props.setProperties({DATA_SLOT:oldSlot||'',DATA_REV:oldRev||'0'});
      writeAllPlans_(ss,oldPlans); touchPlans_(); props.deleteProperty('MAINTENANCE');
    } catch (_) { throw new Error('복원을 완료하지 못했습니다. 기존 자료가 남아 있으므로 관리자 점검이 필요합니다.'); }
    throw error;
  }
  return snapshot_(ss,{},auth);
}
function writeAllPlans_(ss,plans) {
  const sheet=ss.getSheetByName(PLAN_SHEET_);
  if (sheet.getMaxRows()<plans.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),plans.length+1-sheet.getMaxRows());
  if (sheet.getLastRow()>1) sheet.getRange(2,1,sheet.getLastRow()-1,5).clearContent();
  if (plans.length) sheet.getRange(2,1,plans.length,5).setValues(plans.map(planRow_));
  SpreadsheetApp.flush();
}
