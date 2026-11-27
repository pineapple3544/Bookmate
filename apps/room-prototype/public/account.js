const settings = await fetch("/runtime-config.json", {
  cache: "no-store",
}).then((response) => {
  if (response.status === 404) return { server: false, localExchange: true };
  if (!response.ok) throw new Error("서버 설정을 불러오지 못했습니다");
  return response.json();
});
export const serverAvailable = settings.server;
export const localExchangeAvailable = settings.localExchange;
export const serverMode =
  settings.server && new URLSearchParams(location.search).get("local") !== "1";
export let account = null;
let pendingAccount;
const errors = {
  RECORDS_LOCKED: "독서 차례가 되면 기록을 받을 수 있습니다",
  ROOM_RECORD_LIMIT: "이 방의 기록 저장 한도에 도달했습니다",
  POST_CHANGED: "게시물이 변경됐습니다. 다시 열어 주세요",
  POST_EXISTS: "이 페이지에 이미 사진이 있습니다",
  REPLY_MISSING: "댓글이 삭제됐습니다",
  NOT_REPLY_OWNER: "내 댓글만 수정할 수 있습니다",
  NOT_RECORD_OWNER: "내 기록만 수정할 수 있습니다",
  UNAUTHENTICATED: "로그인이 필요합니다",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호를 확인해 주세요",
  CONFLICT: "이미 사용 중인 이메일입니다",
  RATE_LIMITED: "잠시 후 다시 시도해 주세요",
  BAD_REQUEST: "입력 내용을 확인해 주세요",
  API_UNAVAILABLE: "서버에 연결할 수 없습니다",
};
export async function apiRequest(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(
      errors[data?.error?.code] ??
        data?.error?.message ??
        data?.message ??
        "요청 실패",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
function accountButton() {
  if (document.querySelector("#account-logout")) return;
  const button = document.createElement("button");
  button.id = "account-logout";
  button.className = "button secondary";
  button.textContent = "로그아웃";
  button.onclick = async () => {
    try {
      await apiRequest("/api/v1/auth/logout", "POST");
      location.href = "/";
    } catch (error) {
      button.textContent = error.message;
    }
  };
  document.querySelector(".top-actions,.topbar")?.append(button);
}
export async function ensureAccount() {
  if (!serverMode) return null;
  if (account) return account;
  if (pendingAccount) return pendingAccount;
  pendingAccount = (async () => {
    try {
      account = (await apiRequest("/api/v1/auth/me")).user;
      accountButton();
      return account;
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.id = "account-dialog";
      // Static form markup; all server/user messages below use textContent.
      dialog.innerHTML =
        '<form id="account-form"><h2>로그인</h2><label>이메일<input name="email" type="email" required autocomplete="email"></label><label>비밀번호<input name="password" type="password" minlength="10" maxlength="128" required autocomplete="current-password"></label><p id="account-status" role="status"></p><div class="record-actions"><button type="submit" class="button primary">로그인</button><button id="account-switch" type="button" class="button secondary">회원가입</button></div></form>';
      document.body.append(dialog);
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      dialog.showModal();
      let registering = false;
      const form = dialog.querySelector("form"),
        feedback = dialog.querySelector("#account-status"),
        submit = form.querySelector('[type="submit"]'),
        toggle = dialog.querySelector("#account-switch");
      toggle.onclick = () => {
        registering = !registering;
        form.querySelector("h2").textContent = submit.textContent = registering
          ? "회원가입"
          : "로그인";
        toggle.textContent = registering ? "로그인" : "회원가입";
        form.elements.password.autocomplete = registering
          ? "new-password"
          : "current-password";
        feedback.textContent = "";
      };
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = toggle.disabled = true;
        feedback.textContent = "";
        const data = Object.fromEntries(new FormData(form));
        try {
          if (registering) {
            await apiRequest("/api/v1/auth/register", "POST", data);
            registering = false;
            form.querySelector("h2").textContent = submit.textContent =
              "로그인";
            toggle.textContent = "회원가입";
          }
          account = (
            await apiRequest("/api/v1/auth/login", "POST", {
              email: data.email,
              password: data.password,
            })
          ).user;
          dialog.close();
          dialog.remove();
          accountButton();
          resolve(account);
        } catch (error) {
          feedback.textContent = error.message;
        } finally {
          submit.disabled = toggle.disabled = false;
        }
      };
    });
  })();
  try {
    return await pendingAccount;
  } catch (error) {
    pendingAccount = null;
    throw error;
  }
}
