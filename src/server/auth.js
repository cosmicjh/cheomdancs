import {ApiError, invalid} from './errors.js';
import {derive, equal, random, sha256} from './crypto.js';
const lifetime = 6 * 60 * 60 * 1000;
export const roles = ['teacher', 'admin'];
export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 100) invalid('비밀번호는 4–100자로 입력해 주세요.');
  return value;
}
function cookie(request, token, expires = 21600) {
  return `class_swap_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export const clearCookie = request => cookie(request, '', 0);
export async function authorize(request, db) {
  const token = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('class_swap_session='))?.slice(19) || '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const tokenHash = await sha256(token);
  const auth = await db.prepare('SELECT s.* FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=? AND s.expires>?').bind(tokenHash, Date.now()).first();
  if (!auth) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 만료되었습니다. 작성 내용은 유지됩니다. 다시 로그인해 주세요.');
  return {...auth, tokenHash};
}
export async function newSession(db, request, role, epoch, extra = []) {
  const token = random();
  const results=await db.batch([...extra, db.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),
    db.prepare('INSERT INTO sessions(token_hash,role,epoch,expires) SELECT ?,role,epoch,? FROM credentials WHERE role=? AND epoch=?')
      .bind(await sha256(token), Date.now() + lifetime, role, epoch)]);
  if(results.at(-1).meta.changes!==1) throw new ApiError(401,'AUTH_REQUIRED','인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
  return cookie(request, token);
}
export async function login(env, request, payload) {
  if (!roles.includes(payload.role)) invalid('로그인 역할을 확인해 주세요.');
  const role = payload.role, password = passwordValue(payload.password), now = Date.now();
  const key = await sha256(role + ':' + (request.headers.get('CF-Connecting-IP') || 'local'));
  const limit = await env.DB.prepare(`INSERT INTO login_limits(key,count,until_ms) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_ms<=? THEN 1 ELSE count+1 END,
    until_ms=CASE WHEN until_ms<=? THEN excluded.until_ms ELSE until_ms END RETURNING count`).bind(key, now + 600000, now, now).first();
  if (limit.count > 12) throw new ApiError(429, 'RATE_LIMITED', '로그인 시도가 반복되었습니다. 10분 후 다시 시도해 주세요.');
  let credential = await env.DB.prepare('SELECT * FROM credentials WHERE role=?').bind(role).first();
  if (!credential) {
    const initial = env[role === 'admin' ? 'INITIAL_ADMIN_PASSWORD' : 'INITIAL_TEACHER_PASSWORD'];
    if (typeof initial !== 'string' || initial.length < 4 || initial.length > 100) throw new ApiError(503, 'NOT_READY', '관리자가 초기 비밀번호를 설정해야 합니다.');
    const salt = random(16);
    await env.DB.prepare('INSERT INTO credentials(role,salt,digest,epoch) VALUES(?,?,?,?) ON CONFLICT(role) DO NOTHING')
      .bind(role, salt, await derive(initial, salt), random(16)).run();
    credential = await env.DB.prepare('SELECT * FROM credentials WHERE role=?').bind(role).first();
  }
  if (!equal(await derive(password, credential.salt), credential.digest)) throw new ApiError(401, 'INVALID_PASSWORD', '비밀번호를 확인해 주세요.');
  const setCookie = await newSession(env.DB, request, role, credential.epoch, [env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(key)]);
  return {role, setCookie};
}
export async function changePassword(db, request, auth, payload) {
  if (!roles.includes(payload.role)) invalid('변경할 역할을 확인해 주세요.');
  const salt = random(16), epoch = random(16), digest = await derive(passwordValue(payload.password), salt);
  // Credential rotation and session removal share one transaction. Concurrent old requests are guarded too.
  const guard = random(16), statements = [db.prepare(`INSERT INTO mutation_guard(id,valid) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM credentials c JOIN sessions s ON s.role=c.role AND s.epoch=c.epoch
    WHERE s.token_hash=? AND c.role='admin' AND s.expires>?) THEN 1 ELSE 0 END)`).bind(guard, auth.tokenHash, Date.now()),
    db.prepare(`INSERT INTO credentials(role,salt,digest,epoch) VALUES(?,?,?,?) ON CONFLICT(role) DO UPDATE SET salt=excluded.salt,digest=excluded.digest,epoch=excluded.epoch`).bind(payload.role,salt,digest,epoch),
    db.prepare('DELETE FROM sessions WHERE role=?').bind(payload.role), db.prepare('DELETE FROM mutation_guard WHERE id=?').bind(guard)];
  if (payload.role === 'admin') return newSession(db, request, 'admin', epoch, statements);
  await db.batch(statements); return null;
}
