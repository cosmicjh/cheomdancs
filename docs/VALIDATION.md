> 최초 전환·로컬 검증 기록입니다. 2026-11-02 후속 실제 배포·프리텐다드/모노톤 변경·원격 검증은 [DEPLOYED_2026-11-02.md](DEPLOYED_2026-11-02.md)가 최신 기준입니다.

# 전환 구현·검증 결과 — 2026-11-02

## 완료 상태

| 구분 | 결과 |
|---|---|
| 코드 구현 | 완료. 결보강 전용 cosmicjh/cheomdancs 저장소 루트. 기존 다른 도구의 코드·DB·배포 설정 유지 |
| 로컬 실행·실제 D1 검증 | 완료. 공통 규칙·인증·동시성·롤백·이관·PC/모바일·인쇄 설정 검증 |
| 실제 Cloudflare 배포 | 미실행. GitHub 전용 저장소와 작업 브랜치 확인 완료. 결보강 Worker·D1의 실제 이름/ID 미확정. 검증된 운영 URL 없음 |
| 운영 데이터 이관 | 미완료·존재 여부 미확인. 제공된 기본 자료만 로컬 입력. 최신 class-swap-backup 미제공, 원격 DB 입력 미실행 |

## 구현 범위와 원본 보존

- 기존 교사/관리자 공용 비밀번호, 시간표 대조·후보·교체/보강·계획 1–24건·저장/수정/취소·검색·관리자 가져오기/편집/내보내기/복원·인쇄 화면을 보존했습니다.
- Google 런타임·숨은 중계·사이트 출처 설정을 같은 출처 /api와 HttpOnly 쿠키, PBKDF2, D1으로 교체했습니다. UI는 내장 Schedule Sans/OFL·모노톤·우측 하단 관리자 링크를 유지합니다.
- D1 CHECK guard와 전체 revision, 예약 복합 기본키, batch로 동시 변경을 검사합니다. SQL 오류가 나면 계획·예약·리비전이 함께 롤백됩니다. CLI 초기 입력은 문서별 staging과 단일 SQL trigger로 반영합니다.
- 원본 15개 파일의 SHA-256이 SOURCE_MANIFEST.json과 모두 일치합니다. 이 manifest의 구현 전 false 표시는 원본 전달 당시 기록이며 현재 완료 상태는 이 문서가 기준입니다.
- 최초 검증은 course-allocation/class-swap-cloudflare에서 진행했고 다른 도구는 보존했습니다. 이후 사용자 지정 전용 저장소 https://github.com/cosmicjh/cheomdancs.git를 별도 체크아웃하고 codex/cloudflare-workers-migration 브랜치를 준비했습니다. 기존 main 변경·강제 push·DB 재사용은 하지 않았습니다.

## 실제 실행한 명령과 결과

이 PC에는 전역 npm 명령이 없어 설치된 pnpm으로 npm@11을 실행했습니다. npm 자체가 package-lock 생성·ci·test·dev 스크립트를 실행합니다. 문서의 npm 명령은 동일 package.json 스크립트입니다. Node v24.22.1, npm 11.21.1, Wrangler 4.154.0, compatibility_date 2026-07-30을 사용했습니다. 의존성을 별도 node_modules에 npm ci로 설치했습니다.

| 실행 | 결과 |
|---|---|
| npm install --package-lock-only --ignore-scripts --no-audit --no-fund | 성공, 실제 npm 잠금 파일 생성 |
| npm ci --no-audit --no-fund | 성공, 프로젝트 전용 설치 |
| node scripts/build.mjs | 성공, 공개 자산 7개. 반복 빌드 SHA-256 동일 |
| npm test | 당시 전체 40건 통과: 이전한 공통 21건 + 실제 workerd D1 통합 19건 |
| node --test --test-name-pattern="password rotation|initial dataset|initial import trigger" tests/api.test.mjs | 최종 세션 발급 검사 보완 후 관련 3건 통과 |
| node --test --test-name-pattern="initial dataset|initial import trigger|large backup|data revisions|save versus" tests/api.test.mjs | 최종 입력 스키마 보완 후 관련 5건 통과. 신규 큰 백업 시험을 포함하여 현재 공개 테스트는 41건 |
| node legacy/tests/core.test.cjs | 제공된 실제 기본 자료로 원본 공통 21건 통과 |
| node legacy/tests/server.test.cjs | 원본 Apps Script 모의 테스트 18건 통과. 새 D1 검증과 구분 |
| node tests/wrangler.mjs | 실제 CLI 버전·깨끗한 로컬 마이그레이션·deploy --dry-run·wrangler dev --local·ASSETS/DB·JSON API 오류·비공개 파일 404 통과 |
| node tests/browser.mjs | 설치된 Edge에서 7단계 통과, pageerror 0건 |
| node scripts/wrangler.mjs d1 migrations apply DB --local | 0001과 0002 실제 로컬 적용 성공 |
| node scripts/data.mjs check legacy/private-data/initial-data.json | 스키마·집계·보호 규칙 검증 성공 |
| node scripts/data.mjs import legacy/private-data/initial-data.json --local | 초기 자료 실제 로컬 입력·정확 대조 성공 |
| 같은 import 명령 재실행 | Already imported, DB 미변경 |
| node scripts/data.mjs verify legacy/private-data/initial-data.json --local | 시간표·계획·예약 집합 정확 일치 |
| node scripts/check-deploy.mjs | 시험용 all-zero D1 ID를 정상 거부. 실제 배포를 실행한 결과가 아님 |
| git check-ignore / 미추적 파일 목록 확인 | 실제 JSON·.dev.vars·로컬 DB·public·test-results가 Git 대상에서 제외됨 |

초기 로컬 실행은 샌드박스의 127.0.0.1 연결 차단으로 실패했고, 허용된 실행 환경에서 다시 검증했습니다. 크기 제한 테스트는 실제 본문 크기를 보내도록 수정했고, 화면 테스트는 저장 응답 지연과 작성 내용 보존 확인창을 제어한 뒤 통과했습니다. 실패한 초기 실행을 통과 건수로 세지 않았습니다.

## D1·브라우저 검증 내용

- 미인증 401, 교사 관리자 API 403, 역할 위조 차단, 동일 출처·JSON·8MiB 상한, API 하위 경로 JSON 404, no-store, HTTPS Secure/HttpOnly/SameSite 쿠키.
- 로그인·재개·로그아웃·비밀번호 변경·역할별 기존 세션 무효화·관리자 새 쿠키, 초기 Secret의 기존 비밀번호 덮어쓰기 방지, DB 영속 로그인 제한.
- 두 계획의 동일 시각 동시 저장은 200/409 한 쌍, 계획 1건·예약 4칸·리비전 1회 증가. 같은 버전 동시 수정도 한쪽만 적용하고 패자의 요청이 예약을 지우지 않음.
- 동일 생성 재시도는 같은 결과, 다른 내용의 같은 ID는 409. 같은 계획 중복 내역 차단, 보강 두 칸·교체 네 칸, 취소 이력과 예약 해제.
- 저장/시간표 교체 경합, stale revision guard의 CHECK 오류, 예약 UNIQUE 오류, 저장·자료 교체·전체 복원·초기 입력의 중간 실패에 대한 실제 D1 롤백.
- 초기 자료와 백업 입력·재실행, 취소·과거 스냅샷 보존. 큰 가상 백업 3,361,877바이트·취소 계획 100건을 SQL 202개로 준비한 후 단일 trigger에서 입력, staging 정리 확인. 실제 운영 계획서 이관 건수와 무관한 가상 시험입니다.
- PC 1440px의 두 시간표 행 정렬 오차 1px 이하, 390px 모바일 세로 배치와 페이지 가로 넘침 없음. 후보→추가→저장→별도 브라우저 조회/수정/취소.
- 추가 후 결강일/교체 주간 유지, 저장 오류 후 작성 내용·입력 복구, 처리 중 입력 잠금, 세션 만료 후 재로그인해 작성 내용 유지.
- 계획 9개 내역의 8개 단위 2페이지 구분, A4 portrait, 공지 9개와 A4 landscape 설정 확인. 실제 프린터 출력 검증은 별도입니다.

## 실제 기본 자료 입력 결과

| 항목 | 로컬 입력 결과 |
|---|---:|
| 교사 | 64명 |
| 주간 운영 교시 | 34개 |
| 배정 셀 | 1,149개 |
| 선택과목 규칙 | 54개 |
| 창체 / 선택 / 배정 공강 / 일반 / 연속 / 확인 | 128 / 497 / 21 / 489 / 12 / 2 |
| 계획서 / 취소 이력 / 예약 | 0 / 0 / 0 |

수요일 7교시 미운영, 중문I 2시간 확인 대상과 내부 2025·파일명 2026 경고를 보존했습니다. 정규화 입력 내용 SHA-256은 89f61aab0e9e17a48a79f1a1f9f21049cc37ae953979049055c05d8fe7ed3724입니다. 이 집계는 제공된 초기 JSON의 결과이며 기존 서비스의 저장 계획서가 없다는 근거가 아닙니다.

## 공개 대상·배포 값·남은 검증

public에는 index.html, app.js, core.js, xlsx.full.min.js, 라이선스 2개, _headers만 있습니다. Node 빌드는 허용 목록 외 파일을 거부하고 Google 실행 의존·미치환 템플릿을 검사합니다. private-data, 원본 초기 JSON, 백업, 생성 SQL, .dev.vars, .wrangler, test-results는 정적 배포나 GitHub에 넣지 않습니다. 빌드/일반 테스트는 비공개 초기 JSON을 읽지 않습니다.

설정 원본은 wrangler.jsonc 하나이며 Worker 제안 이름 class-swap, DB 바인딩 DB, Static Assets 바인딩 ASSETS, 공개 경로 public, Runtime Secrets 이름 INITIAL_TEACHER_PASSWORD / INITIAL_ADMIN_PASSWORD입니다. 대시보드 실값과 연결 여부는 아직 검증하지 않았고 실제 계정 인증·자원 조회도 이번 작업에서 수행하지 않았습니다. 다른 도구의 Pages 구성·DB는 변경하지 않았습니다.

전환 브랜치 검토·main 병합, Worker·전용 D1 실값 반영, Runtime Secrets 입력, 원격 마이그레이션·배포·최신 운영 백업 검증/이관이 남았습니다. 상세 입력표와 명령은 [DEPLOYMENT.md](DEPLOYMENT.md), 자료·복구 절차는 [MIGRATION.md](MIGRATION.md)를 따릅니다.

미검증: 원격 Workers/D1 동시성·CPU·요금 적합성, Workers Builds 실제 연동·분리 Preview, 사용자가 쓰는 원본 Excel 실물 재가져오기, 물리 프린터 출력, 기존 운영 계획서/취소 이력 존재와 원격 이관. 현재 로컬 결과를 실제 배포·운영 이관 완료로 보고하지 않습니다.

최초 작업 폴더의 로컬 미리보기는 npm run dev로 http://127.0.0.1:8790 에서 실행했습니다. 중지 후에는 README의 로컬 실행 명령으로 다시 시작할 수 있습니다.

실행 중인 최종 로컬 앱 재확인: / 200, 미인증 load 401, 교사 로그인 후 64명·1,149셀·계획 0건 조회 200, 검증 세션 로그아웃 200. 토큰·교사명은 출력하지 않았습니다.

## 전용 체크아웃 검증

2026-11-02 전용 폴더에서 npm ci와 Node 공개 빌드를 실행하고 npm test 41건 전체 통과를 확인했습니다(실행 시간 약 95초). 실제 Wrangler 로컬 마이그레이션·정적 자산·API JSON 오류·비공개 파일 차단·deploy dry-run도 통과했습니다. 비공개 초기 JSON은 일반 빌드·테스트 입력이 아니며 가상 fixture를 사용합니다. Git 반영 대상 57개 추가 파일에 실제 교사명과 비공개 경로가 없고, 참고 원본 14개 파일은 manifest의 SHA-256과 일치합니다. 기존 두 루트 파일 삭제를 포함한 변경은 전환 브랜치에만 적용합니다. GitHub Actions 원격 실행 결과는 별도로 확인해야 하며 로컬 통과를 원격 CI 통과로 간주하지 않습니다.

GitHub 최초 push 커밋 9cbf7821ca5e292f2b3ffcdd3bd0a0d83c5ed51e의 [원격 CI](https://github.com/cosmicjh/cheomdancs/actions/runs/41374072013)는 success로 확인했습니다. GitHub의 깨끗한 Ubuntu/Node 24 환경에서 npm ci, 공개 빌드, 전체 41개 테스트, Wrangler 검증이 모두 통과했습니다. 이후 API 시험 fixture는 실행일 기준 2주 뒤 월요일을 사용하도록 하여 시간이 지난 뒤에도 미래 계획 충돌 검사 의미를 유지합니다.
