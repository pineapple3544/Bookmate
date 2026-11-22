import { getSharedRecords } from "./record-bridge.js";
import { openDatabase } from "./local-transport.js";
// Keep the existing text/drawing storage in the unified post composer.
export function attachNotes({ getSelected, canOpen }) {
  const dialog = document.querySelector("#record-dialog");
  const form = dialog.querySelector("form"),
    page = document.querySelector("#page"),
    text = document.querySelector("#record-text"),
    canvas = dialog.querySelector("#record-note-drawing canvas"),
    ctx = canvas.getContext("2d"),
    status = document.querySelector("#record-status"),
    save = form.querySelector('[type="submit"]');
  let busy = false,
    dirty = false,
    loaded = 1,
    drawing = false,
    hasDrawing = false,
    originalText = "",
    loadVersion = 0;
  async function load(number) {
    const version = ++loadVersion;
    busy = true;
    save.disabled = true;
    page.disabled = text.disabled = true;
    status.textContent = "";
    try {
      const db = await openDatabase();
      const record = getSharedRecords() ? await getSharedRecords().request("get",[getSelected(),number]) : await new Promise((resolve, reject) => {
        const req = db
          .transaction("records")
          .objectStore("records")
          .get([getSelected(), number]);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (version !== loadVersion) return;
      text.value = originalText = record?.text ?? "";
      hasDrawing = Boolean(record?.drawing);
      document.querySelector("#record-delete-note").hidden = !(record?.text || record?.drawing);
      document.querySelector("#record-note-drawing").hidden = !hasDrawing;
      ctx.clearRect(0, 0, 400, 180);
      if (record?.drawing) {
        const image = new Image();
        const url = record.drawing instanceof Blob ? URL.createObjectURL(record.drawing) : record.drawing;
        try {
          image.src = url;
          await image.decode();
          if (version !== loadVersion) return;
          ctx.drawImage(image, 0, 0);
        } finally {
          if (record.drawing instanceof Blob) URL.revokeObjectURL(url);
        }
      }
      loaded = number;
      dirty = false;
    } catch {
      if (version !== loadVersion) return;
      status.textContent = "기록 불러오기 실패";
      return;
    } finally {
      if (version === loadVersion) {
        busy = false;
        page.disabled = text.disabled = false;
        save.disabled = Boolean(status.textContent);
      }
    }
  }
  page.onchange = () => {
    if (busy) {
      page.value = loaded;
      return;
    }
    if (!page.checkValidity()) return;
    if (dirty && !confirm("저장하지 않은 내용을 버릴까요?")) {
      page.value = loaded;
      return;
    }
    void load(Number(page.value));
  };
  text.oninput = () => (dirty = true);
  const point = (event) => {
    const box = canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) * 400) / box.width,
      ((event.clientY - box.top) * 180) / box.height,
    ];
  };
  canvas.onpointerdown = (event) => {
    if (busy || save.disabled) return;
    canvas.setPointerCapture(event.pointerId);
    drawing = dirty = hasDrawing = true;
    ctx.strokeStyle = "#293d36";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...point(event));
  };
  canvas.onpointermove = (event) => {
    if (drawing) {
      ctx.lineTo(...point(event));
      ctx.stroke();
    }
  };
  canvas.onpointerup =
    canvas.onpointercancel =
    canvas.onlostpointercapture =
      () => (drawing = false);
  dialog.querySelector("[data-clear]").onclick = () => {
    if (!busy) {
      ctx.clearRect(0, 0, 400, 180);
      dirty = true;
      hasDrawing = false;
    }
  };
  async function persist() {
    if (
      busy ||
      !canOpen() ||
      Number(page.value) !== loaded ||
      !form.reportValidity()
    )
      return;
    busy = true;
    save.disabled = true;
    try {
      const db = await openDatabase();
      if(getSharedRecords())await getSharedRecords().request("note",{key:[getSelected(),loaded],text:text.value.trim(),drawing:hasDrawing ? canvas.toDataURL("image/png") : ""});
      else await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite"),
          store = tx.objectStore("records"),
          key = [getSelected(), loaded],
          request = store.get(key);
        request.onsuccess = () => {
          const existing = request.result;
          store.put({
            ...existing,
            slot: getSelected(),
            page: loaded,
            text: text.value.trim(),
            drawing: hasDrawing ? canvas.toDataURL("image/png") : "",
            updatedAt: new Date().toISOString(),
          });
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      dirty = false;
      originalText = text.value;
    } catch {
      throw new Error("글과 그림을 저장하지 못했어요. 다시 게시해 주세요.");
    } finally {
      busy = false;
      save.disabled = false;
    }
  }
  return {
    load,
    dirty: () => dirty || text.value !== originalText,
    hasContent: () => Boolean(text.value.trim() || hasDrawing),
    ready: () => !busy && Number(page.value) === loaded && !save.disabled,
    save: persist,
    async remove() {
      if (busy || !canOpen() || Number(page.value) !== loaded) return;
      if (getSharedRecords()) {
        await getSharedRecords().request("delete-note", { key: [getSelected(), loaded] });
      } else {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("records", "readwrite");
          const store = tx.objectStore("records");
          const key = [getSelected(), loaded];
          const request = store.get(key);
          request.onsuccess = () => {
            const existing = request.result;
            if (existing?.photo) {
              const { text, drawing, ...photo } = existing;
              store.put(photo);
            } else store.delete(key);
          };
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
      }
    },
    reset() {
      loadVersion++;
      busy = false;
      page.disabled = text.disabled = false;
      text.value = originalText = "";
      ctx.clearRect(0, 0, 400, 180);
      hasDrawing = dirty = false;
      document.querySelector("#record-note-drawing").hidden = true;
    },
  };
}
