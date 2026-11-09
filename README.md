# Bookmate

교환독서 프로젝트의 픽셀 독서방 시제품과 백엔드·프런트엔드 연동 기반입니다.

## 서버 없는 시제품 먼저 실행

Node.js 24에서 `node apps/room-prototype/server.js` 실행 후 http://localhost:5173 에 접속합니다. npm 설치·API·DB·.env 없이 동작합니다. 정적 파일 제공만 필요하며 브라우저의 IndexedDB에 채팅과 페이지별 글·그림을 저장합니다. 같은 브라우저의 여러 탭에서 접속 상태·채팅·아바타 이동을 공유합니다.

Docker만 사용할 경우 `docker compose -f compose.local.yaml up`으로 웹만 실행합니다. 다른 기기 간 P2P는 아직 구현하지 않았습니다. 상세 기능과 저장 범위는 [시제품 README](apps/room-prototype/README.md)를 참고하세요.

아래는 API와 PostgreSQL을 함께 개발할 때의 설정입니다.

## 개발 환경

- WSL Ubuntu의 `/home/nyko2/bookshare-wsl`
- Docker Engine와 Docker Compose
- 컨테이너의 Node.js 24, PostgreSQL 17
- Node를 WSL에 직접 설치하는 경우 Node.js 24 사용

## 실행

WSL 터미널에서 실행합니다.

```bash
cd /home/nyko2/bookshare-wsl
cp .env.example .env
docker compose up --build
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

Compose는 터미널에 연결된 상태로 실행합니다. API 확인 명령은 다른 WSL 터미널에서 실행합니다. WSL 세션이 종료되면 개발 컨테이너도 종료될 수 있으므로 개발 중에는 실행 터미널을 유지합니다. 이미 `.env`가 있으면 내용을 확인해 유지합니다. 예시 비밀번호는 로컬 개발 전용입니다. Compose가 DB 준비 후 마이그레이션을 적용하고 API를 시작합니다. API와 DB 포트는 개발 컴퓨터의 루프백에 바인딩합니다. 포트가 사용 중이면 충돌을 해결하거나 Compose 포트 매핑을 수정합니다.

```bash
docker compose logs api
docker compose down
```

`down`은 DB 볼륨을 유지합니다. `down -v`는 데이터를 삭제하므로 초기화가 필요한 경우에만 사용합니다.

## 구조

| 경로                 | 역할                                       |
| -------------------- | ------------------------------------------ |
| apps/server          | Fastify API 서버와 서버 테스트             |
| packages/contracts   | 서버와 클라이언트의 공통 응답 타입         |
| packages/api-client  | UI에서 호출할 브라우저 호환 API 클라이언트 |
| prisma               | PostgreSQL 모델과 마이그레이션             |
| docs/integration.md  | 팀 연동 규칙과 현재 제공 API               |
| docs/backend-plan.md | 구현 순서와 담당 경계                      |

## 검증

```bash
docker compose run --rm --no-deps api npm run typecheck
docker compose run --rm --no-deps api npm test
docker compose run --rm --no-deps api npm run db:validate
```

이미지에는 빌드 시점 코드가 들어갑니다. 변경 후 먼저 `docker compose build`로 갱신합니다.

WSL에 Node.js 24가 있으면 다음 방식으로 빠르게 개발할 수 있습니다. 저장소 루트에서 실행합니다.

```bash
npm ci
npm run db:generate
npm run build
docker compose up -d db
npm run db:migrate
npm run dev -w @bookmate/server
```

Docker API가 이미 실행 중이면 `docker compose stop api`로 3000번 포트를 비웁니다.

## 구현 상태

서버 상태 확인, DB 연결 확인, OpenAPI JSON, 공통 오류 응답, 허용 Origin 설정, API 클라이언트와 시제품 채팅·접속 상태 API를 제공합니다. DB에는 사용자·방·참가자·채팅 모델이 있습니다. 기본 UI는 로컬 모드이며 서버 채팅은 `/?mode=server`로 선택합니다.

인증, 방 CRUD, 책 전달, WebSocket, Host 승계, 키 발급, 브라우저 P2P와 동기화는 후속 구현 항목입니다. UI/UX 작업은 기존 팀 작업물을 연결합니다.

## Git

원격 저장소는 https://github.com/pineapple3544/Bookmate 입니다.

Windows Git 인증으로 최초 복제하고, 이 저장소의 로컬 Git 설정에서 Windows Git Credential Manager를 연결했습니다. WSL에서 기존 인증으로 fetch/push를 사용할 수 있습니다. 토큰은 프로젝트 파일에 저장하지 않습니다. 실제 Linux 서버에서는 그 환경의 Git 인증을 별도로 설정합니다.

## 실제 서버 이전

`Dockerfile`로 동일한 앱 이미지를 빌드할 수 있습니다. `compose.yaml`은 로컬 개발 설정입니다. 배포 시 HTTPS/WSS 리버스 프록시, 도메인, 비밀값, 백업·복원 절차, 외부 접근 범위를 설정합니다. 브라우저 P2P를 연결할 때 coturn과 외부망 검증을 추가합니다.

## 픽셀 독서방 시제품

실행 방법과 로컬/서버 모드 차이는 [시제품 README](apps/room-prototype/README.md), 디자인 변경은 [unslop 진단](docs/unslop-review.md)을 참고하세요.
