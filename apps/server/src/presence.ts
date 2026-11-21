export function createPresenceStore(now: () => number = Date.now) {
  const sessions = new Map<string, { senderSlot: number; expiresAt: number }>();
  function onlineSlots() {
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now()) sessions.delete(id);
    }
    return [
      ...new Set([...sessions.values()].map((session) => session.senderSlot)),
    ].sort();
  }
  return {
    onlineSlots,
    update(sessionId: string, senderSlot: number, active: boolean) {
      onlineSlots();
      if (!active) sessions.delete(sessionId);
      else {
        if (sessions.size >= 1000 && !sessions.has(sessionId)) {
          throw Object.assign(new Error("Too many sessions"), {
            statusCode: 429,
          });
        }
        sessions.set(sessionId, { senderSlot, expiresAt: now() + 25000 });
      }
      return onlineSlots();
    },
  };
}
