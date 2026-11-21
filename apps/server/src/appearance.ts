import { Prisma } from "@prisma/client";
import { ApiFailure } from "./errors.js";

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
const hexColor = { type: "string", pattern: hexColorPattern.source };
export const appearanceSchema = {
  type: "object",
  properties: {
    petLook: {
      type: "object",
      required: ["title", "color", "art"],
      properties: { title: { type: "string" }, color: hexColor, art: hexColor },
    },
  },
};

export function appearance(input: any): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const key of [
    "hairstyle",
    "hair",
    "skin",
    "top",
    "clothes",
    "bottom",
    "bottomColor",
    "shoes",
    "accessory",
    "expression",
    "pet",
  ]) {
    const value = input?.[key];
    if (typeof value !== "string") continue;
    if (/[\u0000\uD800-\uDFFF]/u.test(value))
      throw new ApiFailure(400, "BAD_REQUEST");
    result[key] = Array.from(value).slice(0, key === "pet" ? 350 : 40).join("");
  }
  if (result.pet && input.petLook) {
    const { color, art } = input.petLook;
    const title: string = typeof input.petLook.title === "string" ? input.petLook.title.trim() : "";
    if (!title || /[\u0000\uD800-\uDFFF]/u.test(title) ||
        typeof color !== "string" || !hexColorPattern.test(color) ||
        typeof art !== "string" || !hexColorPattern.test(art))
      throw new ApiFailure(400, "BAD_REQUEST");
    result.petLook = { title: Array.from(title).slice(0, 80).join(""), color, art };
  }
  if (input?.palette === "personal") result.palette = "personal";
  if (typeof input?.skinShade === "number" && Number.isFinite(input.skinShade))
    result.skinShade = Math.max(0, Math.min(100, input.skinShade));
  return result;
}

// Hold the default stable until the new membership is committed.
export async function inheritedAppearance(tx: Prisma.TransactionClient, uid: string) {
  const [user] = await tx.$queryRaw<{ defaultAppearance: Prisma.InputJsonObject | null }[]>
    `SELECT "defaultAppearance" FROM "User" WHERE id = ${uid}::uuid FOR SHARE`;
  return user!.defaultAppearance ?? Prisma.DbNull;
}
