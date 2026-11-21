# Bookmate · 교환독서

한 권의 실물 책을 정해진 순서대로 돌려 읽으며, 각자 남긴 페이지 기록·감상평을 모아 보는 교환독서 웹앱입니다.
웹프로그래밍(서버프로그래밍) 수업 팀 프로젝트입니다.

## 현재 단계: 1차 프론트엔드 MVP

- HTML/CSS(Bootstrap 5 + 직접 만든 `style.css`) + 바닐라 JavaScript(`interaction.js`)
- 서버·DB·로그인 인증은 아직 없습니다. 데모 상태는 **브라우저 localStorage**에만 저장됩니다.
- 화면 하단의 **데모 초기화** 버튼으로 진행 상태를 처음으로 되돌릴 수 있습니다.

## 실행 방법

빌드 과정이 없습니다. 아래 중 하나로 `index.html`을 열면 됩니다.

```bash
# 방법 1: 파일 더블클릭으로 index.html 열기
# 방법 2: 로컬 서버 (클립보드 복사 등 일부 기능은 http://localhost 에서 더 안정적입니다)
python -m http.server 8000
# → http://localhost:8000/index.html
```

VS Code를 쓴다면 Live Server 확장으로 열어도 됩니다.

## 화면 구성

| 파일 | 화면 |
| --- | --- |
| `index.html` | 로그인 / 회원가입 (`#signup` 해시로 전환) |
| `home.html` | 내 교환독서 방 목록, 초대 코드로 참여 |
| `create.html` | 방 만들기 (책 제목·저자·표지 색·인원) |
| `waiting.html` | 대기실 (초대 코드 복사, 읽는 순서 정하기) |
| `room-reading.html` | 지금 책을 가진 사람 화면 (기록 올리기, 다음 사람에게 전달) |
| `room-done.html` | 이미 읽은 사람 화면 (기록 보기, 댓글) |
| `room-waiting-view.html` | 아직 차례가 안 온 사람 화면 |
| `room-complete.html` | 모두 완독한 방 |
| `history.html` | 교환독서 히스토리 (전달 과정, 모두의 감상평) |
| `ticket.html` | 완료 기념 티켓 (PNG 저장) |
| `shelf.html` | 내 서재 |

## 데모 시나리오

1. `index.html`에서 아무 이메일/비밀번호로 로그인 → 홈
2. **작별하지 않는다** 방: 상단 시점 메뉴에서 `민지 시점` 선택 → `수빈님에게 전달하기` → 확인
3. 시점 메뉴에서 `수빈 시점` 선택 → `책 받고 읽기 시작하기` → 기록 올리기 → 전달하면 완료 화면
4. **방 만들기**: 방을 만들면 대기실로 이동하고, 홈 목록 맨 위에도 표시됩니다. 대기실의 초대 코드를 홈에서 입력해도 들어갈 수 있습니다.
5. 데모 참여자: 낙연, soiewer(나), 민지, 수빈 (`interaction.js`의 `DEMO_MEMBERS`)

## 다음 단계 (백엔드 연동 시 교체할 부분)

- `interaction.js`의 `loadState` / `saveState` → 서버 API 호출로 교체
- `DEMO_MEMBERS`, `currentViewerId()` → 로그인 세션의 사용자 정보로 교체
- 사진·그림 기록 파일 업로드 저장
- 로그인 / 회원가입 폼에 `name` 속성과 `method="post"` 추가 후 서버 인증 연결
