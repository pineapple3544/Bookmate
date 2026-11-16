import { getSharedRecords } from "./record-bridge.js";
import { openDatabase } from "./local-transport.js";
// Retain the earlier text/drawing records alongside the team's photo feed.
export function attachNotes({ getSelected, canOpen, onSave }) {
  const feed = document.querySelector("#record-feed");
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "button secondary";
  entry.id = "text-records";
  entry.textContent = "텍스트 기록";
  feed.append(entry);
  const dialog = document.createElement("dialog");
  dialog.id = "text-record-dialog";
  dialog.innerHTML =
    '<form><div class="dialog-heading"><h2>텍스트 기록</h2><button type="button" class="button secondary" data-close>닫기</button></div><label>페이지<input name="page" type="number" min="1" max="99999" required value="1"></label><label>내용<textarea name="text" maxlength="2000" rows="4"></textarea></label><label>그림</label><canvas width="400" height="180" aria-label="텍스트 기록 그림"></canvas><p role="status"></p><div class="record-actions"><button type="button" data-clear class="button secondary">그림 지우기</button><button type="button" data-delete class="button secondary">기록 삭제</button><button type="submit" class="button primary">저장</button></div></form>';
  document.body.append(dialog);
  const form = dialog.querySelector("form"),
    page = form.elements.page,
    text = form.elements.text,
    canvas = dialog.querySelector("canvas"),
    ctx = canvas.getContext("2d"),
    status = dialog.querySelector('[role="status"]'),
    save = form.querySelector('[type="submit"]');
  let busy = false,
    dirty = false,
    loaded = 1,
    drawing = false;
  async function load(number) {
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
      text.value = record?.text ?? "";
      ctx.clearRect(0, 0, 400, 180);
      if (record?.drawing) {
        const image = new Image();
        image.src = record.drawing;
        await image.decode();
        ctx.drawImage(image, 0, 0);
      }
      loaded = number;
      dirty = false;
    } catch {
      status.textContent = "기록 불러오기 실패";
      return;
    } finally {
      busy = false;
      page.disabled = text.disabled = false;
      save.disabled = Boolean(status.textContent);
    }
  }
  function close() {
    if (!busy && (!dirty || confirm("저장하지 않은 내용을 버릴까요?")))
      dialog.close();
  }
  dialog.querySelector("[data-close]").onclick = close;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  entry.onclick = () => {
    if (!canOpen()) return;
    dialog.showModal();
    void load(Number(page.value));
  };
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
    drawing = dirty = true;
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
    }
  };
  async function persist(remove) {
    if (
      busy ||
      !canOpen() ||
      save.disabled ||
      Number(page.value) !== loaded ||
      !form.reportValidity()
    )
      return;
    busy = true;
    save.disabled = true;
    try {
      const db = await openDatabase();
      if(getSharedRecords())await getSharedRecords().request(remove?"delete-note":"note",{key:[getSelected(),loaded],text:text.value.trim(),drawing:canvas.toDataURL("image/png")});
      else await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite"),
          store = tx.objectStore("records"),
          key = [getSelected(), loaded],
          request = store.get(key);
        request.onsuccess = () => {
          const existing = request.result;
          if (remove) {
            if (existing?.photo) {
              const { text, drawing, ...photo } = existing;
              store.put(photo);
            } else store.delete(key);
          } else
            store.put({
              ...existing,
              slot: getSelected(),
              page: loaded,
              text: text.value.trim(),
              drawing: canvas.toDataURL("image/png"),
              updatedAt: new Date().toISOString(),
            });
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      dirty = false;
      onSave(loaded);
      dialog.close();
    } catch {
      status.textContent = "저장 실패";
    } finally {
      busy = false;
      save.disabled = false;
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    void persist(false);
  };
  dialog.querySelector("[data-delete]").onclick = () => {
    if (confirm("이 페이지의 텍스트와 그림을 삭제할까요?")) void persist(true);
  };
}
