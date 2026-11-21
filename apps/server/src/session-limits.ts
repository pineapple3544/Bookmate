import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

export function sessionLimits(secure: boolean) {
  const cookieName = secure ? "__Host-bookmate_session" : "bookmate_session";
  const verified = new Map<string, { userId: string; expiresAt: Date }>();

  function token(req: FastifyRequest) {
    return (req.headers.cookie ?? "").split(";").map(pair => pair.trim())
      .find(pair => pair.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "";
  }

  return {
    cookieName,
    token,
    // Used only for rate accounting. Every protected request still verifies its DB session.
    key(req: FastifyRequest) {
      const raw = token(req);
      if (/^[a-f0-9]{64}$/.test(raw)) {
        const hash = createHash("sha256").update(raw).digest("hex");
        const entry = verified.get(hash);
        if (entry && entry.expiresAt.getTime() > Date.now()) return "user:" + entry.userId;
        if (entry) verified.delete(hash);
      }
      return "ip:" + req.ip;
    },
    remember(session: { tokenHash: string; userId: string; expiresAt: Date }) {
      verified.delete(session.tokenHash);
      if (verified.size >= 10000) verified.delete(verified.keys().next().value!);
      verified.set(session.tokenHash, { userId: session.userId, expiresAt: session.expiresAt });
    },
    forget(hash: string) {
      verified.delete(hash);
    },
  };
}
