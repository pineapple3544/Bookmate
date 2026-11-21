import { avatarOptions, bottomPatterns, colorableBottoms, drawAvatar, drawAvatarOption, lockedAvatarOptions, normalizeAppearance, normalizePetLook, skinTone } from "./avatar.js";

export const petCollectionKeyFor = accountId => "bookmate-book-pets-v1" + (accountId ? ":" + accountId : "");

export function bookPetId(title, author) {
  return "exchange:" + JSON.stringify([title.normalize("NFC"), author.normalize("NFC")]);
}

export function normalizePetId(id) {
  if (typeof id !== "string") return "";
  const separator = id.indexOf("\u0000");
  if (!id.startsWith("exchange:") || separator === -1) return id;
  return bookPetId(id.slice("exchange:".length, separator), id.slice(separator + 1));
}

export function appearanceWithPet(value) {
  const pet = normalizePetId(value?.pet);
  const petLook = pet && normalizePetLook(value?.petLook);
  return { ...normalizeAppearance(value), pet, ...(petLook ? { petLook } : {}) };
}

export function equippedPet(appearance, collection) {
  const id = appearance.pet;
  if (!id) return null;
  if (appearance.petLook) return { id, ...appearance.petLook };
  const earned = collection.find(book => book.id === id);
  if (earned) return earned;
  let title = "책 펫";
  if (id.startsWith("exchange:")) {
    try {
      const parts = JSON.parse(id.slice("exchange:".length));
      if (Array.isArray(parts) && typeof parts[0] === "string") {
        const label = parts[0].replace(/[\u0000-\u001f\u007f]/g, "").trim();
        title = Array.from(label).slice(0, 80).join("") || title;
      }
    } catch { /* An older pet ID may have no encoded book information. */ }
  }
  return { id, title, color: "#9db795", art: "#594236" };
}

export function readPets(value) {
  try {
    const books = JSON.parse(value);
    return Array.isArray(books) ? books.flatMap(book => {
      const id = normalizePetId(book?.id);
      const look = normalizePetLook(book);
      return id && look ? [{ id, ...look }] : [];
    }) : [];
  } catch {
    return [];
  }
}

export function loadPets(key) {
  try {
    return readPets(localStorage.getItem(key));
  } catch {
    return [];
  }
}

export function drawBookPet(context, book, x, y, scale = 1) {
  const fill = (left, top, width, height, color) => {
    context.fillStyle = color;
    context.fillRect(x + left * scale, y + top * scale, width * scale, height * scale);
  };
  fill(0, 0, 14, 17, "#38342e");
  fill(2, 2, 11, 14, book.color);
  fill(11, 2, 2, 14, "#ffebd58c");
  fill(3, 6, 7, 1, book.art);
  fill(3, 8, 4, 1, book.art);
  fill(3, 13, 8, 3, book.art);
  fill(6, 11, 2, 3, book.art);
}

export function createWardrobe(container, { getPets, save, onSaved }) {
  container.innerHTML = `
    <div class="avatar-awning" aria-hidden="true">
      <img src="./avatar-shop-awning.png" alt="" width="2172" height="724" />
    </div>
    <div class="avatar-shop-panel">
      <div class="avatar-preview">
        <div class="avatar-preview-stage">
          <canvas id="avatar-preview" width="190" height="148" aria-label="캐릭터와 책 표지 펫 미리보기"></canvas>
          <span id="avatar-pet-title"></span>
        </div>
        <span id="avatar-owner"></span>
      </div>
      <form id="avatar-form">
        <p id="costume-notice" role="status" aria-atomic="true"></p>
        <div class="avatar-categories" role="group" aria-label="꾸미기 항목"></div>
        <div class="avatar-options"></div>
        <p id="avatar-status" role="status" hidden></p>
        <div class="avatar-actions">
          <button id="avatar-defaults" class="button secondary" type="button">기본 외형</button>
          <div class="avatar-confirm-actions">
            <button id="avatar-cancel" class="button secondary" type="button">취소</button>
            <button class="button primary" type="submit">저장</button>
          </div>
        </div>
      </form>
    </div>`;
  const $ = selector => container.querySelector(selector);
  const avatarForm = $("#avatar-form");
  const avatarPreview = $("#avatar-preview").getContext("2d");
  const avatarStatus = $("#avatar-status");
  const categoryBar = $(".avatar-categories");
  const optionGroups = $(".avatar-options");
  const optionPreviews = [];
  const avatarMenus = {
    hair: { title: "헤어", options: ["hairstyle", "hair"] },
    skin: { title: "피부", options: ["skin"] },
    top: { title: "상의", options: ["top", "clothes"] },
    bottom: { title: "하의", options: ["bottom", "bottomColor"] },
    shoes: { title: "신발", options: ["shoes"] },
    accessory: { title: "액세서리", options: ["accessory"] },
    expression: { title: "표정", options: ["expression"] },
    pet: { title: "펫", options: ["pet"] },
  };
  const optionFields = new Map();
  let activeCategory = "hair";
  let showTopColors = false;
  let editingSlot = 0;
  let savedAppearance;
  const petChoices = new Map();
  let opener;
  let saving = false;
  const modal = container instanceof HTMLDialogElement;

  function draftAppearance() {
    return normalizeAppearance({ ...Object.fromEntries(new FormData(avatarForm)), palette: savedAppearance?.palette });
  }
  const costumeParts = ["bottom", "bottomColor", "shoes", "accessory"];
  const isCostume = top => lockedAvatarOptions(top).includes("bottom");
  let previousTop = "tee";
  let costumeNoticeAnimation;
  const costumeNotice = $("#costume-notice");

  function leaveCostume(category) {
    if (!costumeParts.includes(category) || !isCostume(avatarForm.elements.top.value)) return;
    avatarForm.elements.top.value = previousTop;
    costumeNoticeAnimation?.cancel();
    costumeNotice.textContent = "";
    previewAppearance();
  }
  function previewAppearance() {
    const draft = draftAppearance();
    const locked = lockedAvatarOptions(draft.top);
    const wearingOveralls = draft.bottom === "overalls" && !isCostume(draft.top);
    for (const input of optionFields.get("top").querySelectorAll('input[name="top"]')) {
      input.disabled = wearingOveralls && input.value !== "tee";
    }
    optionFields.get("clothes").hidden = wearingOveralls || !showTopColors || locked.includes("clothes");
    optionFields.get("bottomColor").hidden = !colorableBottoms.has(draft.bottom) || locked.includes("bottomColor");
    avatarPreview.clearRect(0, 0, avatarPreview.canvas.width, avatarPreview.canvas.height);
    const scale = 3.6;
    const centerX = avatarPreview.canvas.width / 2;
    drawAvatar(avatarPreview, centerX - 14 * scale, 39, editingSlot, draft, { scale });
    const selectedPet = new FormData(avatarForm).get("pet");
    const pet = petChoices.get(selectedPet);
    if (pet) drawBookPet(avatarPreview, pet, 153, 92, 2);
    $("#avatar-pet-title").textContent = pet?.title ?? "";
    skinShade.style.background = `linear-gradient(90deg, ${skinTone(draft.skin, 0)}, ${skinTone(draft.skin, 50)}, ${skinTone(draft.skin, 100)})`;
    for (const { context, category, value } of optionPreviews) {
      if (avatarMenus[activeCategory].options.includes(category)) {
        drawAvatarOption(context, category, value, editingSlot, draft);
      }
    }
  }
  function setAppearanceFields(appearance) {
    for (const input of avatarForm.querySelectorAll('input[type="radio"]')) {
      input.checked = input.value === (appearance[input.name] ?? "");
    }
    skinShade.value = appearance.skinShade;
    avatarStatus.hidden = true;
    previewAppearance();
  }
  function showCategory(category) {
    activeCategory = category;
    optionGroups.scrollTop = 0;
    for (const button of categoryBar.children) {
      button.setAttribute("aria-pressed", String(button.dataset.category === category));
    }
    for (const group of optionGroups.children) group.hidden = group.dataset.category !== category;
    previewAppearance();
  }
  function addCategory(category, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-category";
    button.dataset.category = category;
    button.textContent = title;
    button.addEventListener("click", () => showCategory(category));
    categoryBar.append(button);
    const group = document.createElement("div");
    group.dataset.category = category;
    optionGroups.append(group);
    return group;
  }
  function makeTile(tiles, category, value, caption) {
    const tile = document.createElement("label");
    tile.className = "avatar-tile";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = category;
    input.value = value;
    const face = document.createElement("span");
    face.className = "avatar-tile-face";
    tile.append(input, face);
    tiles.append(tile);
    if (caption) {
      const text = document.createElement("span");
      text.textContent = caption;
      face.append(text);
    }
    return { input, face };
  }
  function addOptionField(category) {
    const { title, items, sections } = avatarOptions[category];
    const group = document.createElement("fieldset");
    group.dataset.option = category;
    const legend = document.createElement("legend");
    legend.textContent = title;
    if (["top", "bottom", "accessory", "expression"].includes(category)) legend.className = "sr-only";
    group.append(legend);
    optionFields.set(category, group);
    for (const [heading, keys] of sections ?? [["", Object.keys(items)]]) {
      if (heading) {
        const label = document.createElement("h3");
        label.className = "avatar-section-heading";
        label.textContent = heading;
        group.append(label);
      }
      const tiles = document.createElement("div");
      tiles.className = "avatar-tiles";
      for (const [index, value] of keys.entries()) {
        const label = items[value];
        const swatchCategory = category === "skin" || category === "shoes" || (category === "bottomColor" && value !== "default");
        const { input, face } = makeTile(tiles, category, value, swatchCategory ? "" : label);
        if (swatchCategory) {
          const swatch = document.createElement("span");
          swatch.className = "skin-swatch";
          swatch.style.background = bottomPatterns[value] ?? label;
          swatch.setAttribute("aria-hidden", "true");
          const toneNames = { peach: "밝은 피부색", sand: "중간 피부색", bronze: "구릿빛", umber: "짙은 갈색", lime: "연두", red: "빨강", gray: "회색", blue: "파랑", violet: "보라" };
          input.setAttribute("aria-label", category === "skin" ? toneNames[value] : category === "bottomColor" ? (Object.hasOwn(bottomPatterns, value) ? label : avatarOptions.clothes.items[value] ?? "검정") : title + " " + (index + 1));
          face.append(swatch);
        } else if (value !== "none" && category !== "bottomColor") {
          const icon = document.createElement("canvas");
          icon.width = icon.height = 40;
          icon.setAttribute("aria-hidden", "true");
          optionPreviews.push({ context: icon.getContext("2d"), category, value });
          face.prepend(icon);
        }
      }
      group.append(tiles);
    }
    return group;
  }
  for (const [category, { title, options }] of Object.entries(avatarMenus)) {
    const panel = addCategory(category, title);
    for (const option of options) {
      if (option !== "pet") panel.append(addOptionField(option));
    }
  }
  optionFields.get("top").querySelector(".avatar-tiles").after(optionFields.get("clothes"));
  const skinControl = document.createElement("label");
  skinControl.className = "skin-control";
  skinControl.textContent = "피부색 밝기";
  const skinShade = document.createElement("input");
  skinShade.type = "range";
  skinShade.name = "skinShade";
  skinShade.min = "0";
  skinShade.max = "100";
  skinShade.value = "50";
  skinControl.append(skinShade);
  optionFields.get("skin").append(skinControl);

  const petGroup = optionGroups.querySelector('[data-category="pet"]');
  const petTiles = document.createElement("div");
  petTiles.className = "avatar-tiles";
  const petHint = document.createElement("p");
  petHint.className = "pet-empty";
  petHint.textContent = "교환독서를 완료하면 나만의 책 펫이 생겨요.";
  petGroup.append(petTiles, petHint);
  function renderPetOptions(selectedPet = "") {
    const earned = getPets();
    petChoices.clear();
    for (const book of earned) petChoices.set(book.id, book);
    const equipped = equippedPet(savedAppearance, earned);
    if (equipped) petChoices.set(equipped.id, equipped);
    petTiles.replaceChildren();
    petHint.hidden = petChoices.size > 0;
    makeTile(petTiles, "pet", "", "없음").input.checked = !petChoices.has(selectedPet);
    for (const book of petChoices.values()) {
      const { input, face } = makeTile(petTiles, "pet", book.id, book.title);
      input.checked = book.id === selectedPet;
      const cover = document.createElement("canvas");
      cover.width = cover.height = 40;
      cover.setAttribute("aria-hidden", "true");
      drawBookPet(cover.getContext("2d"), book, 6, 3, 2);
      face.prepend(cover);
    }
  }
  function restore() {
    previousTop = isCostume(savedAppearance.top) ? "tee" : savedAppearance.top;
    showTopColors = false;
    costumeNoticeAnimation?.cancel();
    costumeNotice.textContent = "";
    renderPetOptions(savedAppearance.pet);
    setAppearanceFields(savedAppearance);
    showCategory("hair");
  }
  function open({ appearance, slot = 0, owner, trigger }) {
    editingSlot = slot;
    opener = trigger;
    savedAppearance = appearanceWithPet(appearance);
    $("#avatar-owner").textContent = owner;
    restore();
    if (modal) container.showModal();
  }
  function cancel() {
    if (saving) return;
    if (modal) container.close();
    else restore();
  }
  $("#avatar-cancel").addEventListener("click", cancel);
  if (modal) {
    container.addEventListener("cancel", event => {
      if (saving) event.preventDefault();
    });
  } else {
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) cancel();
    });
  }
  avatarForm.addEventListener("change", event => {
    const { name, value } = event.target;
    if (name === "top") {
      showTopColors = true;
      if (isCostume(value)) {
        costumeNoticeAnimation?.cancel();
        costumeNotice.textContent = "코스튬에는 하의, 신발, 액세서리가 포함돼요.";
        const end = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0;
        costumeNoticeAnimation = costumeNotice.animate(
          [{ opacity: 1 }, { opacity: 1, offset: .72 }, { opacity: end }], 1800,
        );
        costumeNoticeAnimation.onfinish = () => { costumeNotice.textContent = ""; };
      } else {
        previousTop = value;
        costumeNoticeAnimation?.cancel();
        costumeNotice.textContent = "";
      }
    } else {
      applyPartSelection(event.target);
    }
    previewAppearance();
  });
  function applyPartSelection({ name, value }) {
    leaveCostume(name);
    if (name === "bottom" && value === "overalls") {
      avatarForm.elements.top.value = "tee";
      avatarForm.elements.clothes.value = "default";
      previousTop = "tee";
      previewAppearance();
    }
  }
  avatarForm.addEventListener("click", event => applyPartSelection(event.target));
  container.addEventListener("close", () => {
    opener?.focus({ preventScroll: true });
    costumeNoticeAnimation?.cancel();
    costumeNotice.textContent = "";
  });
  optionFields.get("top").addEventListener("click", event => {
    if (event.target.name === "top" && !showTopColors) {
      showTopColors = true;
      previewAppearance();
    }
  });
  skinShade.addEventListener("input", previewAppearance);
  $("#avatar-defaults").addEventListener("click", () => {
    previousTop = "tee";
    costumeNoticeAnimation?.cancel();
    costumeNotice.textContent = "";
    setAppearanceFields({ ...normalizeAppearance(), pet: new FormData(avatarForm).get("pet") ?? "" });
  });
  avatarForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    const pet = petChoices.get(new FormData(avatarForm).get("pet"));
    const appearance = { ...draftAppearance(), pet: pet?.id ?? "" };
    if (pet) appearance.petLook = normalizePetLook(pet);
    const submit = avatarForm.querySelector('[type="submit"]');
    saving = true;
    submit.disabled = true;
    $("#avatar-cancel").disabled = true;
    $("#avatar-defaults").disabled = true;
    categoryBar.inert = optionGroups.inert = true;
    avatarStatus.hidden = true;
    try {
      await save(appearance, editingSlot);
      savedAppearance = appearance;
      if (modal) container.close();
      else refreshPets();
      onSaved();
    } catch {
      avatarStatus.textContent = "외형을 저장하지 못했어요. 다시 시도해 주세요.";
      avatarStatus.hidden = false;
    } finally {
      saving = false;
      submit.disabled = false;
      $("#avatar-cancel").disabled = false;
      $("#avatar-defaults").disabled = false;
      categoryBar.inert = optionGroups.inert = false;
    }
  });
  function refreshPets() {
    if (!savedAppearance || (modal && !container.open)) return;
    renderPetOptions(new FormData(avatarForm).get("pet"));
    previewAppearance();
  }
  return { open, refreshPets };
}
