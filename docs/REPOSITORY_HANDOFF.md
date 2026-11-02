# cheomdancs 저장소 반영 안내

확인 기준일: 2026-11-02.

| 항목 | 확인 결과 |
|---|---|
| 원격 | https://github.com/cosmicjh/cheomdancs.git |
| 기본 브랜치 | main |
| 확인한 기존 main 커밋 | 71fa0e09fe5d3e4e51aa262bacff3ec65d83d151 |
| 전환 브랜치 | codex/cloudflare-workers-migration |
| 로컬 체크아웃 | cheomdancs 전용 폴더 |
| 프로젝트 Root directory | / |
| Build / Deploy | npm run build / npm run deploy |

기존 저장소는 index.html(수업 교체 및 결·보강 계획서 작성)과 cs_tt.html(수업 교체 및 결·보강 도우미) 두 화면입니다. 최근 커밋은 2026-08-14이고 제공된 전환 기준 소스는 2026-10-29이므로 새 기준 소스가 더 최신입니다. 기존 화면은 localStorage/sessionStorage로 작성 내용을 교환하며 cs_tt에는 인코딩된 시간표가 내장되어 있습니다. 기존 파일을 새 Worker의 공개 자산으로 배포하지 않습니다.

원본 두 파일은 기존 main과 Git 이력에 그대로 남아 있습니다. 로컬 비교용 사본과 SHA-256 목록은 Git 제외 경로 private-data/repository-original/에 보존했습니다. 이 사본을 새 브랜치에 중복 공개하지 않습니다. 기존 작성 내용은 각 사용자 브라우저 저장소에 있을 수 있으며 Git 저장소만으로 존재 여부나 최신 상태를 확인할 수 없습니다. 운영 계획서 이관이 완료되었다고 간주하지 않습니다.

이 브랜치에서는 두 루트 HTML을 제거하고 src/client 편집 원본 → Node 빌드 → public/ 구조로 교체합니다. 기존 main·Pages 운영 설정·다른 도구는 변경하지 않습니다. Git 이력 자체를 지우거나 강제 push하지 않습니다.

## 검토·운영 연결

1. codex/cloudflare-workers-migration을 검토하고 GitHub Actions 결과를 확인합니다. 워크플로는 비공개 초기 JSON·Secrets 없이 설치·빌드·공통/D1·Wrangler 로컬 검증을 실행하며 원격 배포·DB 입력을 하지 않습니다.
2. main에 병합한 뒤 Cloudflare Workers Builds에서 cosmicjh/cheomdancs, production branch main, Root directory /, Build npm run build, Deploy npm run deploy를 지정합니다. 병합 전 main에는 아직 Workers 코드가 없습니다.
3. wrangler.jsonc의 제안 이름 class-swap을 실제 Worker와 대조하고 DB 바인딩 DB에 결보강 전용 D1의 실제 ID를 반영합니다. all-zero ID는 로컬 전용이며 배포 검사가 거부합니다.
4. Runtime Secrets INITIAL_TEACHER_PASSWORD / INITIAL_ADMIN_PASSWORD를 설정합니다. 실제 비밀값은 Git이나 문서에 기록하지 않습니다.
5. [DEPLOYMENT.md](DEPLOYMENT.md)와 [MIGRATION.md](MIGRATION.md)의 원격 스키마·검증·최신 백업 우선 이관을 별도로 수행합니다.

GitHub 코드 반영, 실제 Cloudflare 배포, 운영 데이터 이관은 별개입니다. 실제 배포·원격 이관은 이번 저장소 연결 단계에서 실행하지 않습니다. URL과 Worker·D1 실값이 검증되기 전에는 운영 완료로 표시하지 않습니다.

## 전용 체크아웃 검증

2026-11-02 전용 폴더에서 npm ci와 Node 공개 빌드를 실행하고 npm test 41건 전체 통과를 확인했습니다(실행 시간 약 95초). 실제 Wrangler 로컬 마이그레이션·정적 자산·API JSON 오류·비공개 파일 차단·deploy dry-run도 통과했습니다. 비공개 초기 JSON은 일반 빌드·테스트 입력이 아니며 가상 fixture를 사용합니다. Git 반영 대상 57개 추가 파일에 실제 교사명과 비공개 경로가 없고, 참고 원본 14개 파일은 manifest의 SHA-256과 일치합니다. 기존 두 루트 파일 삭제를 포함한 변경은 전환 브랜치에만 적용합니다. GitHub Actions 원격 실행 결과는 별도로 확인해야 하며 로컬 통과를 원격 CI 통과로 간주하지 않습니다.

GitHub 최초 push 커밋 9cbf7821ca5e292f2b3ffcdd3bd0a0d83c5ed51e의 [원격 CI](https://github.com/cosmicjh/cheomdancs/actions/runs/41374072013)는 success로 확인했습니다. GitHub의 깨끗한 Ubuntu/Node 24 환경에서 npm ci, 공개 빌드, 전체 41개 테스트, Wrangler 검증이 모두 통과했습니다. 이후 API 시험 fixture는 실행일 기준 2주 뒤 월요일을 사용하도록 하여 시간이 지난 뒤에도 미래 계획 충돌 검사 의미를 유지합니다.
