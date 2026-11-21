import assert from "node:assert/strict";
import test from "node:test";
import { normalizePetLook } from "../public/avatar.js";
import { appearanceWithPet, bookPetId, equippedPet, readPets } from "../public/wardrobe.js";

test("equipped books can be displayed without adding them to the viewer's collection", () => {
  const pet = bookPetId("책", "작가");
  const petLook = { title: "책", color: "#123456", art: "#ee7722" };
  const collection = [];
  assert.deepEqual(equippedPet(appearanceWithPet({ pet, petLook }), collection), { id: pet, ...petLook });
  assert.deepEqual(collection, []);
  assert.equal(equippedPet(appearanceWithPet({ pet: "", petLook }), collection), null);
});

test("legacy books use earned artwork or their original title when no artwork is available", () => {
  const legacy = "exchange:책" + String.fromCharCode(0) + "작가";
  const look = { title: "책", color: "#335577", art: "#11cc22" };
  const collection = readPets(JSON.stringify([{ id: legacy, ...look }]));
  const appearance = appearanceWithPet({ pet: legacy, petLook: { ...look, color: "invalid" } });
  assert.equal(appearance.pet, bookPetId("책", "작가"));
  assert.equal(appearance.petLook, undefined);
  assert.deepEqual(equippedPet(appearance, collection), { id: appearance.pet, ...look });
  assert.equal(equippedPet(appearance, []).title, "책");
  assert.equal(equippedPet(appearanceWithPet({ pet: "old-id" }), []).title, "책 펫");
  assert.equal(normalizePetLook({ ...look, title: " " }), null);
});
