# 초기 입력 · 운영 이관 · 복구

`schema:1` 기본 자료와 `{type:'class-swap-backup',schema:1,dataset,plans}`를 지원합니다. 제공된 `legacy/private-data/initial-data.json`은 교사 64명·34교시·1,149셀·선택과목 54개인 기본 자료이며 이후 운영 계획서는 포함하지 않습니다. 최신 백업이 있으면 그 백업이 우선이고 건수를 초기 자료 기준으로 강제 변경하지 않습니다.

## 로컬 검증과 초기 입력

```powershell
npm run db:migrate:local
npm run data:check -- legacy/private-data/initial-data.json
npm run data:import -- legacy/private-data/initial-data.json --local
npm run data:verify -- legacy/private-data/initial-data.json --local
```

최신 백업은 Git에서 제외된 `private-data/latest-backup.json` 등에 보관하고 위 경로만 바꿉니다. `data:check`는 형식·수업 스냅샷·미래 계획 검증·중복 예약 검사 후 집계와 내용 해시를 출력하며 실제 교사명이나 사유는 출력하지 않습니다. 과거 계획은 현재 시간표와 달라도 스냅샷을 보존하고 취소 이력도 유지합니다.

초기 입력은 **완전히 빈 DB의 revision=0**에서만 허용합니다. 동일 해시가 입력된 적이 있으면 재실행은 아무 자료도 바꾸지 않습니다. 이후 운영 변경이 생겨도 같은 초기 파일 재실행으로 되돌리지 않습니다. 다른 파일을 이미 자료가 있는 DB에 입력하면 거부합니다. `data:verify`는 현재 자료와 입력 파일의 모든 계획 ID·버전·상태·시각·스냅샷·예약을 비교하여 운영 변경 이후 차이도 감지합니다.

CLI는 시간표·계획별 문서·예약 묶음을 작은 비공개 조각으로 준비한 후 마지막 단일 `initial_import` 트리거에서 시간표·계획·예약·리비전·입력 식별자를 원자적으로 반영합니다. 실패하면 운영 데이터는 그대로 남습니다. 중단된 입력의 `import_staging`은 비공개 준비 자료일 뿐 조회 API나 예약에 반영되지 않습니다. 점검 후 실패한 job_id의 준비 자료만 지울 수 있습니다. 재실행은 새로운 job_id를 사용합니다. 생성 SQL은 `private-data/`에만 잠깐 만들고 도구 종료 시 삭제합니다.

## 원격 입력

전용 결보강 DB ID와 계정을 확인하고 원격 스키마를 적용한 뒤 별도 실행합니다. 빌드·배포는 이를 자동 실행하지 않습니다.

```powershell
npm run deploy:check
npm run db:migrate:remote
npm run data:import -- private-data/latest-backup.json --remote --confirm-empty
npm run data:verify -- private-data/latest-backup.json --remote
```

최신 운영 백업이 없으면 확인 후 제공된 초기 자료 경로를 사용하되, 보고서에 **기본 자료만 입력, 기존 저장 계획서 이관 미확인**으로 남깁니다. 운영 자료가 없다고 단정하지 않습니다. 이관 당시의 파일 해시·집계·입력 시각·원격 DB ID를 비공개 운영 기록으로 보관하고 위 검증 결과와 화면 재조회를 함께 확인합니다.

## 운영 중 전체 복원과 새 학기

관리자로 로그인하여 먼저 `자료 내보내기`를 실행합니다. 새 파일을 JSON 업로드 → 파일 분석 → 전체 복원으로 적용합니다. 이 작업은 현재 자료·계획·예약을 모두 바꾸므로 화면 확인을 거치며, 현재 `dataRev`·`planRev`와 DB 전체 revision을 검사합니다. 계획 ID·버전·상태·생성 및 수정 시각·수업 스냅샷은 보존합니다. D1 batch의 어느 SQL이든 실패하면 기존 상태가 유지됩니다. 변경된 리비전은 409로 거부하고 파일과 작성 내용을 유지합니다.

새 학기 시간표만 교체하려면 기본 자료 JSON 또는 엑셀을 등록합니다. 기존 계획서·취소 이력·과거 스냅샷을 삭제하지 않습니다. Asia/Seoul 기준 아직 끝나지 않은 계획은 새 시간표와 다시 검사합니다. 완료된 과거 계획은 새 학기 등록을 막지 않습니다.

일반 JSON 백업에는 비밀번호·세션이 없습니다. 새 환경에서 초기 Runtime Secrets를 설정하고 관리자 화면에서 변경합니다. 이 값을 이전했다고 보고하지 않습니다. Worker 소스 롤백은 DB 복구와 별개입니다. 데이터 복구에는 검증한 JSON 백업과 D1의 계정별 복구 기능을 사용하고 복구 후 `data:verify` 및 화면 기능을 재점검합니다.

실제 JSON·백업·일시 SQL·.dev.vars·로컬 DB는 GitHub와 public에 포함하지 않습니다. ZIP 전체나 저장소 루트를 Static Assets로 업로드하지 않습니다.

입력 전체는 8MiB 이하이며 시간표 snapshot 하나는 1,900,000바이트 이하로 제한합니다. 계획 이력 전체를 D1의 한 행으로 합치지 않고 계획별로 복원합니다. 0002_import_documents.sql까지 적용해야 현재 입력 도구를 사용할 수 있습니다.
