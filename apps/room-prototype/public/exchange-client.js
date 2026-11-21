import { serverMode, serverAvailable, ensureAccount, apiRequest } from "./account.js";
export const exchangeCode = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";
const key = code => "bookmate-exchange:" + code;
export const themes = {
  mint: "#9db795", plum: "#c5b1d5", rust: "#e4a185", blue: "#a1bed4",
  butter: "#eac779", rose: "#e4a9b1", cocoa: "#ba947e",
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
export async function exchangeRequest(code = "", action = "", body) {
  if(serverMode){
    await ensureAccount();
    const data=await apiRequest("/api/v1/exchanges"+(code?"/"+encodeURIComponent(code):"")+(action?"/"+action:""),body!==undefined?"POST":"GET",body);
    return data.room??data;
  }
  const headers = previewHeaders(code);
  if (body && (!code || action === "join")) {
    const appearance = await getDefaultAppearance();
    if (appearance) body = { ...body, appearance };
  }
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/exchanges" + (code ? "/" + encodeURIComponent(code) : "") + (action ? "/" + action : ""), {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  if (data.token) localStorage.setItem(key(data.room.code), data.token);
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
