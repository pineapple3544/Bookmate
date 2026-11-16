import { getSharedRecords } from "./record-bridge.js";
import { attachNotes } from "./legacy-notes.js";
import { openDatabase } from "./local-transport.js";

const replyKey = reply => reply.id ?? reply.slot + ":" + reply.createdAt;

export async function recordRequest(method, value) {
  if(getSharedRecords())return getSharedRecords().request(method,value);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", ["get", "list"].includes(method) ? "readonly" : "readwrite");
    const store = tx.objectStore("records");
    let result;
    let conflict;
    if (method === "get" || method === "list") {
      const request = method === "list" ? store.getAll() : store.get(value);
      request.onsuccess = () => { result = request.result; };
    } else {
      const request = store.get(value.key);
      request.onsuccess = () => {
        const current = request.result;
        if (method === "publish" && !current?.photo) {
          result = { ...current, ...value.post };
          store.put(result);
        } else if (current && current.id === value.postId && method === "reply") {
          result = { ...current, replies: [...current.replies, value.reply] };
          store.put(result);
        } else if (current && current.id === value.postId && ["edit-reply", "delete-reply"].includes(method)) {
          const index = current.replies.findIndex(reply => reply.slot === value.author && replyKey(reply) === value.replyId);
          if (index < 0) {
            conflict = new Error("수정할 댓글을 찾을 수 없어요.");
            return;
          }
          const replies = [...current.replies];
          if (method === "delete-reply") replies.splice(index, 1);
          else replies[index] = { ...replies[index], text: value.text };
          result = { ...current, replies };
          store.put(result);
        } else if (current?.photo && current.id === value.postId && method === "annotate") {
          result = { ...current, annotations: [...(current.annotations ?? []), value.layer] };
          store.put(result);
        } else if (current && current.id === value.postId && method === "delete") {
          store.delete(value.key);
        } else {
          conflict = new Error(method === "publish"
            ? "이 페이지에는 이미 내가 올린 코멘트가 있어요."
            : "다른 탭에서 코멘트가 변경됐어요. 목록을 확인해 주세요.");
        }
      };
    }
    tx.oncomplete = () => conflict ? reject(conflict) : resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("기록을 저장하지 못했어요."));
  });
}

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp"]);
async function readPhoto(file) {
  if (!imageTypes.has(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error("15 MB 이하의 JPEG, PNG, WebP, AVIF, GIF 또는 BMP 사진을 선택해 주세요.");
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return file;
  } catch {
    throw new Error("사진을 열 수 없어요. 다른 파일을 선택해 주세요.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createRecords({ getSelected, getUsers, canOpen, onSave, memberName }) {
  attachNotes({getSelected,canOpen,onSave});
  const feed = document.querySelector("#record-feed");
  const dialog = document.querySelector("#record-dialog");
  const form = document.querySelector("#record-form");
  const page = document.querySelector("#page");
  const input = document.querySelector("#record-photo");
  const submit = form.querySelector('[type="submit"]');
  const posts = document.querySelector("#record-posts");
  const detail = document.querySelector("#record-detail");
  const status = document.querySelector("#record-status");
  const feedback = document.querySelector("#feed-status");
  const toast = document.querySelector("#record-toast");
  let toastAnimation;
  function notify(message) {
    toastAnimation?.cancel();
    toast.textContent = message;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    toastAnimation = toast.animate([
      { opacity: 1 }, { opacity: 1, offset: .72 }, { opacity: reduce ? 1 : 0 },
    ], { duration: 1600 });
    toastAnimation.onfinish = () => { toast.textContent = ""; };
  }
  const fileName = document.querySelector("#record-photo-name");
  const channel = typeof BroadcastChannel === "undefined" ? null
    : new BroadcastChannel("bookmate-records:" + (new URLSearchParams(location.search).get("code") ?? "").toUpperCase());
  const urls = new Set();
  let slot = 0;
  let generation = 0;
  let busy = false;
  let refreshPending = false;
  let viewKey;
  let records = [];
  let activeReply;
  let selectedPost;
  let editingReply;
  const postKey = record => record.slot + ":" + record.page;

  function releaseImages() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }
  function photo(source, alt) {
    const image = element("img", "", "record-image");
    image.alt = alt;
    if (source instanceof Blob) {
      image.src = URL.createObjectURL(source);
      urls.add(image.src);
    } else {
      image.src = source;
    }
    return image;
  }
  function photoStack(record) {
    const stack = element("span", "", "record-photo-stack");
    stack.append(photo(record.photo, "p. " + record.page + " 기록 사진"));
    for (const layer of record.annotations ?? []) {
      const overlay = photo(layer, "");
      overlay.classList.add("record-photo-layer");
      stack.append(overlay);
    }
    return stack;
  }
  function dirty() {
    return input.files.length;
  }
  function mayLeave() {
    return !busy && (!dirty() || confirm("올리지 않은 내용을 버릴까요?"));
  }
  function setBusy(value) {
    busy = value;
    page.disabled = value;
    input.disabled = value;
    submit.disabled = value;
    posts.inert = value;
    detail.inert = value;
    if (!value && refreshPending && !editingReply && !activeReply?.dirty()) void refresh();
  }
  function render() {
    const focusReply = document.activeElement?.id === "reply-text";
    const previousComments = detail.querySelector(".record-comments");
    const scrollTop = previousComments?.scrollTop ?? 0;
    const atBottom = previousComments && scrollTop > 0 &&
      previousComments.scrollHeight - previousComments.clientHeight - scrollTop < 4;
    activeReply = undefined;
    releaseImages();
    posts.replaceChildren();
    detail.replaceChildren();
    for (const record of records) renderPost(record);
    const comments = detail.querySelector(".record-comments");
    if (comments) comments.scrollTop = atBottom ? comments.scrollHeight : scrollTop;
    if (!records.some(record => postKey(record) === selectedPost)) {
      selectedPost = undefined;
      detail.append(element("p", "게시물을 선택하면 댓글을 볼 수 있어요.", "record-hint record-select-hint"));
    }
    if (!records.length) {
      posts.append(element("p", "아직 게시된 코멘트가 없어요.", "record-hint"));
    }
    if (focusReply && feed.open && !dialog.open) {
      detail.querySelector("#reply-text")?.focus({ preventScroll: true });
    }
  }
  async function refresh() {
    if (busy || editingReply || activeReply?.dirty()) {
      refreshPending = true;
      return;
    }
    refreshPending = false;
    const current = ++generation;
    if (!canOpen()) {
      releaseImages();
      posts.replaceChildren();
      detail.replaceChildren();
      records = [];
      feedback.textContent = "";
      return;
    }
    const reader = getSelected();
    try {
      const loaded = await recordRequest("list");
      if (current !== generation || !canOpen() || reader !== getSelected()) return;
      if (busy || editingReply || activeReply?.dirty()) {
        refreshPending = true;
        return;
      }
      slot = reader;
      records = loaded.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.page - b.page);
      render();
    } catch {
      if (current === generation) {
        feedback.textContent = "코멘트를 불러오지 못했어요.";
      }
    }
  }
  function changed(refreshLocally = true) {
    channel?.postMessage("updated");
    if (refreshLocally) refreshPending = true;
  }
  if (channel) channel.onmessage = () => void refresh();
  window.addEventListener("bookmate-records-updated",()=>void refresh());

  function renderPost(record) {
    const article = element("article", "", "record-post");
    const selected = postKey(record) === selectedPost;
    const header = element("span", "", "record-post-byline");
    header.append(element("strong", memberName(record.slot)), element("span", "p. " + record.page));
    const openPost = element("button", "", "record-open-post");
    openPost.type = "button";
    openPost.setAttribute("aria-pressed", String(selected));
    openPost.append(header);
    if (record.updatedAt) {
      const time = element("time", new Date(record.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }));
      time.dateTime = record.updatedAt;
      openPost.append(time);
    }
    openPost.onclick = () => {
      if (selected || busy || ((editingReply || activeReply?.dirty()) && !confirm("작성 중인 댓글을 버릴까요?"))) return;
      editingReply = undefined;
      selectedPost = postKey(record);
      const comments = detail.querySelector(".record-comments");
      if (comments) comments.scrollTop = 0;
      render();
      detail.focus({ preventScroll: true });
      if (refreshPending) void refresh();
    };
    article.append(openPost);
    if (record.photo) {
      openPost.append(photoStack(record));
      if (selected) renderThread(record);
    } else if (selected) {
      detail.append(element("p", "사진 게시물에 댓글을 남길 수 있어요.", "record-hint"));
    }
    if (record.text || record.drawing) {
      const legacy = element("details", "", "record-legacy");
      legacy.append(element("summary", "이전에 남긴 기록"));
      if (record.text) legacy.append(element("p", record.text));
      if (record.drawing) legacy.append(photo(record.drawing, "이전에 남긴 그림"));
      article.append(legacy);
    }
    if (record.slot === slot) {
      const remove = element("button", "삭제", "button secondary record-delete");
      remove.type = "button";
      remove.setAttribute("aria-label", "p. " + record.page + " 게시물 삭제");
      article.classList.add("own-record-post");
      remove.addEventListener("click", async () => {
        if (busy || !confirm("이 기록과 추가 코멘트를 삭제할까요?")) return;
        if (selected) {
          editingReply = undefined;
          activeReply?.close();
          activeReply = undefined;
        }
        setBusy(true);
        try {
          await recordRequest(getSharedRecords() && !record.photo ? "delete-note" : "delete", { key: [slot, record.page], postId: record.id });
          changed();
        } catch (error) {
          feedback.textContent = error.message;
        } finally {
          setBusy(false);
        }
      });
      article.append(remove);
    }
    posts.append(article);
  }

  function renderThread(record) {
    const comments = element("div", "", "record-comments");
    comments.tabIndex = 0;
    comments.setAttribute("aria-label", "댓글 목록");
    if (!record.replies.length) {
      comments.append(element("p", "아직 댓글이 없어요.", "record-hint record-empty-thread"));
    }
    for (const reply of record.replies) {
      const comment = element("article", "", "record-comment");
      const time = element("time", new Date(reply.createdAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }));
      time.dateTime = reply.createdAt;
      const byline = element("header", "", "chat-message-heading");
      byline.append(element("strong", memberName(reply.slot)), time);
      comment.append(byline);
      if (reply.text) comment.append(element("p", reply.text));
      if (reply.photo) comment.append(photo(reply.photo, "댓글에 첨부한 사진"));
      if (reply.drawing) comment.append(photo(reply.drawing, "원본 사진에 그림을 더한 이미지"));
      if (reply.slot === slot) addReplyControls(comment, record, reply);
      comments.append(comment);
    }
    detail.append(comments);
    openReply(record, detail);
  }

  function addReplyControls(comment, record, reply) {
    const actions = element("div", "", "record-reply-actions");
    const edit = element("button", "수정", "button secondary");
    const remove = element("button", "삭제", "button secondary");
    edit.type = remove.type = "button";
    actions.append(edit, remove);
    comment.append(actions);
    async function change(method, text) {
      if (busy || !canOpen() || reply.slot !== getSelected()) return;
      setBusy(true);
      try {
        const updated = await recordRequest(method, {
          key: [record.slot, record.page], postId: record.id,
          author: slot, replyId: replyKey(reply), text,
        });
        records = records.map(item => postKey(item) === postKey(record) ? updated : item);
        editingReply = undefined;
        render();
        changed();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        setBusy(false);
      }
    }
    edit.onclick = () => {
      if (busy || editingReply || activeReply?.dirty()) return;
      const editor = element("form", "", "record-edit-reply");
      const field = element("textarea");
      field.value = reply.text ?? "";
      field.maxLength = 1000;
      field.rows = 2;
      field.setAttribute("aria-label", "댓글 내용 수정");
      const save = element("button", "저장", "button primary");
      const cancel = element("button", "취소", "button secondary");
      cancel.type = "button";
      editor.append(field, save, cancel);
      actions.hidden = true;
      comment.append(editor);
      editingReply = editor;
      field.focus();
      cancel.onclick = () => {
        editor.remove();
        editingReply = undefined;
        actions.hidden = false;
        edit.focus();
        if (refreshPending) void refresh();
      };
      editor.onsubmit = event => {
        event.preventDefault();
        const value = field.value.trim();
        if (value || reply.photo || reply.drawing) void change("edit-reply", value);
        else feedback.textContent = "댓글 내용을 입력해 주세요.";
      };
    };
    remove.onclick = () => {
      if (editingReply || activeReply?.dirty() || !confirm("이 댓글을 삭제할까요?")) return;
      void change("delete-reply");
    };
  }

  function openReply(record, comments) {
    const composer = document.querySelector("#record-reply-template").content.firstElementChild.cloneNode(true);
    const text = composer.querySelector("#reply-text");
    const attachment = composer.querySelector("#reply-photo");
    const attachmentInfo = composer.querySelector("#reply-attachment");
    function showAttachment() {
      attachmentInfo.hidden = !attachment.files.length;
      composer.querySelector("#reply-file-name").textContent = attachment.files[0]?.name ?? "";
    }
    const attachButton = composer.querySelector("#reply-attach");
    const options = composer.querySelector("#reply-options");
    attachButton.onclick = () => {
      options.hidden = !options.hidden;
      attachButton.setAttribute("aria-expanded", String(!options.hidden));
    };
    composer.querySelector("#choose-reply-photo").onclick = () => {
      attachment.click();
      options.hidden = true;
      attachButton.setAttribute("aria-expanded", "false");
    };
    composer.querySelector("#reply-remove-photo").onclick = () => {
      attachment.value = "";
      showAttachment();
    };
    attachment.onchange = showAttachment;
    const toggle = composer.querySelector("#toggle-drawing");
    const drawingPanel = composer.querySelector("#reply-drawing");
    const canvas = composer.querySelector("#drawing");
    const drawingSurface = composer.querySelector("#drawing-surface");
    const saveDrawing = composer.querySelector("#save-drawing");
    const color = composer.querySelector("#drawing-color");
    const context = canvas.getContext("2d");
    const undo = composer.querySelector("#undo-drawing");
    const strokes = [];
    let marked = false;
    let pointer = null;
    let previous;
    const resetCanvas = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      strokes.length = 0;
      marked = false;
      saveDrawing.disabled = true;
      undo.disabled = true;
    };
    toggle.addEventListener("click", async () => {
      if (!drawingPanel.hidden) {
        drawingPanel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        return;
      }
      try {
        if (!drawingSurface.querySelector(".record-image")) drawingSurface.prepend(...photoStack(record).children);
        const original = drawingSurface.querySelector(".record-image");
        await original.decode();
        if (!composer.isConnected) return;
        if (!marked) {
          const scale = Math.min(1, 1400 / Math.max(original.naturalWidth, original.naturalHeight));
          canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
        }
        drawingPanel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      } catch {
        feedback.textContent = "원본 사진을 열 수 없어요.";
      }
    });
    function point(event) {
      const box = canvas.getBoundingClientRect();
      return [(event.clientX - box.left) * canvas.width / box.width,
        (event.clientY - box.top) * canvas.height / box.height];
    }
    function stroke(from, to, ink) {
      context.lineWidth = Math.max(3, canvas.width / 100);
      context.lineCap = "round";
      context.strokeStyle = ink;
      context.beginPath();
      context.moveTo(...from);
      context.lineTo(...to);
      context.stroke();
    }
    canvas.addEventListener("pointerdown", event => {
      if (pointer !== null || event.button !== 0) return;
      event.preventDefault();
      pointer = event.pointerId;
      canvas.setPointerCapture(pointer);
      previous = point(event);
      strokes.push({ ink: color.value, points: [previous, [previous[0] + 0.1, previous[1]]] });
      stroke(previous, strokes.at(-1).points[1], color.value);
      marked = true;
      saveDrawing.disabled = undo.disabled = false;
    });
    canvas.addEventListener("pointermove", event => {
      if (event.pointerId !== pointer) return;
      const next = point(event);
      const current = strokes.at(-1);
      if (!current) return;
      current.points.push(next);
      stroke(previous, next, current.ink);
      previous = next;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(type, event => {
        if (event.pointerId === pointer) pointer = null;
      });
    }
    composer.querySelector("#clear-drawing").addEventListener("click", resetCanvas);
    undo.onclick = () => {
      if (pointer !== null) return;
      strokes.pop();
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const { points, ink } of strokes) {
        for (let i = 1; i < points.length; i++) stroke(points[i - 1], points[i], ink);
      }
      marked = strokes.length > 0;
      saveDrawing.disabled = undo.disabled = !marked;
    };
    saveDrawing.addEventListener("click", async () => {
      if (!marked || busy || !canOpen()) return;
      setBusy(true);
      try {
        const layer = await new Promise((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("그림을 저장하지 못했어요.")), "image/png");
        });
        const updated = await recordRequest("annotate", {
          key: [record.slot, record.page], postId: record.id, layer,
        });
        records = records.map(item => postKey(item) === postKey(record) ? updated : item);
        // Keep any text or photo already prepared for a separate reply.
        const preview = posts.querySelector('[aria-pressed="true"] .record-photo-stack');
        for (const savedLayer of updated.annotations.slice(drawingSurface.querySelectorAll(".record-photo-layer").length)) {
          const overlay = photo(savedLayer, "");
          overlay.classList.add("record-photo-layer");
          drawingSurface.insertBefore(overlay, canvas);
          preview?.append(overlay.cloneNode());
        }
        resetCanvas();
        drawingPanel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        options.hidden = true;
        attachButton.setAttribute("aria-expanded", "false");
        changed(false);
        feedback.textContent = "";
        notify("사진에 그림을 저장했어요.");
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        setBusy(false);
        if (drawingPanel.hidden) attachButton.focus({ preventScroll: true });
      }
    });
    composer.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || editingReply || !canOpen()) return;
      const message = text.value.trim();
      const file = attachment.files[0];
      if (!message && !file) {
        feedback.textContent = "댓글을 입력하거나 사진을 첨부해 주세요.";
        return;
      }
      if (marked) {
        feedback.textContent = "사진 위에 그린 그림을 먼저 저장하거나 지워 주세요.";
        return;
      }
      setBusy(true);
      try {
        const reply = { id: crypto.randomUUID(), slot, text: message, createdAt: new Date().toISOString() };
        if (file) reply.photo = await readPhoto(file);
        const updated = await recordRequest("reply", { key: [record.slot, record.page], postId: record.id, reply });
        records = records.map(item => postKey(item) === postKey(record) ? updated : item);
        render();
        const list = detail.querySelector(".record-comments");
        list.scrollTop = list.scrollHeight;
        detail.querySelector("#reply-text")?.focus({ preventScroll: true });
        changed(false);
        feedback.textContent = "추가 코멘트를 올렸어요.";
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        setBusy(false);
      }
    });
    activeReply = {
      dirty: () => text.value.trim() || attachment.files.length || marked,
      close() {
        composer.remove();
      },
    };
    comments.append(composer);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !canOpen() || !page.reportValidity() || !input.files[0]) return;
    const number = Number(page.value);
    const author = getSelected();
    setBusy(true);
    try {
      const image = await readPhoto(input.files[0]);
      const post = { id: crypto.randomUUID(), slot: author, page: number, photo: image, replies: [], updatedAt: new Date().toISOString() };
      await recordRequest("publish", { key: [author, number], post });
      input.value = "";
      onSave(number);
      changed();
      dialog.close();
      feedback.textContent = "코멘트를 게시했어요.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  input.addEventListener("change", () => {
    fileName.textContent = input.files[0]?.name ?? "사진 선택";
  });
  dialog.addEventListener("cancel", event => {
    if (!mayLeave()) event.preventDefault();
  });
  dialog.querySelector(".close").addEventListener("click", event => {
    if (!mayLeave()) event.stopImmediatePropagation();
  }, true);
  dialog.addEventListener("close", () => {
    input.value = "";
    fileName.textContent = "사진 선택";
  });
  feed.addEventListener("cancel", event => {
    if (busy || ((editingReply || activeReply?.dirty()) && !confirm("작성 중인 코멘트를 버릴까요?"))) event.preventDefault();
  });
  feed.querySelector(".close").addEventListener("click", event => {
    if (busy || ((editingReply || activeReply?.dirty()) && !confirm("작성 중인 코멘트를 버릴까요?"))) event.stopImmediatePropagation();
  }, true);
  feed.addEventListener("close", () => {
    if (feed.open) return;
    selectedPost = undefined;
    editingReply = undefined;
    toastAnimation?.cancel();
    toast.textContent = "";
    activeReply?.close();
    activeReply = undefined;
    if (refreshPending) void refresh();
  });
  document.querySelector("#record-publish").addEventListener("click", () => {
    if (!canOpen() || busy) return;
    page.value = getUsers()[getSelected()].page;
    status.textContent = "";
    dialog.showModal();
  });
  return {
    sync() {
      const key = [getSelected(), canOpen(), ...getUsers().map(user => user.done)].join(":");
      if (key === viewKey) return;
      viewKey = key;
      editingReply = undefined;
      activeReply?.close();
      activeReply = undefined;
      void refresh();
    },
    open() {
      if (!canOpen() || busy) return;
      selectedPost = undefined;
      render();
      feed.showModal();
    },
  };
}
