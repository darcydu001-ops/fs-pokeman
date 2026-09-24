// 把 art-raw/{id}.png 铺到掌机奶油底 #EFE6CE，居中适配到 256x256。
// 用法: node scripts/flatten-portraits.mjs [--only 68,94,118]
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "art-raw");
const OUT = join(root, "public", "portraits");
const BG = [0xef, 0xe6, 0xce];
const OUT_SIZE = Number(argValue("--size") ?? 256);
const PAD = Number(argValue("--pad") ?? 6);
const ONLY = (argValue("--only") ?? "").split(",").filter(Boolean);
const SHEET = process.argv.includes("--sheet");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function readImage(path) {
  const raw = readFileSync(path);
  if (raw[0] === 0xff && raw[1] === 0xd8) {
    const img = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: img.data };
  }
  const end = raw.indexOf("IEND", 0, "ascii");
  return PNG.sync.read(end >= 0 ? raw.subarray(0, end + 8) : raw);
}

function sampleFringe(data, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] !== 0) continue;
    r += data[i * 4];
    g += data[i * 4 + 1];
    b += data[i * 4 + 2];
    n++;
  }
  if (!n) return [230, 230, 230];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function opaqueBounds(data, w, h, thresh = 18) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= thresh) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  const x = Math.max(0, minX - PAD);
  const y = Math.max(0, minY - PAD);
  return {
    x,
    y,
    w: Math.min(w, maxX + 1 + PAD) - x,
    h: Math.min(h, maxY + 1 + PAD) - y,
  };
}

function sample(src, x, y, fringe) {
  const w = src.width;
  const h = src.height;
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return [...BG, 0];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const mix = (a, b, t) => a + (b - a) * t;
  const pix = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return [...fringe, 0];
    const i = (iy * w + ix) * 4;
    const a = src.data[i + 3] / 255;
    if (a <= 0) return [...fringe, 0];
    let r = src.data[i];
    let g = src.data[i + 1];
    let b = src.data[i + 2];
    if (a < 1) {
      r = (r - fringe[0] * (1 - a)) / a;
      g = (g - fringe[1] * (1 - a)) / a;
      b = (b - fringe[2] * (1 - a)) / a;
    }
    return [r, g, b, a * 255];
  };
  const p00 = pix(x0, y0);
  const p10 = pix(x1, y0);
  const p01 = pix(x0, y1);
  const p11 = pix(x1, y1);
  return [
    mix(mix(p00[0], p10[0], fx), mix(p01[0], p11[0], fx), fy),
    mix(mix(p00[1], p10[1], fx), mix(p01[1], p11[1], fx), fy),
    mix(mix(p00[2], p10[2], fx), mix(p01[2], p11[2], fx), fy),
    mix(mix(p00[3], p10[3], fx), mix(p01[3], p11[3], fx), fy),
  ];
}

function flattenOne(src) {
  const fringe = sampleFringe(src.data, src.width, src.height);
  const box = opaqueBounds(src.data, src.width, src.height);
  const scale = Math.min(OUT_SIZE / box.w, OUT_SIZE / box.h);
  const dw = box.w * scale;
  const dh = box.h * scale;
  const ox = (OUT_SIZE - dw) / 2;
  const oy = (OUT_SIZE - dh) / 2;
  const px = Buffer.alloc(OUT_SIZE * OUT_SIZE * 4);
  for (let y = 0; y < OUT_SIZE; y++) {
    for (let x = 0; x < OUT_SIZE; x++) {
      const sx = box.x + (x - ox) / scale;
      const sy = box.y + (y - oy) / scale;
      const [r, g, b, a] = sample(src, sx, sy, fringe);
      const af = Math.max(0, Math.min(1, a / 255));
      const o = (y * OUT_SIZE + x) * 4;
      px[o] = clamp8(r * af + BG[0] * (1 - af));
      px[o + 1] = clamp8(g * af + BG[1] * (1 - af));
      px[o + 2] = clamp8(b * af + BG[2] * (1 - af));
      px[o + 3] = 255;
    }
  }
  return px;
}

if (!existsSync(SRC)) {
  console.error(`缺少原图目录 ${SRC}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC)
  .filter((f) => /^\d+\.png$/i.test(f))
  .filter((f) => !ONLY.length || ONLY.includes(f.replace(".png", "")))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

const sheetCols = 10;
const sheetCell = 96;
const sheetRows = Math.ceil(files.length / sheetCols);
const sheet = SHEET
  ? new PNG({ width: sheetCols * sheetCell, height: Math.max(sheetCell, sheetRows * sheetCell) })
  : null;
if (sheet) sheet.data.fill(255);

for (const [index, file] of files.entries()) {
  const src = readImage(join(SRC, file));
  const px = flattenOne(src);
  const png = new PNG({ width: OUT_SIZE, height: OUT_SIZE, colorType: 2, inputHasAlpha: true });
  png.data = px;
  const buf = PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
  writeFileSync(join(OUT, file), buf);

  if (sheet) {
    const cx = (index % sheetCols) * sheetCell;
    const cy = Math.floor(index / sheetCols) * sheetCell;
    const step = OUT_SIZE / sheetCell;
    for (let y = 0; y < sheetCell; y++) {
      for (let x = 0; x < sheetCell; x++) {
        const s = (Math.floor(y * step) * OUT_SIZE + Math.floor(x * step)) * 4;
        const d = ((cy + y) * sheet.width + cx + x) * 4;
        sheet.data[d] = px[s];
        sheet.data[d + 1] = px[s + 1];
        sheet.data[d + 2] = px[s + 2];
        sheet.data[d + 3] = 255;
      }
    }
  }

  console.log(`${file.padEnd(8)} ${src.width}x${src.height} -> ${OUT_SIZE}  ${(buf.length / 1024).toFixed(0)}KB`);
}

if (sheet) {
  writeFileSync(join(SRC, "_sheet.png"), PNG.sync.write(sheet));
  console.log("对照图: art-raw/_sheet.png");
}
console.log(`共 ${files.length} 张，输出 ${OUT}`);
