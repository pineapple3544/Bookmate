export const exchangeCode = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";
const key = code => "bookmate-exchange:" + code;
export const themes = {
  mint: "#9db795", plum: "#c5b1d5", rust: "#e4a185", blue: "#a1bed4",
  butter: "#eac779", rose: "#e4a9b1", cocoa: "#ba947e",
};
export const exchangeUrl = (code, screen = "waiting") => "/?code=" + encodeURIComponent(code) + "&screen=" + screen;

export function myExchanges() {
  return Object.keys(localStorage).filter(name => name.startsWith(key(""))).map(name => name.slice(key("").length));
}
export async function exchangeRequest(code = "", action = "", body) {
  const headers = {};
  const token = code && localStorage.getItem(key(code));
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/exchanges" + (code ? "/" + encodeURIComponent(code) : "") + (action ? "/" + action : ""), {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  if (data.token) localStorage.setItem(key(data.room.code), data.token);
  return data.room ?? data;
}
