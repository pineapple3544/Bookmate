import { deleteRoomDatabase } from "./local-transport.js";
import { serverMode, serverAvailable, ensureAccount, apiRequest } from "./account.js";
export const exchangeCode = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";
const key = code => "bookmate-exchange:" + code;
// 책 표지 색. 키(mint, plum …)는 서버가 검증하는 값이라 그대로 두고, 색만 양장본 천 표지 톤으로 맞춥니다.
export const themes = {
  mint: "#3d5a48", plum: "#6b2f3c", rust: "#87452f", blue: "#2c4262",
  butter: "#8f6f34", rose: "#86505b", cocoa: "#56402f",
};
export const exchangeUrl = (code, screen = "waiting") => "/?code=" + encodeURIComponent(code) + "&screen=" + screen + (!serverMode && new URLSearchParams(location.search).has("local") ? "&local=1" : "");

export function previewHeaders(code) {
  const storageKey = "bookmate-preview-identity-v1";
  let identity = localStorage.getItem(storageKey);
  if (!identity) {
    identity = crypto.randomUUID();
    localStorage.setItem(storageKey, identity);
  }
  const headers = { "x-bookmate-profile": identity };
  const token = code && localStorage.getItem(key(code));
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

const defaultAppearanceKey = "bookmate-default-appearance-v1";
export async function getDefaultAppearance() {
  if (serverMode) {
    await ensureAccount();
    return (await apiRequest("/api/v1/me/appearance")).appearance;
  }
  const saved = localStorage.getItem(defaultAppearanceKey);
  if (!saved) return null;
  try {
    const value = JSON.parse(saved);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
export async function saveDefaultAppearance(appearance) {
  if (serverMode) {
    await ensureAccount();
    return (await apiRequest("/api/v1/me/appearance", "PATCH", appearance)).appearance;
  }
  localStorage.setItem(defaultAppearanceKey, JSON.stringify(appearance));
  return appearance;
}

export async function myExchanges() {
  if(serverMode){
    await ensureAccount();const codes=[];let cursor;
    do { const data=await apiRequest("/api/v1/exchanges"+(cursor?"?before="+cursor:""));codes.push(...data.codes);cursor=data.nextCursor; }while(cursor);
    return codes;
  }
  return Object.keys(localStorage).filter(name => name.startsWith(key(""))).map(name => name.slice(key("").length));
}
export async function leaveExchange(room, confirmation) {
  const result = await exchangeRequest(room.code, "leave", confirmation);
  try {
    if (!serverMode) localStorage.removeItem(key(room.code));
    localStorage.removeItem("bookmate-pixel-prototype-v1:" + room.code);
    if (result.deleted) {
      for (let slot = 0; slot < room.capacity; slot++) {
        localStorage.removeItem("bookmate-avatar-v1:" + room.code + ":" + slot);
        localStorage.removeItem("bookmate-local-user-v1:" + room.code + ":" + slot);
      }
      deleteRoomDatabase(room.code);
    }
  } catch { /* The server has already confirmed departure. */ }
  return result;
}

export async function exchangeRequest(code = "", action = "", body) {
  if(serverMode){
    await ensureAccount();
    const data=await apiRequest("/api/v1/exchanges"+(code?"/"+encodeURIComponent(code):"")+(action?"/"+action:""),body!==undefined?"POST":"GET",body);
    return data.room??data;
  }
  const headers = previewHeaders(code);
  const viewer = new URLSearchParams(location.search).get("viewer");
  if (viewer && code === exchangeCode && location.pathname === "/room.html") headers["x-bookmate-demo-viewer"] = viewer;
  if (body && (!code || action === "join")) {
    const appearance = await getDefaultAppearance();
    if (appearance) body = { ...body, appearance };
  }
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/exchanges" + (code ? "/" + encodeURIComponent(code) : "") + (action ? "/" + action : ""), {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message), { status: response.status });
  if (data.token) localStorage.setItem(key(data.room.code), data.token);
  if (action === "finish" && data.completedAt && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("bookmate-local-completed");
    channel.postMessage(code);
    channel.close();
  }
  return data.room ?? data;
}

if (new URLSearchParams(location.search).get("local") === "1" ||
    (location.pathname === "/room.html" && !exchangeCode)) {
  const profileLink = document.querySelector('.bookmate-nav a[href="/?screen=profile"]');
  if (profileLink) profileLink.href += "&local=1";
}

// Keep explicitly selected local/demo navigation local.
if(!serverAvailable && new URLSearchParams(location.search).has("local")){
  document.addEventListener("click",event=>{
    const anchor=event.target.closest?.("a[href]");if(!anchor)return;
    const url=new URL(anchor.href,location.href);if(url.origin===location.origin){url.searchParams.set("local","1");anchor.href=url.href;}
  },true);
}
