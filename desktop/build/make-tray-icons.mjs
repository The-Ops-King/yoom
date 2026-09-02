// Emits the two macOS template tray icons: a filled black disc with an
// antialiased edge. Template images must be black + alpha only; macOS recolours
// them for light/dark menu bars.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function disc(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  const radius = size * 0.42;
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - centre, y - centre);
      const alpha = d <= radius - 1 ? 255 : d >= radius ? 0 : Math.round((radius - d) * 255);
      const p = rowStart + 1 + x * 4;
      raw[p] = 0;
      raw[p + 1] = 0;
      raw[p + 2] = 0;
      raw[p + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(here, "trayTemplate.png"), disc(16));
writeFileSync(join(here, "trayTemplate@2x.png"), disc(32));
console.log("wrote build/trayTemplate.png and build/trayTemplate@2x.png");
