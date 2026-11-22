// Size all writing fields, including editors created after page load.
const widths = new WeakMap();
const observed = new Set();
let scheduled = false;
function resize(field) {
  if (!field.getClientRects().length) return;
  const style = getComputedStyle(field);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const minimum = Math.max(parseFloat(style.minHeight) || 0,
    lineHeight * (field.rows || 2) + padding + border);
  field.style.height = "auto";
  field.style.height = Math.ceil(Math.max(minimum, field.scrollHeight + border)) + "px";
}
function refresh() {
  scheduled = false;
  for (const field of observed) {
    if (!field.isConnected) {
      observer.unobserve(field);
      observed.delete(field);
      widths.delete(field);
    }
  }
  document.querySelectorAll("textarea").forEach(field => {
    if (!observed.has(field)) {
      observed.add(field);
      observer.observe(field);
    }
    widths.set(field, field.clientWidth);
    resize(field);
  });
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(refresh);
}
const observer = new ResizeObserver(entries => {
  for (const { target } of entries) {
    if (widths.get(target) !== target.clientWidth) {
      widths.set(target, target.clientWidth);
      schedule();
    }
  }
});
document.addEventListener("input", event => {
  if (event.target instanceof HTMLTextAreaElement) resize(event.target);
});
document.addEventListener("focusin", event => {
  if (event.target instanceof HTMLTextAreaElement) resize(event.target);
});
document.addEventListener("reset", () => setTimeout(schedule, 0));
new MutationObserver(schedule).observe(document.body, {
  subtree: true, childList: true, attributes: true,
  attributeFilter: ["open", "hidden", "class"],
});
window.addEventListener("resize", schedule);
document.fonts?.ready.then(schedule);
schedule();
