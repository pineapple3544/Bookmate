# 프런트엔드·서버 통합 결과

> 2026-11-16 업데이트: 아래 내용은 최초 통합 시점 기록입니다. 현재 P2P 공유 구현과 남은 배포 제약은 [P2P 기록 공유](p2p-records.md)를 참고하세요.

2026-11-15. 원격 `feature/reading-room-20261114`의 `b6a31ad`를 서버 작업과 병합했다. 서버 원본 작업은 로컬 커밋 `82c3bb7`에 보존했다.

## 실행 모드

| 실행                                                   | 기본 화면·저장                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `docker compose up --build`                            | 계정 로그인 → 홈·방·서재. 방/참가자/외형/독서 진행/별점/감상평은 PostgreSQL, 채팅은 인증된 방별 DB 저장 |
| `node apps/room-prototype/server.js` (API_ORIGIN 없음) | 기존 로그인 없는 로컬 교환독서. JSON 파일과 브라우저 IndexedDB 사용                                     |
| `docker compose -f compose.local.yaml up`              | API·DB 없는 동일 로컬 모드. `.local-data/exchanges.json` 사용                                           |
| `/room.html`                                           | 기존 사용자 1~4 선택형 로컬 픽셀 시제품                                                                 |
| `/?local=1`                                            | 개발 환경에서 명시적으로 선택하는 로컬 교환독서·체험방                                                  |

API_ORIGIN이 설정되면 서버 모드가 기본이다. 연결 실패를 로컬 성공으로 바꾸지 않는다. 로그인·회원가입은 추가한 폼에서 처리하며 세션은 HttpOnly 쿠키로만 전달한다. 화면의 별명은 방별 표시 이름이고 실제 권한은 계정 UUID와 서버 세션으로 검사한다.

`NODE_ENV=production`인 웹 서버에서는 예전 `/api/exchanges` JSON API를 차단한다. Compose가 NODE_ENV를 웹에도 전달한다. 개발 체험방은 계정 기반 방과 별도이며 JSON 참가 토큰을 계정 인증 수단으로 인정하지 않는다.

## 기능 연결

- 홈의 방 목록과 내 서재는 현재 계정의 DB 참가 목록으로 조회한다. 새 브라우저에서 로그인해도 조회할 수 있다.
- 8자리 초대 코드, 참가 대기, 방 옵션 수정, 순서 드래그/키보드 변경, 전원 참가 후 시작 UI를 유지했다.
- 방장의 계정은 독서 순서를 바꿔도 유지된다. 정원·순서·시작 상태는 방 행 잠금으로 검사한다.
- 완독·별점·감상평·다음 독서자 시작·책 소유자 변경·전달 이력을 하나의 트랜잭션으로 반영한다. 완독 재전송은 다음 사람을 두 번 넘기지 않는다.
- 모든 참가자 완독 후 내 서재·히스토리·감상평 수정·PNG 티켓을 유지한다. 완료 전 타인의 감상평·별점·인용문은 서버 응답에서 제외한다.
- 캐릭터 외형과 피부 밝기를 DB에 저장한다. 책 표지 펫 해금과 선택 UI, 시간대별 방 배경은 유지한다.
- 실제 독서방은 인증 HTTP 채팅과 WebSocket 온라인 상태·이동 좌표·착석 상태를 사용한다. 다른 브라우저에서도 채팅·이동을 확인한다. 연결 끊김을 표시하고 일반 단절은 재접속한다.
- 기존 시제품 채팅 경로와 핵심 `/api/v1/rooms` API는 유지한다. 새 교환독서 방은 전용 흐름을 사용하므로 기존 완료·전달·가입·수정·탈퇴 API로 그 진행 규칙을 우회할 수 없다.

## 보존 범위 및 남은 작업

사진 게시물·댓글·사진 위 그림은 기존처럼 IndexedDB에 저장한다. 실제 계정 모드에서는 계정별 저장 영역으로 분리하며 **기기 간 P2P 복제는 아직 없다**. 방 기록을 다른 기기로 보내거나 암호화된 스포일러 방지를 제공한다고 표시하지 않는다. 기록 화면의 현재 독서자/완독자 제한은 로컬 UI의 표시 규칙이다.

기존 로컬 채팅·사진 DB와 JSON 교환독서는 삭제하거나 실제 계정으로 임의 귀속시키지 않는다. Docker의 로컬 JSON 저장 위치는 `.local-data/exchanges.json`이고, 기존 저장소 루트 파일이 있으면 최초 통합 때 원본을 남긴 채 복사했다. 이후 두 파일을 자동 동기화하지 않는다. `.local-data`와 JSON 파일은 Git·이미지 빌드에서 제외한다.

기존 텍스트/그림 시제품 데이터도 보존했다. 기록 피드의 텍스트 기록 버튼에서 이전 페이지별 텍스트·그림을 열고 수정·삭제할 수 있다. 같은 페이지에 사진 게시물과 함께 저장해도 서로의 필드를 덮어쓰지 않는다. 운영 시 계정 복구·백업·TURN·P2P·다중 서버 Host lease는 별도 후속 작업이다.

## 새 API

기본 경로 `/api/v1/exchanges`, 세션 및 변경 요청 Origin 검사 적용.

- GET `/`: 현재 계정의 code 목록. before UUID 커서, nextCursor.
- POST `/`: title, author, name, capacity(2~10), theme → room.
- GET `/:code`: 초대 미리보기 또는 참가자의 방 상태.
- POST `/:code/join`: name.
- POST `/:code/settings`: title, author, name, capacity, theme. 시작 전 방장만.
- POST `/:code/order`: previous와 order 사용자 UUID 배열. 시작 전 방장만.
- POST `/:code/start`: 전원 참가 후 방장만.
- POST `/:code/appearance`: 캐릭터 옵션.
- POST `/:code/finish`: rating(0.5~5, 0.5 단위), review, quote, appearance(선택).
- POST `/:code/review`: 완독한 본인의 rating, review, quote 수정.

room.id는 기존 방 UUID이며 room.code는 공유용 코드다. 화면 member.id는 실제 userId다. WebSocket 및 채팅은 기존 `/api/v1/rooms/:id/live`, `/messages`를 사용한다.

## 검증

- 빌드·타입 검사, 기존 서버 테스트 및 새 교환독서 DB 통합 테스트
- `npm run test:browser -w @bookmate/room-prototype`: API 차단 상태의 로컬 채팅·사진·댓글·그림·반응형 테스트
- `npm run test:server-browser -w @bookmate/room-prototype`: 인증 HTTP/WS 프록시 검증
- `npm run test:exchange-browser -w @bookmate/room-prototype`: 독립된 두 브라우저 계정으로 가입부터 초대·순서·시작·채팅·이동·완독·서재·티켓·로그아웃까지 검증
- `npm run test:legacy-browser -w @bookmate/room-prototype`: API/DB 없는 별도 정적 서버와 임시 JSON 저장소에서 체험방 검증

브라우저 테스트는 Chromium 설치가 필요하다. BROWSER_CHANNEL=chrome으로 설치된 Chrome을 사용할 수 있다. 서버 테스트가 만든 사용자·방은 해당 테스트 계정의 정확한 ID로 정리하며 기존 데이터는 삭제하지 않는다.
