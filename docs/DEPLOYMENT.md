# GitHub · Cloudflare Workers 배포 안내

확인 기준일: 2026-11-02. 기존 도구의 Pages 배포를 삭제·수정하지 않는 별도 Workers 앱입니다.

## 확인된 설정과 미정값

| 항목 | 현재 파일 / 필요한 작업 |
|---|---|
| 실제 GitHub 저장소 | https://github.com/cosmicjh/cheomdancs.git, 기본 브랜치 main, 확인한 기존 main 커밋 71fa0e09fe5d3e4e51aa262bacff3ec65d83d151 |
| 결보강 작업·운영 브랜치 | 작업: codex/cloudflare-workers-migration. 운영: 검토 후 main에 병합하여 연결. 현재 main에는 기존 두 HTML만 있으므로 병합 전 main으로 Workers Builds를 연결하지 않음 |
| Root directory | / — package.json과 wrangler.jsonc가 저장소 루트에 있음 |
| Worker 이름 | `wrangler.jsonc`의 `class-swap`은 신규 이름 제안. 기존 대시보드와 일치 여부 미확인. 이미 결보강 Worker가 있으면 그 실제 이름을 확인 후 반영 |
| Worker 진입점 | `src/worker.js` |
| Static Assets | `./public`, 바인딩 `ASSETS`, `/api`, `/api/*` Worker 우선, SPA fallback 없음 |
| D1 | 바인딩 `DB`, 제안 이름 `class-swap-db`; ID는 전부 0인 로컬 시험값이므로 실제 전용 DB ID로 교체 필요 |
| compatibility_date | 설치된 Wrangler/workerd에서 실행 가능한 `2026-07-30` 고정 |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (`check-deploy.mjs` 확인 후 `wrangler deploy`) |
| Runtime Secrets | `INITIAL_TEACHER_PASSWORD`, `INITIAL_ADMIN_PASSWORD` — 비밀값은 문서·Git에 기록하지 않음 |
| 자동 Preview | `preview_urls:false`. 별도 DB/환경이 준비되기 전 Git 분기 Preview 빌드를 비활성화. 운영 D1을 연결하지 않음 |

현재 설정에는 Pages용 출력 옵션·Functions·배포 명령이 없습니다. 원래 작업 폴더의 Pages 프로젝트 course-allocation, DB course-allocation-db 및 개인시간표 도구는 별개이며 변경하지 않았습니다. 기존 문서에 다른 도구의 실제 Pages 배포 이력이 있지만, 결보강 Pages 프로젝트의 존재·원격 상태는 확인되지 않았습니다.

## 최초 배포 절차

아래 명령은 모두 이 프로젝트 루트에서 실행합니다. Wrangler는 package-lock의 고정 버전을 사용합니다. 이 작업에서는 원격 자원 생성·스키마 적용·Secrets 설정·배포를 실행하지 않았습니다.

```powershell
npm ci
node scripts/wrangler.mjs login
node scripts/wrangler.mjs whoami
node scripts/wrangler.mjs d1 list
# 전용 DB가 없는 것을 확인했을 때만 생성합니다.
node scripts/wrangler.mjs d1 create class-swap-db
```

응답의 실제 `database_id`를 `wrangler.jsonc`에 반영하고 대시보드의 Worker 이름·DB 이름을 대조합니다. 다른 도구의 ID를 복사하지 않습니다. `npm run deploy:check`는 로컬 시험 ID를 거부합니다. 이 검사는 대시보드 실재 여부를 증명하지 않으므로 조회 결과도 확인해야 합니다.

```powershell
npm run deploy:check
npm run db:migrate:remote
node scripts/wrangler.mjs secret put INITIAL_TEACHER_PASSWORD
node scripts/wrangler.mjs secret put INITIAL_ADMIN_PASSWORD
npm run build
npm run deploy:dry-run
npm run deploy
```

초기값 `1234`를 유지하려면 위 두 Secret의 보호된 입력 경로에 직접 설정합니다. 공개 JavaScript는 비밀번호를 비교하지 않습니다. DB에 이미 설정된 역할 비밀번호는 초기 Secret을 바꿔도 재설정되지 않습니다. 첫 로그인에서만 무작위 salt의 PBKDF2 해시를 만들고, 이후 변경은 관리자 화면에서 수행합니다. 구형 Apps Script 비밀번호·세션을 추정하여 이전하지 않습니다.

GitHub 연동 Workers Builds에서는 cosmicjh/cheomdancs를 선택하고 전환 브랜치를 검토·병합한 뒤 배포 브랜치 main, Root directory /, 위 Build/Deploy 값을 입력합니다. Runtime Secrets는 Worker의 **Settings → Variables & Secrets**에 입력하며 Build variables와 구분합니다. 다른 도구가 있는 저장소를 선택하려면 Root directory와 빌드 감시 경로를 결보강 폴더로 한정하고 기존 설정을 검토해야 합니다.

자료 이관은 빌드·배포와 분리합니다. [이관 문서](MIGRATION.md)의 최신 백업 우선 원칙으로 빈 전용 DB에만 입력하고 정확히 검증합니다. 배포 성공만으로 운영 데이터 이관을 완료 처리하지 않습니다.

## 배포 후 확인

Wrangler가 실제 반환한 URL에서 `/`, `/app.js`, `/api/health`와 알 수 없는 `/api/*`의 JSON 404를 확인합니다. 미인증 자료 조회 401, 교사 관리자 API 403, 로그인·재개·저장·다른 브라우저 조회·수정·취소·인쇄·비밀번호 변경을 검증합니다. 로그인 전 소스에 교사명·시간표 JSON이 없어야 합니다. 인증 응답은 `no-store`, HTTPS 쿠키는 HttpOnly·Secure·SameSite=Strict여야 합니다.

Production CPU, D1 Metrics, 로그의 `exceededCpu`·5xx를 확인합니다. 현재 로컬 통과 결과만으로 운영 CPU나 무료 요금제 적합성을 확정할 수 없습니다.

## 비용·한도 추정과 출처

공식 무료 한도는 Workers 동적 요청 하루 100,000건·요청 CPU 10ms, D1 읽기 하루 5,000,000행·쓰기 100,000행·총 저장 5GB입니다. 예를 들어 하루 인증 조회 1,000회, 저장 계획서 최대 3,000건이면 매번 전체 계획을 읽는 현재 방식은 계획 읽기 약 300만 행에 인증 조회 등을 더합니다. 저장 100건/일, 각 24개 교체 내역이면 예약 쓰기만 최대 9,600행이고 수정·삭제·인증·인덱스 쓰기가 추가됩니다. 최대 규모를 넘어서는 운영량은 별도 측정이 필요합니다. PBKDF2 100,000회 비용과 큰 백업 복원의 CPU는 원격 측정 전이며 무료 운영을 보장하지 않습니다.

- [Workers Static Assets 바인딩·라우팅](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers Builds 구성·Runtime Secrets와 Build variables](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Workers 요청·CPU 한도](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 요금·무료 한도](https://developers.cloudflare.com/d1/platform/pricing/)
