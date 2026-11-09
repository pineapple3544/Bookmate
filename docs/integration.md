# 팀 연동 계약

## 담당 경계

- 고낙연은 중앙 서버·DB·권한·시그널링과 전체 연동·공통 시스템·PM을 담당합니다.
- UI 담당은 화면 구조와 디자인, 프런트엔드 마크업을 구현합니다.
- Interaction 담당 두 명은 사용자 동작을 구현합니다. 브라우저 P2P·IndexedDB·암호화·동기화의 개인별 담당은 팀에서 확정해야 합니다.

## 현재 API

| 요청              | 성공                    | 실패                    |
| ----------------- | ----------------------- | ----------------------- |
| GET /health       | 200, {"status":"ok"}    | 프로세스 가용성 확인    |
| GET /health/ready | 200, {"status":"ready"} | DB 연결 실패 시 503     |
| GET /openapi.json | 200, OpenAPI 문서       | 현재 구현된 경로만 제공 |

후속 업무 API는 `/api/v1` 접두사를 사용합니다. 아직 구현되지 않은 경로는 404입니다.

공통 오류 응답 예시입니다.

```json
{
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is unavailable",
    "requestId": "req-1"
  }
}
```

프런트엔드는 `code`로 사용자 메시지를 선택하고, 문제 보고 시 `requestId`를 함께 전달합니다. 네트워크 단절은 HTTP 응답 자체가 없으므로 별도로 처리합니다.

## UI에서 사용

워크스페이스 기반 프런트엔드에서는 다음 모듈을 가져옵니다.

```ts
import { createApiClient, ApiClientError } from "@bookmate/api-client";

const api = createApiClient("http://localhost:3000");
try {
  const result = await api.ready();
  console.log(result.status);
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error(error.status, error.body);
  }
}
```

순수 HTML/JavaScript에서도 `fetch("http://localhost:3000/health/ready", { credentials: "include" })`로 호출할 수 있습니다. HTML은 로컬 웹서버로 열고 그 Origin을 `WEB_ORIGINS`에 등록합니다. CORS 설정은 인증 기능을 대신하지 않습니다.

쿠키를 포함하는 호출 형식을 미리 통일했습니다. 세션 인증과 CSRF 정책은 인증 구현 단계에서 함께 확정합니다.

## 데이터와 P2P

중앙 DB는 사용자·참가자·권한·독서 진행·전달 이력·Host 세대 번호를 관리합니다. 기록 본문, 사진, 그림, 댓글은 원래 명세에 따라 브라우저 저장과 암호화된 P2P 복제가 기본입니다.

방 관리자, 실제 책 소유자, 접속 세션의 Host를 각각 구분합니다. 동일 사용자의 여러 탭·기기를 별도 세션으로 처리할 예정입니다. 데이터 사본이 없는 새 기기의 복구 대기 상태와 방 메타데이터 접근 가능 상태를 구분합니다.

WebSocket 메시지의 구체적 형식은 인증과 세션 모델을 구현한 뒤 확정합니다. 프로토콜에는 버전, 요청 ID, 방 ID와 서버가 검증한 세션을 사용하고 Host 명령에는 epoch를 포함할 예정입니다. 호스트 epoch는 DB의 BigInt이므로 JSON에서는 문자열로 전달합니다.

## 시제품 채팅

중앙 PostgreSQL에 방별 채팅 기록을 저장하는 시제품 API를 추가했습니다. 사용자 번호는 0~3이며 로그인 연동 전 테스트용입니다. 웹 시제품 README에서 API, 접속 신호와 보존 정책을 확인할 수 있습니다. 기존 독서 기록 본문의 P2P 계획과 별도로 채팅 기록은 서버 보존 방식을 사용합니다.

## 로컬 시제품 전송 계층

기본 UI는 `local-transport.js`로 IndexedDB 채팅과 localStorage 접속 정보를 조회하며 API를 호출하지 않습니다. `?mode=server`에서만 기존 API 경로를 사용합니다. 두 모드는 같은 메시지 응답 형태를 사용하고 자동 fallback이나 데이터 이관은 하지 않습니다. `records.js`는 사용자·페이지 복합 키로 글·그림을 브라우저에 저장합니다. `BroadcastChannel` 이동 공유는 동일 브라우저 내 테스트용이며 WebRTC가 아닙니다.
