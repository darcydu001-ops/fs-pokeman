import { ROSTER } from "./roster";
import type { Creature, Move, Species, Stats, StatKey, YouthClass } from "./types";
import { STAT_KEYS, STAT_LABEL } from "./types";

export const NATURES: { id: string; name: string; up?: StatKey; down?: StatKey }[] = [
  { id: "hardy", name: "全面手" },
  { id: "lonely", name: "暴扣狂", up: "jump", down: "rebound" },
  { id: "brave", name: "造物主", up: "jump", down: "run" },
  { id: "adamant", name: "禁区终结", up: "jump", down: "three" },
  { id: "naughty", name: "强硬派", up: "jump", down: "block" },
  { id: "bold", name: "篮板狂人", up: "rebound", down: "jump" },
  { id: "timid", name: "快攻手", up: "run", down: "jump" },
  { id: "modest", name: "冷箭手", up: "three", down: "jump" },
  { id: "calm", name: "护框者", up: "block", down: "jump" },
];

export function natureEffectText(id: string): string {
  const n = NATURES.find((x) => x.id === id);
  if (!n?.up || !n.down) return "攻守均衡";
  return `${STAT_LABEL[n.up]}↑ ${STAT_LABEL[n.down]}↓`;
}

function st(
  rebound: number,
  jump: number,
  run: number,
  block: number,
  three: number,
  mid: number,
  stamina: number,
  pass: number,
): Stats {
  return { rebound, jump, run, block, three, mid, stamina, pass };
}

const TEMPLATES: Record<YouthClass, Stats> = {
  C: st(78, 55, 42, 76, 28, 48, 80, 32),
  F: st(55, 68, 62, 48, 52, 60, 62, 48),
  G: st(32, 58, 78, 28, 72, 64, 52, 70),
};

const AVG = st(55, 60, 61, 51, 51, 57, 65, 50);

export const MOVES: Record<string, Move> = {
  layup: { id: "layup", name: "上篮", type: "slash", category: "physical", power: 40, accuracy: 95 },
  dunk: { id: "dunk", name: "暴扣", type: "body", category: "physical", power: 70, accuracy: 80 },
  three: { id: "three", name: "冷箭三分", type: "shot", category: "special", power: 75, accuracy: 72 },
  mid: { id: "mid", name: "中投", type: "shot", category: "special", power: 50, accuracy: 88 },
  crossover: { id: "crossover", name: "变向突破", type: "slash", category: "physical", power: 55, accuracy: 90, effect: "buff-spe" },
  dish: { id: "dish", name: "妙传", type: "dish", category: "status", power: 0, accuracy: 100, effect: "buff-atk" },
  steal: { id: "steal", name: "抢断", type: "lock", category: "physical", power: 35, accuracy: 90, effect: "priority" },
  block: { id: "block", name: "大帽", type: "lock", category: "physical", power: 45, accuracy: 85 },
  board: { id: "board", name: "卡位篮板", type: "board", category: "physical", power: 40, accuracy: 92 },
  post: { id: "post", name: "背身单打", type: "body", category: "physical", power: 60, accuracy: 86 },
  fade: { id: "fade", name: "后仰跳投", type: "shot", category: "special", power: 65, accuracy: 80 },
  poster: { id: "poster", name: "隔人暴扣", type: "slash", category: "physical", power: 85, accuracy: 70 },
  catch: { id: "catch", name: "接球就投", type: "shot", category: "special", power: 58, accuracy: 84 },
  iso: { id: "iso", name: "单打", type: "slash", category: "physical", power: 62, accuracy: 82 },
  help: { id: "help", name: "补防", type: "lock", category: "status", power: 0, accuracy: 100, effect: "heal" },
  screen: { id: "screen", name: "挡拆", type: "dish", category: "status", power: 0, accuracy: 100, effect: "buff-spe" },
  putback: { id: "putback", name: "补篮", type: "board", category: "physical", power: 50, accuracy: 90 },
  lockup: { id: "lockup", name: "锁死", type: "lock", category: "status", power: 0, accuracy: 100, effect: "paralyze" },
};

export function moveById(id: string): Move {
  return MOVES[id] ?? MOVES.layup;
}

const LEARN: Record<YouthClass, { level: number; moveId: string }[]> = {
  C: [
    { level: 1, moveId: "board" },
    { level: 5, moveId: "putback" },
    { level: 10, moveId: "block" },
    { level: 16, moveId: "post" },
    { level: 24, moveId: "dunk" },
    { level: 32, moveId: "help" },
  ],
  F: [
    { level: 1, moveId: "layup" },
    { level: 5, moveId: "dunk" },
    { level: 10, moveId: "crossover" },
    { level: 16, moveId: "iso" },
    { level: 24, moveId: "mid" },
    { level: 32, moveId: "poster" },
  ],
  G: [
    { level: 1, moveId: "layup" },
    { level: 5, moveId: "dish" },
    { level: 10, moveId: "three" },
    { level: 16, moveId: "crossover" },
    { level: 24, moveId: "steal" },
    { level: 32, moveId: "screen" },
  ],
};

function hashName(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function baseStats(youth: YouthClass, name: string, dual: boolean): Stats {
  const t = { ...TEMPLATES[youth] };
  if (dual) {
    for (const k of STAT_KEYS) t[k] = Math.round(t[k] * 0.7 + AVG[k] * 0.3);
  }
  const h = hashName(name);
  STAT_KEYS.forEach((k, i) => {
    const n = ((h >>> (i * 3)) % 13) - 6;
    t[k] = Math.max(22, Math.min(96, t[k] + n));
  });
  return t;
}

export const SPECIES: Record<number, Species> = Object.fromEntries(
  ROSTER.map((r, i) => {
    const id = i + 1;
    const sp: Species = {
      id,
      name: r.name,
      youthClass: r.youth,
      dualRole: r.dual,
      rarity: r.rare ? "rare" : "normal",
      genderBias: r.gender,
      stats: baseStats(r.youth, r.name, r.dual),
      eggGroup: r.youth === "C" ? "big" : r.youth === "F" ? "wing" : "guard",
      learnset: LEARN[r.youth],
    };
    return [id, sp];
  }),
);

export function speciesById(id: number): Species {
  const sp = SPECIES[id];
  if (!sp) throw new Error(`未知球员 ${id}`);
  return sp;
}

export function allSpecies(): Species[] {
  return Object.values(SPECIES).sort((a, b) => a.id - b.id);
}

export function eggHint(speciesId: number): string {
  return `青训种子「${speciesById(speciesId).name}」`;
}

export function speciesIdsByClass(youth: YouthClass, rarity?: "normal" | "rare"): number[] {
  return allSpecies()
    .filter((s) => s.youthClass === youth && (!rarity || s.rarity === rarity))
    .map((s) => s.id);
}

export function randomBabySpeciesId(): number {
  const youth: YouthClass[] = ["C", "F", "G"];
  const pick = youth[Math.floor(Math.random() * youth.length)]!;
  const pool = speciesIdsByClass(pick);
  return pool[Math.floor(Math.random() * pool.length)] ?? 1;
}

export function babyOf(speciesId: number): number {
  return speciesId;
}

export function creatureLabel(c: Pick<Creature, "speciesId" | "code" | "nickname" | "stage">): string {
  if (c.nickname) return c.nickname;
  const name = SPECIES[c.speciesId]?.name ?? "球员";
  const shown = c.stage === 3 ? `超觉醒${name}` : name;
  return c.code ? `${shown} #${c.code}` : shown;
}

export interface CourtFoe {
  speciesId: number;
  level: number;
  name?: string;
}

export interface Court {
  id: string;
  cityId: string;
  name: string;
  kind: "named" | "wild";
  travelMin: number;
  level: number;
  team: CourtFoe[];
  money: number;
  exp: number;
  recruitPool: number[];
}

export interface City {
  id: string;
  name: string;
  unlockAfter?: string;
  blurb: string;
}

export const CITIES: City[] = [
  { id: "alley", name: "巷口城", blurb: "最近的街头，适合热身。" },
  { id: "river", name: "滨江市", unlockAfter: "alley-main", blurb: "码头风很大，球也更野。" },
  { id: "hill", name: "山城", unlockAfter: "river-main", blurb: "台阶球场，体能消耗大。" },
  { id: "port", name: "港湾", unlockAfter: "hill-main", blurb: "集装箱夹缝里的硬仗。" },
  { id: "capital", name: "帝都", unlockAfter: "port-main", blurb: "全国目光都在这儿。" },
  { id: "metro", name: "魔都", unlockAfter: "capital-main", blurb: "最远也最吵的夜场。" },
];

const cN = speciesIdsByClass("C", "normal");
const fN = speciesIdsByClass("F", "normal");
const gN = speciesIdsByClass("G", "normal");
const cR = speciesIdsByClass("C", "rare");
const fR = speciesIdsByClass("F", "rare");
const gR = speciesIdsByClass("G", "rare");
const dualIds = allSpecies().filter((s) => s.dualRole).map((s) => s.id);

function at(list: number[], i: number): number {
  return list[i % Math.max(1, list.length)] ?? 1;
}

function trio(a: number, b: number, c: number, level: number): CourtFoe[] {
  return [
    { speciesId: a, level: level - 1 },
    { speciesId: b, level: level - 1 },
    { speciesId: c, level },
  ];
}

function pool(...ids: number[]): number[] {
  return [...new Set(ids.filter((id) => SPECIES[id]))];
}

export const COURTS: Court[] = [
  {
    id: "alley-main", cityId: "alley", name: "巷口球场", kind: "named", travelMin: 8, level: 8,
    team: trio(at(gN, 0), at(fN, 0), at(cN, 0), 8), money: 150, exp: 56,
    recruitPool: pool(at(cN, 0), at(fN, 0), at(gN, 0), at(cN, 1), at(fN, 1)),
  },
  {
    id: "alley-wild", cityId: "alley", name: "巷口野场", kind: "wild", travelMin: 6, level: 6,
    team: trio(at(fN, 2), at(gN, 2), at(cN, 2), 6), money: 70, exp: 40,
    recruitPool: pool(at(cN, 1), at(fN, 1), at(gN, 1), at(fN, 2), at(gN, 3)),
  },
  {
    id: "river-main", cityId: "river", name: "码头球场", kind: "named", travelMin: 18, level: 11,
    team: trio(at(gN, 4), at(fN, 4), at(cN, 4), 11), money: 160, exp: 48,
    recruitPool: pool(at(cN, 3), at(fN, 3), at(gN, 4)),
  },
  {
    id: "river-wild", cityId: "river", name: "夜市野场", kind: "wild", travelMin: 14, level: 9,
    team: trio(at(fN, 5), at(cN, 5), at(gN, 5), 9), money: 90, exp: 32,
    recruitPool: pool(at(fN, 5), at(cN, 5), at(gN, 5), at(dualIds, 0)),
  },
  {
    id: "hill-main", cityId: "hill", name: "台阶球场", kind: "named", travelMin: 28, level: 16,
    team: trio(at(fN, 6), at(cN, 6), at(gN, 6), 16), money: 240, exp: 80,
    recruitPool: pool(at(fN, 6), at(cN, 6), at(gN, 6)),
  },
  {
    id: "hill-wild", cityId: "hill", name: "社区野场", kind: "wild", travelMin: 22, level: 14,
    team: trio(at(cN, 7), at(fN, 7), at(gN, 7), 14), money: 120, exp: 58,
    recruitPool: pool(at(cN, 7), at(fN, 7), at(gN, 7), at(fR, 0)),
  },
  {
    id: "port-main", cityId: "port", name: "集装箱球场", kind: "named", travelMin: 36, level: 26,
    team: trio(at(gR, 0), at(fN, 8), at(cN, 8), 26), money: 320, exp: 100,
    recruitPool: pool(at(gR, 0), at(fN, 8), at(cN, 8), at(dualIds, 1)),
  },
  {
    id: "port-wild", cityId: "port", name: "沙滩野场", kind: "wild", travelMin: 30, level: 24,
    team: trio(at(fR, 1), at(cN, 9), at(gN, 8), 24), money: 160, exp: 75,
    recruitPool: pool(at(gN, 8), at(fR, 1), at(cN, 9)),
  },
  {
    id: "capital-main", cityId: "capital", name: "工体街场", kind: "named", travelMin: 48, level: 32,
    team: trio(at(gN, 1), at(cN, 1), at(dualIds, 2), 32), money: 420, exp: 135,
    recruitPool: pool(at(gN, 1), at(cN, 1), at(dualIds, 2), at(cR, 0)),
  },
  {
    id: "capital-wild", cityId: "capital", name: "三里屯野场", kind: "wild", travelMin: 40, level: 30,
    team: trio(at(gR, 1), at(cN, 2), at(fN, 1), 30), money: 220, exp: 100,
    recruitPool: pool(at(gR, 1), at(cN, 2), at(fN, 1), at(dualIds, 3)),
  },
  {
    id: "metro-main", cityId: "metro", name: "外滩球场", kind: "named", travelMin: 60, level: 38,
    team: trio(at(gN, 2), at(fR, 2), at(cN, 3), 38), money: 580, exp: 165,
    recruitPool: pool(at(cN, 3), at(gN, 2), at(fR, 2)),
  },
  {
    id: "metro-wild", cityId: "metro", name: "高架野场", kind: "wild", travelMin: 50, level: 36,
    team: trio(at(fN, 3), at(gR, 2), at(dualIds, 4), 36), money: 300, exp: 125,
    recruitPool: pool(at(fN, 3), at(gR, 2), at(dualIds, 4), at(cR, 1)),
  },
];

export function courtById(id: string): Court | undefined {
  return COURTS.find((c) => c.id === id);
}

export function foeLabel(m: CourtFoe): string {
  return m.name || speciesById(m.speciesId).name;
}

export function teamNames(team: CourtFoe[]): string {
  return team.map(foeLabel).join(" / ");
}

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}

export const ITEMS: Record<string, { id: string; name: string; desc: string; kind: "ball" | "stone" | "berry" | "key" | "misc" | "heal" | "feed" }> = {
  "recruit-ticket": { id: "recruit-ticket", name: "招募券", desc: "去野球场时用来争取球员加盟。", kind: "ball" },
  feed: { id: "feed", name: "营养餐", desc: "加经验和一点忠诚度，偶尔升级。", kind: "feed" },
  "hp-pack": { id: "hp-pack", name: "理疗包", desc: "立刻回满一名球员的体力。", kind: "heal" },
  "oran-berry": { id: "oran-berry", name: "能量棒", desc: "回复一半体力，比赛间隙顶一下。", kind: "berry" },
  "lucky-seed": { id: "lucky-seed", name: "随机青训种子", desc: "从名单里抽一名随机青训种子，送入空闲青训营培养。", kind: "misc" },
};

export const SHOP: { id: string; price: number; name: string; desc: string }[] = [
  { id: "recruit-ticket", price: 100, name: "招募券", desc: "野球场签人用。" },
  { id: "feed", price: 50, name: "营养餐", desc: "给球员加餐，涨一级经验和忠诚度。" },
  { id: "oran-berry", price: 30, name: "能量棒", desc: "回复一半体力，便宜管够。" },
  { id: "hp-pack", price: 70, name: "理疗包", desc: "比赛后快速恢复体力。" },
  { id: "lucky-seed", price: 220, name: "随机青训种子", desc: "送一名随机新秀进空闲青训营。" },
];

export const LUCKY_EGG_POOL = allSpecies().map((s) => s.id);

export function sellPrice(itemId: string): number {
  const goods = SHOP.find((g) => g.id === itemId);
  if (goods) return Math.max(10, Math.floor(goods.price * 0.5));
  return 20;
}

export const CAREER_LABEL: Record<"national" | "pro" | "intl", string> = {
  national: "全国大赛",
  pro: "职业联赛",
  intl: "国际大赛",
};

export const CAREER_TEAM: Record<"national" | "pro" | "intl", CourtFoe[]> = {
  national: trio(at(gN, 5), at(cN, 5), at(fN, 5), 14),
  pro: trio(at(fN, 8), at(cN, 8), at(gR, 0), 29),
  intl: trio(at(gN, 2), at(cN, 3), at(fR, 2), 39),
};
