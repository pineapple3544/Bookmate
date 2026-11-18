import assert from "node:assert/strict";
import { test } from "node:test";
import { interactionTarget } from "../public/interaction.js";

const seats = [{x:224,y:192}, {x:268,y:192}];
const cabinet = {x:18,y:148,width:68,height:94};
function target(x, y, seat = null, others = []) {
  const user = { x, y, seat };
  return interactionTarget(user, [user, ...others], seats, cabinet);
}

test("one closest usable target, stable ties, and occupied chairs excluded", () => {
  assert.equal(target(240, 184), 0);
  assert.equal(target(256, 184), 1);
  assert.equal(target(246, 184), 0);
  assert.equal(target(246, 184, null, [{seat:0}]), 1);
  assert.equal(target(246, 184, null, [{seat:0}, {seat:1}]), null);
  assert.equal(target(246, 184, 1), 1);
});

test("wardrobe reach follows the footprint and ends outside the interaction radius", () => {
  assert.equal(target(52, 258), "wardrobe");
  assert.equal(target(122, 192), "wardrobe");
  assert.equal(target(123, 192), null);
  assert.equal(target(500, 320), null);
});
