// Coordinates use the 640 × 400 room, independent of zoom and camera position.
const interactionRadius = 36;

export function seatOccupied(index, user, users) {
  return users.some(other => other !== user && other.seat === index);
}

export function interactionTarget(user, users, seats, cabinet, playerSlots = []) {
  if (user.seat !== null) return user.seat;
  // Distance from the avatar's feet to the cabinet footprint on the floor.
  const dx = Math.max(cabinet.x - user.x, 0, user.x - cabinet.x - cabinet.width);
  const dy = Math.max(cabinet.y + 24 - user.y, 0, user.y - cabinet.y - cabinet.height);
  let closest = Math.hypot(dx, dy);
  let target = closest <= interactionRadius ? "wardrobe" : null;
  for (const [index, seat] of seats.entries()) {
    const distance = Math.hypot(user.x - seat.x, user.y - seat.y);
    if (distance <= interactionRadius && (target === null || distance < closest) &&
        !seatOccupied(index, user, users)) {
      target = index;
      closest = distance;
    }
  }
  for (const slot of playerSlots) {
    const peer = users[slot];
    if (!peer || peer === user) continue;
    const distance = Math.hypot(peer.x - user.x, peer.y - user.y);
    if (distance <= interactionRadius && (target === null || distance < closest)) {
      closest = distance;
      target = "player-" + slot;
    }
  }
  return target;
}
