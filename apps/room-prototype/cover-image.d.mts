export const coverPayloadLimit: number;
export function encodeCover(pixels: unknown): { hash: string; image: Buffer<ArrayBuffer> } | null;
