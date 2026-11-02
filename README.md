# 수업 결·보강 도우미 — Workers + D1

실제 검증 서비스: https://class-swap.cosmicjh.workers.dev — 현재 codex/cloudflare-workers-migration 브랜치 소스이며 main은 유지합니다. [배포·검증 결과](docs/DEPLOYED_2026-11-02.md)를 확인하세요.

기존 Google 기반 결보강 화면·업무 규칙을 유지하며, GitHub 소스 관리 + Cloudflare Workers Static Assets + 같은 출처 `/api` + D1으로 실행·저장을 교체한 독립 앱입니다. 프레임워크·별도 Node 서버·ORM·KV·R2는 사용하지 않습니다.

전용 저장소는 https://github.com/cosmicjh/cheomdancs 이며 프로젝트 루트는 저장소의 /입니다. 전환 작업 브랜치는 codex/cloudflare-workers-migration이고 기존 main은 검토 전까지 그대로 유지합니다. 검증 기간에는 이 전환 브랜치를 그대로 배포하며 main은 변경하지 않습니다. 사용자 확인 후에만 main으로 전환합니다. 다른 도구의 저장소·DB·배포를 재사용하지 않습니다.

## 로컬 실행

Node 22 이상과 npm을 사용합니다. 패키지 잠금 파일을 포함합니다.

```powershell
git clone --branch codex/cloudflare-workers-migration https://github.com/cosmicjh/cheomdancs.git
cd cheomdancs
npm ci
node scripts/setup-local.mjs
npm run build
npm run db:migrate:local
npm run data:check -- legacy/private-data/initial-data.json
npm run data:import -- legacy/private-data/initial-data.json --local
npm run data:verify -- legacy/private-data/initial-data.json --local
npm run dev
```

로컬 주소는 `http://127.0.0.1:8790`입니다. `setup-local.mjs`는 가상 로컬 초기값만 주입하며 기존 설정을 덮어쓰지 않습니다. 운영에서는 Runtime Secrets를 별도로 설정합니다. 비공개 초기 JSON이 없어도 `npm ci`, 빌드 및 일반 테스트는 실행됩니다. 개인 자료 입력 명령만 별도 파일이 필요합니다.

```powershell
npm test
npm run test:worker
npm run test:browser
npm run deploy:dry-run
```

Windows 브라우저 검증은 설치된 Edge를 사용합니다. 다른 환경은 Playwright Chromium을 준비하거나 `PLAYWRIGHT_CHANNEL`을 지정합니다. 로컬 workerd/브라우저는 127.0.0.1 연결이 가능한 실행 권한이 필요합니다.

## 편집·생성·비공개 파일

| 경로 | 역할 / GitHub 포함 여부 |
|---|---|
| `src/client/index.html`, `app.js` | 화면·내장 Pretendard Variable·인쇄·브라우저 동작의 편집 원본 / 포함 |
| `src/shared/core.js` | 브라우저와 Worker가 함께 사용하는 순수 규칙 / 포함 |
| `src/shared/backup.js` | 백업 정규화·이관 검증 / 포함 |
| `src/worker.js`, `src/server/` | API·권한·쿠키·KDF·원자적 D1 변경 / 포함 |
| `migrations/` | 개인정보 없는 스키마·제약·초기 입력 트리거 / 포함 |
| `scripts/`, `tests/`, `docs/` | 빌드·이관 도구·가상 fixture·검증·안내 / 포함 |
| `package.json`, `package-lock.json`, `wrangler.jsonc`, 빈 설정 예시 | 재현 가능한 설치·Workers 구성 / 포함 |
| `legacy/` | 원본 참고 자료·구형 테스트·라이선스 / private-data 제외 포함 가능, 실행·배포에는 사용하지 않음 |
| `public/` | Node 빌드 결과, 공개 파일 7개만 허용 / Git 제외, Static Assets에만 제공 |
| `legacy/private-data/`, `private-data/`, `backups/` | 실제 교사 자료·최신 운영 백업·일시 SQL / Git·정적 배포 제외 |
| `.dev.vars`, `.env*`, `.wrangler/`, `test-results/`, `node_modules/` | Secrets·로컬 DB·비공개 실행 자료 / 제외 |

`npm run build`는 Python이나 비공개 JSON을 읽지 않습니다. `public/index.html`을 직접 편집하지 마세요. 공식 Pretendard Variable v1.3.9 원본을 Base64로 내장하고 OFL 고지를 유지하며 별도 글꼴 폴더를 추가하지 않았습니다. SheetJS는 로컬 공개 자산으로 제공하며 해당 라이선스를 포함합니다.

## 운영 준비 문서

- [전용 저장소 반영과 인수 안내](docs/REPOSITORY_HANDOFF.md)
- [배포 설정과 확인 절차](docs/DEPLOYMENT.md)
- [초기 입력·최신 백업 이관·복구](docs/MIGRATION.md)
- [인증·D1 원자성 설계](docs/ARCHITECTURE.md)
- [실행 결과와 완료 상태](docs/VALIDATION.md)

코드·로컬 실행 완료는 실제 배포나 운영 계획서 이관 완료를 뜻하지 않습니다. 마지막 문서에서 네 상태를 구분합니다.
