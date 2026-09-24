// 从 fsjoy 角色图鉴抓缩略图，按去前缀后的角色名对齐本游戏名册。
// 同一人优先无前缀基础立绘；没有再用觉醒/超觉醒图。
// 用法: node scripts/fetch-portraits.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "art-raw");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: "https://www.fsjoy.com/srole/game_gameRoleList_new_0_1.xhtml",
  Accept: "text/html,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

function rosterNames() {
  const src = readFileSync(join(root, "src/game/roster.ts"), "utf8");
  const names = [...src.matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]);
  if (names.length < 100) throw new Error(`名册解析异常：只读到 ${names.length} 人`);
  return names;
}

function stripPrefix(name) {
  return name.replace(/^(超觉醒|觉醒)/, "");
}

function artRank(name) {
  if (name.startsWith("超觉醒")) return 2;
  if (name.startsWith("觉醒")) return 1;
  return 0;
}

function parsePage(html) {
  const items = [];
  const re =
    /href="game_gameRoleById_new_(\d+)\.xhtml"[\s\S]*?src="(https:\/\/img\.t2cn\.com\/fsjoyapp\/image\/[^"]+)"[\s\S]*?<p[^>]*>([^<]+)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    items.push({ roleId: Number(m[1]), src: m[2], name: m[3].trim() });
  }
  return items;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

async function fetchBin(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function listAll() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://www.fsjoy.com/srole/game_gameRoleList_new_0_${page}.xhtml`;
    const html = await fetchText(url);
    const items = parsePage(html);
    console.log(`第 ${page} 页 ${items.length} 人`);
    if (!items.length) break;
    all.push(...items);
    if (!html.includes(`game_gameRoleList_new_0_${page + 1}.xhtml`)) break;
  }
  return all;
}

function pickBest(roster, listed) {
  /** @type {Map<string, { speciesId: number, name: string, src: string, fsjoyName: string, rank: number }>} */
  const chosen = new Map();
  for (const item of listed) {
    const key = stripPrefix(item.name);
    const idx = roster.indexOf(key);
    if (idx < 0) continue;
    const speciesId = idx + 1;
    const rank = artRank(item.name);
    const prev = chosen.get(key);
    if (!prev || rank < prev.rank) {
      chosen.set(key, {
        speciesId,
        name: key,
        src: item.src,
        fsjoyName: item.name,
        rank,
      });
    }
  }
  return [...chosen.values()].sort((a, b) => a.speciesId - b.speciesId);
}

async function downloadAll(picks) {
  mkdirSync(OUT, { recursive: true });
  let ok = 0;
  let fail = 0;
  const queue = [...picks];
  const workers = 4;
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const dest = join(OUT, `${item.speciesId}.png`);
      if (existsSync(dest)) {
        ok++;
        continue;
      }
      try {
        const buf = await fetchBin(item.src);
        writeFileSync(dest, buf);
        ok++;
        console.log(
          `↓ ${String(item.speciesId).padStart(3)} ${item.name}  ← ${item.fsjoyName}  ${(buf.length / 1024).toFixed(0)}KB`,
        );
      } catch (err) {
        fail++;
        console.error(`× ${item.speciesId} ${item.name}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return { ok, fail };
}

const roster = rosterNames();
const listed = await listAll();
const unmatchedListed = listed.filter((it) => !roster.includes(stripPrefix(it.name)));
const picks = pickBest(roster, listed);
const missing = roster
  .map((name, i) => ({ speciesId: i + 1, name }))
  .filter((r) => !picks.some((p) => p.speciesId === r.speciesId));

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "_manifest.json"),
  JSON.stringify(
    {
      roster: roster.length,
      listed: listed.length,
      matched: picks.length,
      missing: missing.map((m) => m.name),
      extraOnFsjoy: unmatchedListed.map((x) => x.name),
      picks,
    },
    null,
    2,
  ),
);

console.log(`名册 ${roster.length}  图鉴 ${listed.length}  对上 ${picks.length}  缺 ${missing.length}`);
if (missing.length) console.log("缺图:", missing.map((m) => m.name).join("、"));
if (unmatchedListed.length) {
  console.log(
    "官网有、名册没有:",
    [...new Set(unmatchedListed.map((x) => stripPrefix(x.name)))].join("、"),
  );
}

const { ok, fail } = await downloadAll(picks);
console.log(`下载完成 ${ok} 张，失败 ${fail} 张。原图在 art-raw/`);
if (fail) process.exit(1);
