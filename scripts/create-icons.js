// Draws the extension icon (green music note with a "+" on a dark rounded
// square) and writes icons/icon{16,48,128}.png. No image dependencies: shapes
// are defined on a 128-unit canvas, supersampled, and encoded as PNG by hand.
import fs from "fs";
import path from "path";
import zlib from "zlib";

const BACKGROUND = [18, 18, 18];
const NOTE = [29, 185, 84];
const PLUS = [255, 255, 255];
const SUPERSAMPLE = 4;

function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inRotatedEllipse(x, y, cx, cy, rx, ry, degrees) {
  const a = (degrees * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const v = -dx * Math.sin(a) + dy * Math.cos(a);
  return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
}

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Colour at a point on the 128-unit canvas, or null for transparent.
function sample(x, y) {
  if (!inRoundedSquare(x, y, 128, 28)) {
    return null;
  }
  const plus =
    (Math.abs(x - 98) <= 5 && Math.abs(y - 32) <= 16) ||
    (Math.abs(y - 32) <= 5 && Math.abs(x - 98) <= 16);
  if (plus) {
    return PLUS;
  }
  const head = inRotatedEllipse(x, y, 50, 90, 19, 14, -20);
  const stem = x >= 60 && x <= 69 && y >= 30 && y <= 90;
  const flag = inPolygon(x, y, [
    [60, 26],
    [69, 26],
    [88, 40],
    [88, 56],
    [69, 44],
  ]);
  return head || stem || flag ? NOTE : BACKGROUND;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 128 / size;
  const n = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const color = sample(
            (px + (sx + 0.5) / SUPERSAMPLE) * scale,
            (py + (sy + 0.5) / SUPERSAMPLE) * scale
          );
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      // Colours are averaged over covered samples (straight alpha).
      pixels[i] = a ? Math.round(r / a) : 0;
      pixels[i + 1] = a ? Math.round(g / a) : 0;
      pixels[i + 2] = a ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round((a / n) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = path.resolve("icons");
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`Wrote ${file}`);
}
