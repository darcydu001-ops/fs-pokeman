// 把 art-raw/*.png 的杂色/假透明棋盘背景刷成纯色奶油底，缩到 256x256，并做轻度提亮锐化。
// 用法: node scripts/flatten-sprites.mjs [--only 1,25,700] [--size 256]
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "art-raw");
const OUT = join(root, "public", "sprites");

const BG = [0xef, 0xe6, 0xce];
const OUT_SIZE = Number(argValue("--size") ?? 256);
const OUTLINE = Number(argValue("--outline") ?? 2);
const SHEET = process.argv.includes("--sheet");
const OUTLINE_COLOR = [0x4a, 0x40, 0x34];
const ONLY = (argValue("--only") ?? "").split(",").filter(Boolean);

// 默认阈值：中性(低饱和)且够亮 => 背景。奶油色身体饱和度约 0.16，不会被误判。
const DEFAULTS = {
  bgSat: 0.08,
  bgLum: 190,
  haloSat: 0.14,
  haloLum: 200,
  haloRounds: 3,
  pocketArea: 64,
  pocketSpread: 25,
  saturate: 1.18,
  contrast: 1.06,
  sharpen: 0.6,
  gamma: 0.97,
};

// 个别图可在这里单独调参（键为文件名）
const OVERRIDES = {};

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// 原图里混有 .png 后缀的 JPEG，按文件头嗅探，统一解成 RGBA
function readImage(path) {
  const raw = readFileSync(path);
  if (raw[0] === 0xff && raw[1] === 0xd8) {
    const img = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: img.data };
  }
  const end = raw.indexOf("IEND", 0, "ascii");
  return PNG.sync.read(end >= 0 ? raw.subarray(0, end + 8) : raw);
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function buildMask(px, w, h, cfg) {
  const n = w * h;
  const isBg = new Uint8Array(n);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    L[i] = lum(r, g, b);
    if (sat(r, g, b) <= cfg.bgSat && L[i] >= cfg.bgLum) isBg[i] = 1;
  }

  const mask = new Uint8Array(n);
  const stack = [];
  const push = (i) => {
    if (isBg[i] && !mask[i]) {
      mask[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  // 被尾巴/耳朵围住的封闭棋盘区域：块内亮度落差大(棋盘双色)且面积够 => 也算背景。
  // 身上的纯白高光是单色小块，不会命中。
  const seen = new Uint8Array(n);
  let pockets = 0;
  for (let s = 0; s < n; s++) {
    if (!isBg[s] || mask[s] || seen[s]) continue;
    const comp = [];
    seen[s] = 1;
    const q = [s];
    let mn = 255;
    let mx = 0;
    while (q.length) {
      const i = q.pop();
      comp.push(i);
      if (L[i] < mn) mn = L[i];
      if (L[i] > mx) mx = L[i];
      const x = i % w;
      const y = (i - x) / w;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (isBg[j] && !seen[j]) { seen[j] = 1; q.push(j); }
    }
    if (comp.length >= cfg.pocketArea && mx - mn >= cfg.pocketSpread) {
      pockets++;
      for (const i of comp) mask[i] = 1;
    }
  }

  // 边缘光晕（棋盘与主体混色的过渡像素）逐层吸收
  for (let round = 0; round < cfg.haloRounds; round++) {
    const add = [];
    for (let i = 0; i < n; i++) {
      if (mask[i]) continue;
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      if (sat(r, g, b) > cfg.haloSat || L[i] < cfg.haloLum) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (
        (x > 0 && mask[i - 1]) ||
        (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) ||
        (y < h - 1 && mask[i + w])
      ) add.push(i);
    }
    if (!add.length) break;
    for (const i of add) mask[i] = 1;
  }

  return { mask, pockets };
}

// 面积平均缩放，同时把遮罩缩成 0..1 的背景覆盖率
function downscale(px, mask, w, h, size) {
  const f = w / size;
  const out = new Float32Array(size * size * 3);
  const cov = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, m = 0, cnt = 0;
      for (let sy = Math.round(y * f); sy < Math.round((y + 1) * f); sy++) {
        for (let sx = Math.round(x * f); sx < Math.round((x + 1) * f); sx++) {
          const i = sy * w + sx;
          if (mask[i]) {
            r += BG[0]; g += BG[1]; b += BG[2]; m++;
          } else {
            r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2];
          }
          cnt++;
        }
      }
      const o = y * size + x;
      out[o * 3] = r / cnt;
      out[o * 3 + 1] = g / cnt;
      out[o * 3 + 2] = b / cnt;
      cov[o] = m / cnt;
    }
  }
  return { out, cov };
}

function enhance(buf, cov, size, cfg) {
  const n = size * size;
  const src = Float32Array.from(buf);
  // 模糊只取非背景邻居，避免在底色边界上炸出黑圈
  const blur = new Float32Array(n * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (cov[j] > 0.9) continue;
          r += src[j * 3]; g += src[j * 3 + 1]; b += src[j * 3 + 2];
          cnt++;
        }
      }
      if (!cnt) {
        blur[o * 3] = src[o * 3]; blur[o * 3 + 1] = src[o * 3 + 1]; blur[o * 3 + 2] = src[o * 3 + 2];
      } else {
        blur[o * 3] = r / cnt; blur[o * 3 + 1] = g / cnt; blur[o * 3 + 2] = b / cnt;
      }
    }
  }

  for (let o = 0; o < n; o++) {
    if (cov[o] > 0.9) continue;
    let c = [src[o * 3], src[o * 3 + 1], src[o * 3 + 2]];
    // 轻锐化
    c = c.map((v, k) => v + cfg.sharpen * (v - blur[o * 3 + k]));
    // 提饱和
    const grey = lum(c[0], c[1], c[2]);
    c = c.map((v) => grey + (v - grey) * cfg.saturate);
    // 微对比 + 微提亮
    c = c.map((v) => 128 + (v - 128) * cfg.contrast);
    c = c.map((v) => 255 * Math.pow(Math.min(1, Math.max(0, v / 255)), cfg.gamma));
    buf[o * 3] = clamp8(c[0]);
    buf[o * 3 + 1] = clamp8(c[1]);
    buf[o * 3 + 2] = clamp8(c[2]);
  }
}

// 在底色一侧描一圈深色轮廓，贴纸感更强，浅色宝可梦也不会和奶油底糊在一起
function outline(px, isBg, size, width, color) {
  let ring = new Uint8Array(isBg);
  for (let round = 0; round < width; round++) {
    const next = new Uint8Array(ring);
    for (let o = 0; o < size * size; o++) {
      if (!ring[o]) continue;
      const x = o % size;
      const y = (o - x) / size;
      const near =
        (x > 0 && !ring[o - 1]) ||
        (x < size - 1 && !ring[o + 1]) ||
        (y > 0 && !ring[o - size]) ||
        (y < size - 1 && !ring[o + size]);
      if (!near) continue;
      next[o] = 0;
      px[o * 4] = color[0];
      px[o * 4 + 1] = color[1];
      px[o * 4 + 2] = color[2];
    }
    ring = next;
  }
}

function finish(buf, cov, size) {
  const n = size * size;
  const px = Buffer.alloc(n * 4);
  const isBg = new Uint8Array(n);
  let bgCount = 0;
  let suspicious = 0;
  for (let o = 0; o < n; o++) {
    let r = Math.round(buf[o * 3]);
    let g = Math.round(buf[o * 3 + 1]);
    let b = Math.round(buf[o * 3 + 2]);
    const near = Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]) <= 18;
    const x = o % size;
    const y = (o - x) / size;
    const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    if (cov[o] > 0.9 || (near && cov[o] > 0.4) || (edge && cov[o] > 0)) {
      r = BG[0]; g = BG[1]; b = BG[2];
      isBg[o] = 1;
      bgCount++;
    } else if (sat(r, g, b) <= 0.1 && lum(r, g, b) >= 200 && !near) {
      suspicious++;
    }
    px[o * 4] = r; px[o * 4 + 1] = g; px[o * 4 + 2] = b; px[o * 4 + 3] = 255;
  }
  if (OUTLINE > 0) outline(px, isBg, size, OUTLINE, OUTLINE_COLOR);
  return { px, bgCount, suspicious };
}

if (!existsSync(SRC)) {
  console.error(`缺少原图目录 ${SRC}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".png"))
  .filter((f) => !ONLY.length || ONLY.includes(f.replace(".png", "")))
  .sort((a, b) => parseInt(a) - parseInt(b));

let bad = 0;
const sheetCols = 8;
const sheetCell = 128;
const sheetRows = Math.ceil(files.length / sheetCols);
const sheet = SHEET ? new PNG({ width: sheetCols * sheetCell, height: sheetRows * sheetCell }) : null;
if (sheet) sheet.data.fill(255);

for (const [index, file] of files.entries()) {
  const cfg = { ...DEFAULTS, ...(OVERRIDES[file] ?? {}) };
  const src = readImage(join(SRC, file));
  const { mask, pockets } = buildMask(src.data, src.width, src.height, cfg);
  const { out, cov } = downscale(src.data, mask, src.width, src.height, OUT_SIZE);
  enhance(out, cov, OUT_SIZE, cfg);
  const { px, bgCount, suspicious } = finish(out, cov, OUT_SIZE);

  const png = new PNG({ width: OUT_SIZE, height: OUT_SIZE, colorType: 2, inputHasAlpha: true });
  png.data = px;
  const buf = PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
  writeFileSync(join(OUT, file), buf);

  // 校验：边缘必须全等底色
  const check = PNG.sync.read(buf);
  let edgeBad = 0;
  for (let x = 0; x < OUT_SIZE; x++) {
    for (const o of [x, (OUT_SIZE - 1) * OUT_SIZE + x, x * OUT_SIZE, x * OUT_SIZE + OUT_SIZE - 1]) {
      if (check.data[o * 4] !== BG[0] || check.data[o * 4 + 1] !== BG[1] || check.data[o * 4 + 2] !== BG[2]) edgeBad++;
    }
  }
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

  const bgPct = ((bgCount / (OUT_SIZE * OUT_SIZE)) * 100).toFixed(1);
  const flag = edgeBad ? " <== 边缘不是纯底色" : "";
  if (flag) bad++;
  console.log(
    `${file.padEnd(8)} 背景 ${bgPct.padStart(5)}%  封闭块 ${String(pockets).padStart(2)}  边缘异常 ${String(edgeBad).padStart(4)}  中性亮像素 ${String(suspicious).padStart(4)}  ${(buf.length / 1024).toFixed(0)}KB${flag}`,
  );
}
if (sheet) {
  writeFileSync(join(root, "art-raw", "_sheet.png"), PNG.sync.write(sheet));
  console.log("对照图: art-raw/_sheet.png");
}
console.log(`共 ${files.length} 张，边缘异常 ${bad} 张。`);
