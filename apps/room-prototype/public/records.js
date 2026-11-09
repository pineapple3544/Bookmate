import { openDatabase } from "./local-transport.js";

// Each page is independent; a later edit never replaces another page.
export async function recordRequest(method, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "records",
      method === "get" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("records");
    const request =
      method === "put"
        ? store.put(value)
        : method === "delete"
          ? store.delete(value)
          : store.get(value);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error("Record storage failed"));
  });
}
export function createRecords({ getSelected, getUser, onSave, notify }) {
  const dialog = document.querySelector("#record-dialog");
  const form = document.querySelector("#record-form");
  const page = document.querySelector("#page");
  const note = document.querySelector("#note");
  const canvas = document.querySelector("#drawing");
  const context = canvas.getContext("2d");
  const submit = form.querySelector('[type="submit"]');
  const remove = document.querySelector("#delete-record");
  let drawing = false,
    dirty = false,
    busy = false,
    loaded = false,
    loadedPage = 1,
    generation = 0;
  function clear() {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  function markDirty() {
    dirty = true;
  }
  async function load(number) {
    const current = ++generation;
    busy = true;
    loaded = false;
    note.disabled = true;
    submit.disabled = true;
    remove.disabled = true;
    try {
      const record = await recordRequest("get", [getSelected(), number]);
      if (current !== generation) return;
      loadedPage = number;
      const user = getUser();
      note.value = record?.text ?? (number === user.page ? user.note : "");
      clear();
      if (record?.drawing) {
        const image = new Image();
        image.src = record.drawing;
        await image.decode();
        if (current !== generation) return;
        context.drawImage(image, 0, 0);
      }
      dirty = false;
      loaded = true;
      remove.disabled = !record;
    } catch {
      notify("기록 불러오기 실패");
    } finally {
      if (current === generation) {
        busy = false;
        note.disabled = false;
        submit.disabled = !loaded;
      }
    }
  }
  function open() {
    page.value = getUser().page;
    dialog.showModal();
    void load(Number(page.value));
  }
  page.addEventListener("change", () => {
    if (!page.checkValidity()) return;
    if (dirty && !confirm("저장하지 않은 내용을 버릴까요?")) {
      page.value = loadedPage;
      return;
    }
    void load(Number(page.value));
  });
  note.addEventListener("input", markDirty);
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) * canvas.width) / box.width,
      ((event.clientY - box.top) * canvas.height) / box.height,
    ];
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (busy || !loaded) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    dirty = true;
    context.strokeStyle = "#293d36";
    context.fillStyle = "#293d36";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    const [x, y] = point(event);
    context.beginPath();
    context.arc(x, y, 1.5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    context.lineTo(...point(event));
    context.stroke();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(type, () => {
      drawing = false;
    });
  document.querySelector("#clear-drawing").addEventListener("click", () => {
    if (!busy) {
      clear();
      dirty = true;
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !loaded || !form.reportValidity()) return;
    if (Number(page.value) !== loadedPage) {
      await load(Number(page.value));
      return;
    }
    busy = true;
    submit.disabled = true;
    try {
      const text = note.value.trim();
      await recordRequest("put", {
        slot: getSelected(),
        page: loadedPage,
        text,
        drawing: canvas.toDataURL("image/png"),
        updatedAt: new Date().toISOString(),
      });
      onSave(loadedPage, text);
      dirty = false;
      dialog.close();
      notify("저장됨");
    } catch {
      notify("저장 실패");
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  remove.addEventListener("click", async () => {
    if (busy || !confirm("이 페이지 기록을 삭제할까요?")) return;
    busy = true;
    try {
      await recordRequest("delete", [getSelected(), loadedPage]);
      onSave(loadedPage, "");
      dirty = false;
      dialog.close();
      notify("삭제됨");
    } catch {
      notify("삭제 실패");
    } finally {
      busy = false;
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (busy || (dirty && !confirm("저장하지 않은 내용을 버릴까요?")))
      event.preventDefault();
  });
  dialog.querySelector(".close").addEventListener(
    "click",
    (event) => {
      if (busy || (dirty && !confirm("저장하지 않은 내용을 버릴까요?"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  return { open };
}
