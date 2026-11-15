# 서버 API · 연동 가이드

2026-11-14 구현. Node.js 24 / Fastify 5 / PostgreSQL 17 / Prisma 7.

## 실행

저장소 루트에서 `.env.example`을 참고해 `.env`를 준비한 뒤 실행합니다. 기존 `.env`와 DB 볼륨은 유지합니다.

```bash
docker compose up --build
```

- API: http://localhost:3000
- 생존 확인: `/health`, DB 준비 확인: `/health/ready`
- OpenAPI: `/openapi.json`
- 기존 시제품: http://localhost:5173 (기본 로컬 모드)
- `/api/v1/*` HTTP 및 `/api/v1/rooms/:roomId/live` WebSocket은 웹 서버 5173에서도 프록시합니다.

새 인증 API는 시제품의 사용자 1~4 선택과 별개입니다. 기존 `?mode=server` 화면은 여전히 시제품 채팅 API를 사용합니다. 팀 프런트엔드에서 아래 인증 API와 사용자 UUID를 연결해야 합니다. 로컬 기록·시제품 채팅을 실제 계정으로 자동 이관하지 않습니다.

## 인증 및 요청 규칙

1. 회원가입 후 로그인합니다. 가입 자체는 세션을 만들지 않습니다.
2. 로그인 응답의 HttpOnly / SameSite=Strict 쿠키를 브라우저가 보관합니다. 토큰은 JS나 localStorage에 저장하지 않습니다.
3. `fetch`에 `credentials: "include"`를 지정합니다. 변경 요청은 JSON을 사용합니다.
4. 모든 변경 요청의 `Origin`은 `WEB_ORIGINS`의 정확한 주소여야 합니다. 브라우저는 자동 설정합니다. curl·테스트 도구는 직접 Origin 헤더를 지정합니다. Origin 검사는 로그인 CSRF를 포함한 CSRF 방어입니다.
5. 세션은 7일 후 만료됩니다. 로그아웃 시 해당 세션을 DB에서 제거합니다. 여러 기기의 세션은 독립적입니다.

비밀번호는 10~128자, scrypt(N=32768,r=8,p=1) + 사용자별 무작위 salt로 해시합니다. 세션·초대 토큰 원문은 DB에 저장하지 않고 SHA-256 해시만 보관합니다. 일반 요청은 IP당 분당 300회, 가입·로그인은 각 경로에서 IP당 10분에 15회 제한합니다. 프록시 뒤에서는 신뢰 프록시 설정을 추가하기 전까지 프록시 IP가 한도로 묶입니다. 임의 X-Forwarded-For는 신뢰하지 않습니다.

## HTTP API

기본 경로 `/api/v1`. 아래 인증 제외 API는 모두 로그인 필요합니다.

| 메서드 | 경로                         | 입력 / 동작                                                         |
| ------ | ---------------------------- | ------------------------------------------------------------------- |
| POST   | /auth/register               | email, password, nickname → user (201)                              |
| POST   | /auth/login                  | email, password → user + 세션 쿠키                                  |
| GET    | /auth/me                     | 현재 user                                                           |
| POST   | /auth/logout                 | 현재 세션 폐기 (204)                                                |
| GET    | /rooms                       | scope=mine 또는 public, q, before. 50개 및 nextCursor               |
| POST   | /rooms                       | title, bookTitle, visibility(PRIVATE 기본), maxMembers(2~12, 기본4) |
| GET    | /rooms/:id                   | 참가자만 방·읽는 순서·완료 상태·현재 책 소유자 조회                 |
| PATCH  | /rooms/:id                   | 관리자. version 필수, title / visibility / maxMembers 변경          |
| DELETE | /rooms/:id                   | 관리자. 방·참가·초대·채팅·전달 이력 삭제 (204)                      |
| POST   | /rooms/:id/join              | 공개방은 {}, 비공개방은 inviteToken                                 |
| DELETE | /rooms/:id/membership        | 본인 탈퇴. 책 소유자·마지막 관리자는 거절                           |
| POST   | /rooms/:id/admins            | 관리자. userId 참가자를 추가 관리자로 지정                          |
| POST   | /rooms/:id/invites           | 관리자. maxUses(기본1) → id, token, expiresAt. 유효기간7일          |
| DELETE | /rooms/:id/invites/:inviteId | 관리자. 초대 폐기                                                   |
| POST   | /rooms/:id/reading/complete  | 현재 책 소유자의 완료 처리. 완료 재요청은 동일 결과                 |
| POST   | /rooms/:id/transfers         | id(UUID 재시도키), toUserId, version                                |
| GET    | /rooms/:id/transfers         | 최근 전달 이력 최대100개                                            |
| POST   | /rooms/:id/messages          | id(UUID 재시도키), text(1~500자). senderId는 세션에서 결정          |
| GET    | /rooms/:id/messages          | before 또는 after 순번 문자열. 50개, hasMore                        |

가입 이메일은 소문자로 정규화하며 중복을 거절합니다. 비참가자에게 공개방의 참가자·채팅은 노출하지 않습니다. 공개 목록에는 방 제목·책·정원·참가 인원만 포함됩니다.

방 생성자는 관리자이며 첫 번째 책 소유자(READING)입니다. 참가자는 WAITING으로 읽는 순서 끝에 추가됩니다. 소유자가 완료한 뒤 다음 WAITING 참가자에게 전달할 수 있습니다. 방의 version이 다르면 409로 거절하므로 최신 방을 다시 조회해야 합니다. 소유자 변경·읽기 시작·전달 이력·버전 증가는 한 트랜잭션입니다. 같은 id와 같은 전달 내용의 재시도는 중복 이력을 만들지 않습니다.

같은 방의 참가·수정·완료·전달·채팅 쓰기는 방 행 잠금으로 직렬화합니다. 채팅은 커밋 순서와 순번을 맞춰 after 커서 조회에서 누락되지 않게 합니다. 동일 메시지 id에 다른 본문·사용자를 넣으면 409입니다. 전송 재시도에 같은 UUID를 사용하세요.

오류 형태는 `{error:{code,message,requestId}}`입니다. 주요 code: UNAUTHENTICATED(401), ORIGIN_DENIED/NOT_A_MEMBER/ADMIN_REQUIRED/INVALID_INVITE(403), ROOM_NOT_FOUND(404), CONFLICT/ROOM_FULL/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/INVALID_NEXT_READER(409), RATE_LIMITED(429). WebSocket handshake 거절은 일부 간단한 오류 형식을 사용합니다.

## 클라이언트 예시

```ts
import { createApiClient } from "@bookmate/api-client";
import type { RealtimeEvent } from "@bookmate/contracts";
const api = createApiClient(""); // 5173 프록시 또는 같은 Origin 배포
await api.register("user@example.com", "a-long-password", "사용자 1");
await api.login("user@example.com", "a-long-password");
const { room } = await api.createRoom({
  title: "임시 문구1",
  bookTitle: "임시 문구2",
});
const request = { id: crypto.randomUUID(), text: "임시 문구1" };
await api.sendMessage(room.id, request); // 실패 시 request를 그대로 재사용
const socket = new WebSocket(api.realtimeUrl(room.id));
socket.onmessage = (event) => {
  const message: RealtimeEvent = JSON.parse(event.data);
  // presence / move / signal / error를 화면 상태에 반영
};
```

## 실시간 및 WebRTC 시그널링

주소: `/api/v1/rooms/:id/live`. 연결 시 세션·Origin·방 참가를 검사합니다.

서버 → 클라이언트:

```json
{"type":"presence","onlineUserIds":["user UUID"],"hostUserId":"user UUID","hostEpoch":"1","positions":{}}
{"type":"move","userId":"user UUID","x":480,"y":320}
{"type":"signal","fromUserId":"user UUID","hostEpoch":"1","kind":"offer","payload":{"type":"offer","sdp":"..."}}
{"type":"error","code":"STALE_EPOCH"}
```

클라이언트 → 서버:

```json
{"type":"move","x":480,"y":320}
{"type":"signal","targetUserId":"peer UUID","hostEpoch":"1","kind":"offer","payload":{"type":"offer","sdp":"..."}}
```

- kind는 offer / answer / ice. 실제 SDP/ICE 해석과 RTCPeerConnection 구성은 브라우저 담당입니다.
- 위치는 시제품 좌표 x=24~616, y=160~376을 검사합니다. 이동 충돌·좌석의 서버 권위 판정은 아직 없습니다.
- 동일 방에 연결된 상대에게만 전달하며, 발신자 ID는 서버가 넣습니다.
- 먼저 연결된 온라인 사용자가 임시 Host입니다. 같은 사용자의 탭 하나가 종료되어도 다른 탭이 있으면 유지합니다.
- Host 변경 시 DB hostEpoch를 증가시키며 오래된 epoch의 시그널을 거절합니다. Host와 실제 책 소유자는 별개입니다.
- ping/pong을 10초마다 확인하며 보통 10~20초 안에 단절을 감지합니다. 세션 만료·로그아웃도 다음 검증 시 연결 종료합니다. 방 삭제·탈퇴는 즉시 종료합니다.
- 프레임16KiB, 연결당 초당30개, 방당 최대24개 연결, 작업 대기열64개로 제한합니다.
- 서버 재시작 후 클라이언트가 재연결하면 새 epoch를 받습니다. 앱의 재연결·P2P 복제 복구는 프런트엔드에서 연결해야 합니다.
- 채팅은 HTTP 영구 저장/커서 조회 방식입니다. WebSocket에서 채팅 본문을 수신하는 기능은 아직 없습니다.

현재 실시간 구현은 **API 인스턴스 한 개**를 전제로 합니다. 여러 API 인스턴스로 확장하기 전에 공유 presence, DB lease 기반 Host 선출, pub/sub 라우팅을 구현해야 합니다. 현재 Host 선정은 먼저 연결된 사용자 기준이며 RTT·안정성 점수 선출은 후속 작업입니다.

## 검증 및 배포 경계

```bash
docker compose run --rm --no-deps api npm run typecheck
docker compose run --rm --no-deps -e CORE_DB_TEST=1 -e CHAT_DB_TEST=1 api npm test
```

이미지는 빌드 시점 코드를 사용하므로 변경 후 `docker compose build`를 먼저 실행합니다. 통합 테스트는 UUID로 생성한 전용 사용자·방만 정리합니다. GitHub Actions에서도 PostgreSQL을 기동하고 마이그레이션과 DB 통합 테스트를 실행하도록 구성했습니다.

실제 서버에서는 HTTPS/WSS 리버스 프록시, 정확한 WEB_ORIGINS, NODE_ENV=production, 새 DB 비밀번호, 백업·복원을 설정합니다. production은 Secure + __Host- 쿠키를 사용하며 HTTP Origin과 PROTOTYPE_CHAT_ENABLED=true 설정을 거절합니다. 현재 compose.yaml은 로컬 개발용이고 DB/API 포트를 localhost에만 공개합니다. 공개 도메인·TLS 배포는 아직 하지 않았습니다.

미완료: 비밀번호 재설정·이메일 인증, 스포일러 방지 암호화/키 발급, 콘텐츠 이벤트 검증과 P2P 복제, STUN/TURN 운영, 실제 두 기기 외부망 검증. 서버의 독서 완료 상태만으로 이미 로컬에 존재하는 평문 기록을 보호할 수는 없습니다.

### 브라우저 통합 검증

API와 웹을 실행한 뒤 `npm run test:server-browser -w @bookmate/room-prototype`으로 실제 쿠키·동일 Origin HTTP/WS 프록시·방 생성/삭제·로그아웃을 검증합니다. Chromium 설치가 필요하며, 설치된 Chrome은 `BROWSER_CHANNEL=chrome`으로 선택합니다. 로컬 `.env` 또는 환경 변수의 DATABASE_URL로 접속해 테스트가 생성한 UUID 사용자·방만 정리합니다. 웹 주소는 BASE_URL로 지정합니다.

WSL 개발 중에는 `docker compose up` 실행 터미널을 유지합니다. db/api/web에 unless-stopped 재시작 정책을 추가했지만 Windows 종료나 WSL 자체 종료 동안 서비스를 제공하지는 않습니다. 현재 개발 컴퓨터에서는 숨겨진 WSL 실행 프로세스로 세션을 유지하며, 중지는 저장소에서 `docker compose down`을 사용합니다.

## 2026-11-15 화면 통합

최신 홈·독서방·서재가 새 계정 API와 연결됐습니다. 기존 문서의 화면 미연동 상태는 [최신 통합 가이드](integration-20261115.md)로 대체합니다. 새 교환독서 방에는 별도 exchanges 진행 API를 사용하며 기존 일반 room API는 유지합니다.
