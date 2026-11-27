import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

// Accept only a fixed-size RGB raster. The server creates the PNG itself.
const width = 240, height = 330;
export const coverPayloadLimit = 330 * 1024;
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
export function encodeCover(pixels) {
  if (typeof pixels !== "string" || pixels.length !== width * height * 4 ||
      /[^A-Za-z0-9+/]/.test(pixels)) return null;
  const rgb = Buffer.from(pixels, "base64");
  const row = width * 3;
  const raster = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raster, y * (row + 1) + 1, y * row, (y + 1) * row);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const image = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(raster, { level: 3 })), chunk("IEND", Buffer.alloc(0))]);
  return { hash: createHash("sha256").update(image).digest("hex"), image };
}
