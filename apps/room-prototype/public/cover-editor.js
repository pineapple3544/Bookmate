const width = 240, height = 330;
export function showCover(book, source) {
  let layer = book.querySelector(".cover-photo");
  book.classList.toggle("illustrated", Boolean(source));
  if (!source) { layer?.remove(); return; }
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "cover-photo";
    layer.setAttribute("aria-hidden", "true");
    book.prepend(layer);
  }
  if (typeof source === "string") {
    const img = new Image();
    img.alt = "";
    img.src = source;
    layer.replaceChildren(img);
  } else layer.replaceChildren(source);
}
export function coverEditor(form) {
  const at = id => form.querySelector("#" + id);
  const book = at("cover-preview"), file = at("cover-file"), zoom = at("cover-zoom");
  const remove = at("cover-remove"), message = at("cover-message");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  let previousZoom = 1;
  let img, left = 0, top = 0, drag, revision = 0, loading = false, changed = false;
  function scale() { return Math.max(width / img.width, height / img.height) * Number(zoom.value); }
  function draw() {
    const factor = scale(), w = img.width * factor, h = img.height * factor;
    left = Math.min(0, Math.max(width - w, left));
    top = Math.min(0, Math.max(height - h, top));
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, left, top, w, h);
  }
  function display(source) {
    showCover(book, source);
    remove.hidden = !source;
    zoom.parentElement.hidden = !img;
    book.classList.toggle("croppable", Boolean(img));
    book.tabIndex = img ? 0 : -1;
  }
  function reset(source) {
    revision++; loading = false; img = null; drag = null; changed = false;
    zoom.value = "1"; previousZoom = 1; file.value = ""; message.textContent = "";
    display(source);
  }
  file.onchange = async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    const request = ++revision;
    loading = true;
    const url = URL.createObjectURL(chosen);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(chosen.type) || chosen.size > 12 * 1024 * 1024)
        throw new Error("12 MB 이하의 JPG, PNG, WebP 이미지를 선택해 주세요.");
      const picture = new Image(); picture.src = url;
      await picture.decode();
      if (request !== revision) return;
      img = picture; changed = true; zoom.value = "1"; previousZoom = 1;
      left = (width - img.width * scale()) / 2;
      top = (height - img.height * scale()) / 2;
      draw(); display(canvas); message.textContent = "";
    } catch (err) {
      if (request === revision) message.textContent = err instanceof Error && err.name === "Error" ? err.message : "이미지를 열 수 없어요.";
    } finally {
      URL.revokeObjectURL(url);
      if (request === revision) { loading = false; file.value = ""; }
    }
  };
  zoom.oninput = () => {
    if (!img) return;
    const ratio = Number(zoom.value) / previousZoom;
    left = width / 2 + (left - width / 2) * ratio;
    top = height / 2 + (top - height / 2) * ratio;
    previousZoom = Number(zoom.value); draw();
  };
  book.onpointerdown = e => {
    if (!img || !e.isPrimary || e.button !== 0) return;
    book.setPointerCapture(e.pointerId); drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  book.onpointermove = e => {
    if (drag?.id !== e.pointerId) return;
    const bounds = book.getBoundingClientRect();
    left += (e.clientX - drag.x) * width / bounds.width;
    top += (e.clientY - drag.y) * height / bounds.height;
    drag.x = e.clientX; drag.y = e.clientY; draw();
  };
  book.onlostpointercapture = () => { drag = null; };
  book.onkeydown = e => {
    if (!img || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    left += e.key === "ArrowRight" ? 8 : e.key === "ArrowLeft" ? -8 : 0;
    top += e.key === "ArrowDown" ? 8 : e.key === "ArrowUp" ? -8 : 0;
    draw();
  };
  remove.onclick = () => { reset(null); changed = true; };
  reset(null);
  return { reset, payload() {
    if (loading) throw new Error("이미지를 불러오는 중이에요.");
    if (!changed) return {};
    if (!img) return { coverPixels: null };
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
    }
    let binary = "";
    for (let i = 0; i < rgb.length; i += 8192) binary += String.fromCharCode(...rgb.subarray(i, i + 8192));
    return { coverPixels: btoa(binary) };
  }};
}
