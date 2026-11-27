import { exchangeRequest, leaveExchange } from "./exchange-client.js";

export function bindRoomDeletion(list, rooms, removeCard) {
  const dialog = document.querySelector("#room-delete");
  const cancel = dialog.querySelector("#room-delete-cancel");
  const confirm = dialog.querySelector("#room-delete-confirm");
  const question = dialog.querySelector("#room-delete-question");
  const feedback = dialog.querySelector("#room-delete-status");
  let selected, confirmation, submitting = false;
  let press, suppressClick = false;

  async function refresh(selection) {
    confirm.disabled = true;
    confirmation = null;
    question.textContent = "";
    feedback.textContent = "방 정보를 확인하고 있어요.";
    try {
      const room = await exchangeRequest(selection.room.code);
      if (selected !== selection || !dialog.open) return;
      if (room.me < 0) {
        dialog.close();
        removeCard(selection.card);
        return;
      }
      confirmation = { deleteIfLast: room.members.length === 1 };
      question.textContent = confirmation.deleteIfLast
        ? "마지막 참가자예요. 방과 모든 기록을 삭제할까요?"
        : "내 독서방에서 나갈까요? 다른 참가자의 방과 기록은 유지돼요.";
      confirm.textContent = confirmation.deleteIfLast ? "방과 기록 삭제" : "내 독서방에서 삭제";
      feedback.textContent = "";
      confirm.disabled = false;
    } catch (error) {
      if (selected !== selection || !dialog.open) return;
      if (error.status === 404) {
        dialog.close();
        removeCard(selection.card);
      } else feedback.textContent = error.message;
    }
  }
  function open(card) {
    if (dialog.open) return;
    selected = { card, room: rooms.get(card.dataset.code) };
    dialog.querySelector("#room-delete-name").textContent = selected.room.title;
    confirm.textContent = "삭제";
    card.focus({ preventScroll: true });
    dialog.showModal();
    cancel.focus();
    void refresh(selected);
  }
  cancel.onclick = () => { if (!submitting) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (submitting) event.preventDefault(); });
  confirm.onclick = async () => {
    if (submitting || !confirmation) return;
    submitting = true;
    cancel.disabled = confirm.disabled = true;
    try {
      await leaveExchange(selected.room, confirmation);
      dialog.close();
      removeCard(selected.card);
    } catch (error) {
      if (error.status === 409) await refresh(selected);
      else {
        feedback.textContent = error.message;
        confirm.disabled = false;
      }
    } finally {
      submitting = false;
      cancel.disabled = false;
    }
  };

  function endPress() {
    if (press) clearTimeout(press.timer);
    press = undefined;
  }
  list.addEventListener("contextmenu", event => {
    const card = event.target.closest(".room-card");
    if (!card) return;
    event.preventDefault();
    if (press) suppressClick = true;
    endPress();
    open(card);
  });
  list.addEventListener("keydown", event => {
    const card = event.target.closest(".room-card");
    if (!card || !(event.key === "Delete" || event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    open(card);
  });
  // Ignore only the click generated when a held finger is lifted.
  document.addEventListener("pointerdown", () => { suppressClick = false; endPress(); }, true);
  document.addEventListener("click", event => {
    if (suppressClick && event.detail > 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  list.addEventListener("pointerdown", event => {
    const card = event.target.closest(".room-card");
    if (!card || !event.isPrimary || event.pointerType === "mouse" || event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressClick = true;
      endPress();
      open(card);
    }, 550) };
  });
  list.addEventListener("pointermove", event => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) endPress();
  });
  for (const name of ["pointerup", "pointercancel", "scroll"]) document.addEventListener(name, endPress, true);
  window.addEventListener("blur", endPress);
}
