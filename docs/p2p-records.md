# P2P 사진·댓글·그림 공유

2026-11-16. 기존 Node/PostgreSQL 서버와 로그인·방·채팅을 유지한다. Sites를 사용하지 않는다.

## 사용

`docker compose up --build -d` 후 실제 계정으로 교환독서 방을 만들고 시작한다. 현재 독서자와 완독자는 기록을 열 수 있다. 사진, 댓글 첨부사진, 사진 위 그림, 텍스트 기록/그림을 작성하면 연결된 열람 가능 참가자에게 전달된다. 기록 피드 상단에 연결 수, 전송 중, 수신 대기 개수가 표시된다. 로컬 체험방은 종전처럼 브라우저 안에서만 동작한다.

새 참가자는 기록을 가진 온라인 참가자에게서 과거 데이터를 받는다. 원 작성자가 없어도 다른 복제본이 있으면 전달 가능하다. 모든 복제본이 오프라인이면 수신 대기 상태이며, 누군가 돌아오면 다시 요청한다. 브라우저 데이터를 모두 지우면 중앙 서버에서 내용을 복구할 수 없다.

## 경로와 저장

- 중앙 HTTP: `/api/v1/rooms/:roomId/record-ops`. 작성자/대상/작업 ID/순서/크기/SHA-256만 PostgreSQL에 저장. 사진·댓글·그림 내용은 저장하지 않는다. 방 삭제 시 메타데이터도 삭제한다.
- 중앙 WebSocket: 기존 `/live`에 탭별 peerId, 열람 가능한 사용자 목록, offer/answer/ICE 중계를 추가했다. 세션·방 참가 및 독서 상태를 검사한다. 이전 사용자 ID 기반 시그널링과 채팅 API는 유지한다.
- WebRTC: 열람 가능한 참가자끼리 mesh를 구성하고 ordered DataChannel로 본문을 16 KiB 단위 전송한다. 송신 버퍼가 256 KiB를 넘으면 기다린다. 한 수신자는 한 본문씩 받고 30초간 진전이 없으면 연결을 재시도한다. 도중 단절 시 해당 본문 처음부터 재전송한다.
- 브라우저: 계정·방별 IndexedDB v3의 recordBodies에 저장한다. 수신자는 서버 메타데이터와 해시·크기·작성자를 검증하고 저장한 뒤 화면에 반영한다. 전송 자체는 WebRTC DTLS를 사용한다. 저장된 IndexedDB 본문을 별도로 암호화하지는 않는다.
- 수정과 삭제도 순서가 있는 작업이다. 삭제 메타데이터는 본문 도착 여부와 무관하게 적용하므로 오래된 복제본이 다시 접속해도 삭제를 되돌리지 않는다. 동시 댓글 추가를 병합하며 같은 댓글의 편집은 서버에 등록된 순서대로 반영한다.

작성 시 중앙 서버 연결은 필요하다. 본문을 먼저 로컬에 저장한 뒤 서버에 메타데이터를 등록하며, 응답이 끊기면 동일 ID로 재시도한다. 서버가 수락한 작업만 다른 참가자에게 광고한다. 연결 해제·인증 실패 시 공식 클라이언트는 P2P를 닫는다. 이미 받은 자료를 사용자가 별도로 복사하는 것까지 회수할 수는 없다.

## 기존 기록

기존 records 저장소를 삭제하지 않는다. 현재 계정의 기존 사진·텍스트·그림과 자기 댓글을 공유 작업으로 가져온다. 가져오다 끊기면 저장해 둔 진행 상태와 작업 해시를 비교해 남은 단계부터 재개한다. 같은 계정의 다른 탭이 저장한 파일도 IndexedDB에서 다시 확인한다. 이미 다른 브라우저에서 등록된 페이지(삭제 포함)는 오래된 로컬 데이터로 덮어쓰지 않는다. 다른 작성자의 기존 댓글을 현재 사용자의 작성물로 임의 변환하지 않는다. 로컬 체험방 데이터는 계정 방에 자동 귀속하지 않는다.

## 인터넷 배포 / TURN

로컬 검증은 같은 컴퓨터의 서로 다른 Chrome 브라우저 컨텍스트 사이에서 수행한다. 다른 인터넷망 및 NAT 환경의 성공은 보장하지 않는다. 실제 서버는 HTTPS/WSS로 배포하고 STUN/TURN을 설정해야 한다.

API `.env` 예시(실제 주소·비밀값으로 교체):

```dotenv
RTC_STUN_URLS=stun:stun.l.google.com:19302
RTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
RTC_TURN_SECRET=REPLACE_WITH_PRIVATE_RANDOM_SECRET
RTC_RELAY_ONLY=false
```

TURN 서버(coturn)는 use-auth-secret과 같은 static-auth-secret, realm, listening-port 및 relay 포트 범위를 설정한다. 실제 공인 IP 또는 NAT 매핑을 external-ip에 맞추고 해당 포트를 방화벽에 연다. TLS TURN을 사용하려면 turns URL과 인증서를 구성한다. 비밀키는 커밋하지 않는다. `/rtc-config`는 열람 권한을 확인하고 사용자별 1시간짜리 HMAC 자격 증명만 반환한다. 브라우저는 새 연결 생성 시 30분 이상 된 설정을 갱신한다.

실제 배포 후 두 기기를 서로 다른 망(예: Wi-Fi와 휴대폰 데이터)에 연결해 사진을 보내고, `RTC_RELAY_ONLY=true`로 강제 릴레이 전송도 확인한다. 현재 작업에서 외부 TURN 서버를 만들거나 외부망 전송 성공을 검증하지는 않았다.

참고: [WebRTC 연결 안내](https://webrtc.org/getting-started/peer-connections), [coturn 설정](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

기존 API 요청 제한은 유지했다. 참가자 수가 많을 때 채팅·방 조회 주기를 늘리고, 기록 목록은 기본 10초 간격 및 새 P2P 목록 수신 시 갱신해 불필요한 조회를 줄인다.

## 현재 한도

사진 15 MiB, 인코딩된 단일 작업 22 MiB, 방당 작업 2,048개 또는 누적 인코딩 크기 256 MiB. 삭제 이력을 포함한 한도이며 자동 압축/정리는 아직 없다. 상한은 무제한 브라우저 메모리·저장 사용을 막기 위한 것이다. 여러 장의 대용량 사진은 브라우저 저장 용량에 영향을 받는다. API 프로세스는 기존처럼 한 개이며 수평 확장에는 공유 시그널링/host lease가 필요하다.

## 검증

- `CORE_DB_TEST=1 npm test`: 권한, 재시도, 작성자 위조, 동시 댓글, 삭제 및 TURN 임시 자격 증명.
- `npm run test:p2p-browser -w @bookmate/room-prototype`: 실제 DataChannel 사진·댓글·그림 전송, 해시 변조 거부, 원 작성자 이탈, 늦은 참가자, 새 브라우저 복원, 수정·삭제·재접속·여러 탭, HTTP에 본문을 올리지 않는지 검사.
- 기존 `test:browser`, `test:server-browser`, `test:exchange-browser`, `test:legacy-browser`로 종전 기능 검증.

최종 실행 결과: 빌드·타입 검사 통과, Node/DB/클라이언트 테스트 15개 통과(건너뛴 테스트 없음), 브라우저 테스트 5종 통과. 기존 기록 가져오기 도중 오류 후 재개와 DataChannel을 차단한 동일 계정 탭의 로컬 파일 복원도 검증했다.
