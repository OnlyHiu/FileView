// 程序化生成应用图标：256x256 RGBA PNG -> ICO（PNG 压缩条目，Vista+ 合法）
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const SIZE = 256;

// ---- CRC32 ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// ---- PNG 编码 ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 绘制 ----
const rgba = Buffer.alloc(SIZE * SIZE * 4);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

// 圆角矩形渐变背景
const RADIUS = 52;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 圆角 alpha
    const cx = Math.max(RADIUS - x, x - (SIZE - 1 - RADIUS), 0);
    const cy = Math.max(RADIUS - y, y - (SIZE - 1 - RADIUS), 0);
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist > RADIUS) continue;
    const a = dist <= RADIUS - 1.5 ? 255 : Math.round(255 * (RADIUS - dist) / 1.5);
    // 对角渐变 #0067C0 -> #4CC2FF
    const t = (x + y) / (2 * SIZE);
    const r = Math.round(0x00 + (0x4c - 0x00) * t);
    const g = Math.round(0x67 + (0xc2 - 0x67) * t);
    const b = Math.round(0xc0 + (0xff - 0xc0) * t);
    put(x, y, r, g, b, a);
  }
}

// 白色 "{ }" 造型（像素矩形近似）
function rect(x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, 255, 255, 255);
}
// '{'
rect(66, 62, 102, 78);   // 上横
rect(66, 178, 102, 194); // 下横
rect(66, 62, 82, 124);   // 上竖
rect(66, 132, 82, 194);  // 下竖
// '}'
rect(154, 62, 190, 78);
rect(154, 178, 190, 194);
rect(174, 62, 190, 124);
rect(174, 132, 190, 194);
// 中心冒号
rect(120, 100, 136, 116);
rect(120, 140, 136, 156);

const png = encodePng(SIZE, SIZE, rgba);

// ---- ICO 封装 ----
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
header[6] = 0; // width 256 -> 0
header[7] = 0; // height 256 -> 0
header[8] = 0; // colors
header[9] = 0; // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png.length, 14); // size
header.writeUInt32LE(22, 18); // offset

const ico = Buffer.concat([header, png]);

const outDir = path.resolve("src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
fs.writeFileSync(path.join(outDir, "icon.png"), png);
console.log("icon.ico written:", ico.length, "bytes; icon.png:", png.length, "bytes");
