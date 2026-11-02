# 인증 · 업무 규칙 · 원자적 변경

`src/shared/core.js`는 기존 `SwapCoreFactory_()`를 ESM으로 옮긴 단일 원본입니다. 브라우저에는 Node 빌드로 같은 모듈을 복사하고 Worker는 직접 import합니다. 후보·검증·정규화·과목 분류·예약 의미를 유지하며 교사명·과목·학급 스냅샷을 서버가 원자료에서 다시 계산합니다. 빈 과목에 장소만 있는 원시 셀도 공강으로 분류하지 않도록 보호했습니다. 관리자 Excel/JSON·연속수업 묶음·선택과목 편집·계획 내역 편집/순서·검색·8건 단위 A4 세로/가로 인쇄는 기존 UI를 재사용합니다.

`POST /api`의 `{action,payload}`와 `{ok,data}` / `{ok:false,code,message}`를 사용합니다. Google iframe·postMessage·RPC·사이트 주소 설정은 실행 원본과 산출물에서 제거했습니다. 비밀값·개인 자료는 공개 HTML/JS에 포함하지 않습니다. 별도 서버·Google API·외부 스프레드시트·저장 서비스를 사용하지 않습니다.

## 인증

- 공용 교사·관리자 비밀번호, 서버 역할 검사를 유지합니다. 개별 계정은 추가하지 않습니다.
- Workers Web Crypto PBKDF2-HMAC-SHA256, 100,000회, 역할마다 무작위 128-bit salt, 256-bit 결과를 D1에 저장합니다. 초기 Secret은 미설정 역할의 최초 로그인에만 사용하며 기존 비밀번호를 덮어쓰지 않습니다.
- 세션은 256-bit 무작위 토큰의 SHA-256만 DB에 저장합니다. 쿠키는 HttpOnly·SameSite=Strict, HTTPS에서 Secure, 6시간 만료입니다. 토큰을 응답 JSON·URL·로그·브라우저 저장소에 넣지 않습니다.
- 비밀번호 변경은 역할 인증 epoch 변경·기존 역할 세션 삭제와 함께 원자적으로 실행하며 관리자 본인은 새 토큰으로 재발급합니다. 일반 업무 변경도 DB guard 안에서 해당 세션 epoch를 재검사합니다.
- 로그인 제한은 역할+Cloudflare IP의 해시 키로 D1에 영속화하여 실패 시 10분에 12회까지 허용합니다. 인스턴스 전역 메모리에 의존하지 않습니다.
- API POST는 Origin 동일 출처·JSON 형식·8MiB 스트림 상한을 검사합니다. 자료 응답은 `no-store`; static CSP와 보안 헤더는 빌드 `_headers`에 있습니다. SQL·Secret·상세 스택은 오류 응답으로 보내지 않습니다.

## DB와 동시 저장

현재 시간표는 검증한 JSON snapshot 하나, 계획서는 ID·버전·상태·전체 스냅샷, 예약은 `(teacher_id,actual_date,period)` 복합 기본키입니다. 보강은 두 칸, 교체는 네 칸이고 취소 계획에는 예약이 없습니다. 연쇄 교체는 추가하지 않았습니다.

1. `D1.batch()`로 상태와 계획을 함께 읽고 서버 업무 검증을 수행합니다.
2. 변경 batch 첫 문장은 읽은 전체 revision과 유효 세션을 DB에서 비교하는 `mutation_guard` INSERT입니다. 불일치면 `valid=0`이 되어 CHECK 제약 오류가 발생합니다.
3. 동일 batch에서 계획 생성/수정/취소, 예약 추가/교체/해제, 자료·계획 리비전 증가를 수행합니다.
4. 마지막에 guard 행을 삭제합니다. 예약 중복 UNIQUE 또는 어떤 SQL 오류도 전체 batch를 롤백합니다.

조건부 UPDATE의 0행 결과를 성공으로 오인하여 뒤의 DELETE가 실행되는 방식이 아닙니다. 모든 검증 전제는 DB의 전체 revision으로 잠급니다. 다른 계획이 끼어들거나 시간표가 바뀌면 409이며 작성 내용을 유지합니다. 같은 ID·같은 최초 생성 내용의 재시도는 원래 결과를 반환하고 다른 내용은 충돌합니다. 서로 다른 계획의 동시 저장이 충돌하면 보수적으로 한 요청을 409로 돌려보내므로 사용자는 새로 불러와 재시도할 수 있습니다.

전체 복원도 같은 guard와 batch를 사용합니다. CLI 초기 입력은 파일 SQL의 트랜잭션 여부를 가정하지 않고, private staging 후 단일 SQL 트리거 안에서 전체 운영 자료를 반영합니다. 가짜 Map·JS mutex·BEGIN/COMMIT·지원되지 않는 트랜잭션 콜백을 사용하지 않습니다.

실행 근거: [D1 Database API와 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/). 실제 SQL CHECK·UNIQUE·trigger·rollback은 로컬 workerd의 D1 바인딩으로 검증합니다. 원격 D1 검증과 운영 CPU 측정은 별도 단계입니다.
