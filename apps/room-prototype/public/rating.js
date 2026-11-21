export function isRating(value) {
  return value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
}

function paintStars(stars, value) {
  for (const [index, star] of Array.from(stars.children).entries()) {
    const fill = Math.min(1, Math.max(0, value - index));
    star.style.setProperty("--star-fill", fill * 100 + "%");
  }
}

export function ratingStars(value) {
  const stars = document.createElement("span");
  stars.className = "rating-stars";
  stars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i++) {
    const star = document.createElement("span");
    star.textContent = "☆";
    stars.append(star);
  }
  paintStars(stars, value);
  return stars;
}

export function setupRating(form) {
  const input = form.elements.rating;
  const picker = input.parentElement;
  const stars = ratingStars(0);
  input.before(stars);

  function sync() {
    const value = Number(input.value);
    paintStars(stars, value);
    input.setAttribute("aria-valuetext", isRating(value) ? value + "점" : "별점 미선택");
    input.setCustomValidity(isRating(value) ? "" : "별점을 선택해 주세요.");
  }

  function pick(event) {
    const { left, width } = input.getBoundingClientRect();
    input.value = Math.min(10, Math.max(1, Math.ceil((event.clientX - left) / width * 10))) / 2;
    sync();
  }

  input.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    picker.dataset.pointer = "";
    input.focus({ preventScroll: true });
    input.setPointerCapture(event.pointerId);
    pick(event);
  });
  input.addEventListener("pointermove", event => {
    if (input.hasPointerCapture(event.pointerId)) pick(event);
  });
  input.addEventListener("pointerup", event => {
    if (input.hasPointerCapture(event.pointerId)) pick(event);
  });
  input.addEventListener("input", sync);
  function restoreKeyboardFocus() {
    delete picker.dataset.pointer;
  }
  input.addEventListener("keydown", restoreKeyboardFocus);
  input.addEventListener("blur", restoreKeyboardFocus);
  form.addEventListener("reset", () => queueMicrotask(sync));
  sync();
  return value => {
    input.value = isRating(value) ? value : 0;
    sync();
  };
}
