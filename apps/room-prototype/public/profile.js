import { apiRequest, serverMode, localExchangeAvailable } from "./account.js";
import { exchangeRequest, myExchanges, previewHeaders, themes } from "./exchange-client.js";

const previewKey = "bookmate-preview-profile-v1";

async function previewRequest(path, profile, code) {
  const headers = previewHeaders(code);
  if (profile) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/exchanges/" + path, {
    headers, method: profile ? "PATCH" : "GET", body: profile && JSON.stringify(profile), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  return data;
}
export async function peerProfile(exchange, slot) {
  if (!exchange) return { profilePublic: false };
  const path = "/members/" + exchange.members[slot].id + "/profile";
  return serverMode ? apiRequest("/api/v1/rooms/" + exchange.id + path)
    : previewRequest(exchange.code + path, undefined, exchange.code);
}

export async function myProfile() {
  if (serverMode) return apiRequest("/api/v1/me/profile");
  if (localExchangeAvailable) {
    // Opening a previously joined preview exchange links its existing membership.
    await Promise.allSettled((await myExchanges()).map(code => exchangeRequest(code)));
    return previewRequest("profile");
  }
  let saved;
  try { saved = JSON.parse(localStorage.getItem(previewKey)); } catch { /* Use the initial profile. */ }
  return { nickname: saved?.nickname ?? "소이", bio: saved?.bio ?? "", profilePublic: false, books: [] };
}

export async function saveProfile(profile) {
  if (serverMode) return apiRequest("/api/v1/me/profile", "PATCH", profile);
  if (localExchangeAvailable) return previewRequest("profile", profile);
  localStorage.setItem(previewKey, JSON.stringify({ nickname: profile.nickname, bio: profile.bio }));
  return profile;
}

export function renderBooks(container, books) {
  container.replaceChildren();
  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "아직 완독한 책이 없어요.";
    container.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "profile-books";
  for (const book of books) {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = book.title;
    row.style.setProperty("--spine", themes[book.theme] ?? themes.mint);
    row.append(title);
    if (book.author) {
      const author = document.createElement("small");
      author.textContent = book.author;
      row.append(author);
    }
    list.append(row);
  }
  container.append(list);
}

export function renderProfileShelf(container, detail, books) {
  container.replaceChildren();
  detail.textContent = books.length ? "" : "아직 완독한 책이 없어요.";
  for (const [index, book] of books.entries()) {
    const spine = document.createElement("button");
    spine.type = "button";
    spine.className = "shelf-book";
    spine.style.setProperty("--spine", themes[book.theme] ?? themes.mint);
    spine.style.setProperty("--book-height", [70, 77, 73, 81][index % 4] + "px");
    const caption = [book.title, book.author].filter(Boolean).join(" · ");
    spine.setAttribute("aria-label", caption);
    const title = document.createElement("span");
    title.textContent = book.title;
    spine.append(title);
    const showBook = () => { detail.textContent = caption; };
    spine.addEventListener("focus", showBook);
    spine.addEventListener("click", showBook);
    container.append(spine);
  }
}
