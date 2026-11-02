# Cloudflare 배포·브랜치 설정

현재 서비스와 실제 검증 결과는 [DEPLOYED_2026-11-02.md](DEPLOYED_2026-11-02.md)를 기준으로 확인합니다.

| 항목 | 현재 값 |
|---|---|
| 서비스 | https://class-swap.cosmicjh.workers.dev |
| 소스 저장소 | cosmicjh/cheomdancs |
| 현재 검증 브랜치 | codex/cloudflare-workers-migration |
| main | 사용자 정상 작동 확인 후 전환. 이번 작업에서는 미변경 |
| Root directory | / |
| Build command | npm run build |
| Deploy command | npm run deploy |
| Worker / 설정 | class-swap / wrangler.jsonc |
| 진입점 | src/worker.js |
| Static Assets | ./public, ASSETS 바인딩, /api와 /api/* Worker 우선 |
| D1 | class-swap-db, DB 바인딩, d4e9d2e3-35cb-475f-b128-c78d714cd354 |
| Runtime Secrets | INITIAL_TEACHER_PASSWORD, INITIAL_ADMIN_PASSWORD |
| 자동 Preview | 비활성. 분리 DB 준비 전 활성화하지 않음 |

## 현재 배포와 반복 배포

현재는 검증 브랜치에서 Wrangler로 직접 배포했습니다. GitHub Actions는 설치·빌드·공통/D1·Wrangler 검증을 실행하며 원격 DB 변경·배포는 하지 않습니다.

검증 브랜치의 변경을 배포할 때 다음 순서로 실행하고 실제 반환 URL·버전을 기록합니다.

```powershell
git branch --show-current
npm ci
npm run build
npm test
npm run test:browser
npm run deploy:check
npm run deploy:dry-run
npm run deploy
```

main으로 바꾸거나 기존 Worker·DB 이름을 임의로 바꾸지 않습니다. 배포 중 빌드에 운영 자료 입력이나 DB 초기화를 묶지 않습니다. 스키마 변경이 있을 때만 별도로 npm run db:migrate:remote를 실행합니다. 최신 운영 백업 이관·복구는 [MIGRATION.md](MIGRATION.md)를 따릅니다.

Runtime Secrets는 Cloudflare의 Worker Settings → Variables & Secrets 또는 Wrangler secret 명령으로 관리합니다. 비밀번호 값은 Git·HTML·빌드 전용 환경변수에 넣지 않습니다. 기존 역할 비밀번호는 D1에 저장되므로 초기 Secret 재설정으로 바뀌지 않고 관리자 화면에서 변경합니다.

## GitHub 자동 빌드 연결

현재 Wrangler OAuth는 Builds API에 403을 반환하여 자동 연동은 미설정입니다. [공식 Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)는 사용자 범위 API token의 Workers Builds Configuration Edit와 Worker tag 조회용 Workers Scripts Read 권한을 안내합니다.

Cloudflare 대시보드에서 class-swap → Settings → Builds → Connect GitHub로 cosmicjh/cheomdancs를 선택합니다. 검증 기간 production branch는 codex/cloudflare-workers-migration, Root /, Build npm run build, Deploy npm run deploy입니다. Preview는 비활성화합니다. 별도 Runtime Secrets와 DB 바인딩은 위 실제 리소스를 유지합니다. main을 먼저 선택하지 않습니다.

## 정상 확인 후 main 전환

사용자가 전환을 결정한 뒤 현재 브랜치 변경을 검토·병합하고 배포 소스를 main으로 바꿉니다. 같은 Worker·D1을 유지하여 시간표·계획·취소 이력·비밀번호가 보존되도록 합니다. DB 초기 입력·기존 자료 덮어쓰기·Pages 리소스 삭제를 자동으로 수행하지 않습니다.

## 검증 명령

```powershell
node scripts/verify-remote.mjs https://class-swap.cosmicjh.workers.dev
npm run data:verify -- legacy/private-data/initial-data.json --remote
```

원격 검증은 비공개 로컬 접속 설정을 읽고 검증된 동일 URL에만 보냅니다. 기본 실행은 조회·인증 확인이며, --exercise는 새 전용 DB의 계획 0건과 입력 해시를 확인한 경우에만 자체 시험 계획을 저장·정리합니다. 운영 계획이 생긴 뒤에는 쓰기 시험을 실행하지 않습니다. 일반 CI에서는 원격 검증을 실행하지 않습니다.
