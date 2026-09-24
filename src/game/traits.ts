import { TRAIT_LIMIT, type Creature, type StatKey } from "./types";

export type TraitRarity = "rare" | "epic" | "grey";

export const TRAIT_GRADE: Record<TraitRarity, string> = {
  grey: "凡品",
  rare: "稀有",
  epic: "极品",
};

export interface TraitDef {
  id: string;
  name: string;
  rarity: TraitRarity;
  desc: string;
  groups: string[];
  stats?: Partial<Record<StatKey, number>>;
  exp?: number;
  friendship?: number;
}

export const TRAITS: Record<string, TraitDef> = {
  muscle: { id: "muscle", name: "暴扣手", rarity: "rare", desc: "弹跳 +8%", groups: ["jump"], stats: { jump: 0.08 } },
  gifted: { id: "gifted", name: "冷箭", rarity: "rare", desc: "3分 +8%", groups: ["three"], stats: { three: 0.08 } },
  tough: { id: "tough", name: "卡位", rarity: "rare", desc: "篮板 +8%", groups: ["rebound"], stats: { rebound: 0.08 } },
  focus: { id: "focus", name: "护框", rarity: "rare", desc: "盖帽 +8%", groups: ["block"], stats: { block: 0.08 } },
  hardy: { id: "hardy", name: "体能怪", rarity: "rare", desc: "体力 +8%", groups: ["stamina"], stats: { stamina: 0.08 } },
  nimble: { id: "nimble", name: "第一步", rarity: "rare", desc: "跑动 +8%", groups: ["run"], stats: { run: 0.08 } },
  passer: { id: "passer", name: "传球手", rarity: "rare", desc: "传球 +8%", groups: ["pass"], stats: { pass: 0.08 } },
  midShooter: { id: "midShooter", name: "中投手", rarity: "rare", desc: "中投 +8%", groups: ["mid"], stats: { mid: 0.08 } },
  learner: { id: "learner", name: "好学", rarity: "rare", desc: "获得经验 +15%", groups: ["exp"], exp: 0.15 },
  friendly: { id: "friendly", name: "更衣室领袖", rarity: "rare", desc: "忠诚度提升 +35%", groups: ["friend"], friendship: 0.35 },
  musclePlus: { id: "musclePlus", name: "造物主", rarity: "epic", desc: "弹跳 +16%", groups: ["jump"], stats: { jump: 0.16 } },
  giftedPlus: { id: "giftedPlus", name: "三分雨", rarity: "epic", desc: "3分 +16%", groups: ["three"], stats: { three: 0.16 } },
  iron: { id: "iron", name: "篮板王", rarity: "epic", desc: "篮板 +16%", groups: ["rebound"], stats: { rebound: 0.16 } },
  veil: { id: "veil", name: "禁区墙", rarity: "epic", desc: "盖帽 +16%", groups: ["block"], stats: { block: 0.16 } },
  vitality: { id: "vitality", name: "铁人", rarity: "epic", desc: "体力 +16%", groups: ["stamina"], stats: { stamina: 0.16 } },
  swift: { id: "swift", name: "闪电步", rarity: "epic", desc: "跑动 +16%", groups: ["run"], stats: { run: 0.16 } },
  floorGeneral: { id: "floorGeneral", name: "场上大脑", rarity: "epic", desc: "传球、跑动 +8%", groups: ["pass", "run"], stats: { pass: 0.08, run: 0.08 } },
  ferocious: { id: "ferocious", name: "全能核", rarity: "epic", desc: "弹跳、3分 +8%", groups: ["jump", "three"], stats: { jump: 0.08, three: 0.08 } },
  genius: { id: "genius", name: "篮球智商", rarity: "epic", desc: "获得经验 +30%", groups: ["exp"], exp: 0.3 },
  devoted: { id: "devoted", name: "死忠", rarity: "epic", desc: "忠诚度提升 +70%", groups: ["friend"], friendship: 0.7 },
  weakArm: { id: "weakArm", name: "弹跳差", rarity: "grey", desc: "弹跳 -8%", groups: ["jump"], stats: { jump: -0.08 } },
  dullMind: { id: "dullMind", name: "手感冰", rarity: "grey", desc: "3分 -8%", groups: ["three"], stats: { three: -0.08 } },
  brittle: { id: "brittle", name: "篮板弱", rarity: "grey", desc: "篮板 -8%", groups: ["rebound"], stats: { rebound: -0.08 } },
  thin: { id: "thin", name: "护框差", rarity: "grey", desc: "盖帽 -8%", groups: ["block"], stats: { block: -0.08 } },
  frail: { id: "frail", name: "体力差", rarity: "grey", desc: "体力 -8%", groups: ["stamina"], stats: { stamina: -0.08 } },
  slow: { id: "slow", name: "第一步慢", rarity: "grey", desc: "跑动 -8%", groups: ["run"], stats: { run: -0.08 } },
  lazy: { id: "lazy", name: "训练偷懒", rarity: "grey", desc: "获得经验 -15%", groups: ["exp"], exp: -0.15 },
  aloof: { id: "aloof", name: "不合群", rarity: "grey", desc: "忠诚度提升 -25%", groups: ["friend"], friendship: -0.25 },
};

function groupsOf(id: string): string[] {
  return TRAITS[id]?.groups ?? [];
}

function conflicts(id: string, taken: string[]): boolean {
  const g = new Set(groupsOf(id));
  if (!g.size) return false;
  return taken.some((t) => groupsOf(t).some((x) => g.has(x)));
}

export function rngFromSeed(seed: string): () => number {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sanitizeTraits(ids: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!TRAITS[id] || seen.has(id) || conflicts(id, out)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= TRAIT_LIMIT) break;
  }
  return out;
}

function rollTraitCount(rng: () => number): number {
  const r = rng();
  if (r < 0.52) return 1;
  if (r < 0.82) return 2;
  if (r < 0.96) return 3;
  return 4;
}

function pickRarity(rng: () => number): TraitRarity {
  const r = rng();
  if (r < 0.24) return "grey";
  if (r < 0.9) return "rare";
  return "epic";
}

function pickOneTrait(exclude: string[], rng: () => number): string | undefined {
  const rarity = pickRarity(rng);
  const open = Object.values(TRAITS).filter((t) => !exclude.includes(t.id) && !conflicts(t.id, exclude));
  const pool = open.filter((t) => t.rarity === rarity);
  const list = pool.length ? pool : open;
  if (!list.length) return;
  return list[Math.floor(rng() * list.length)].id;
}

function fillTraits(count: number, rng: () => number, fromPool?: string[]): string[] {
  const leftover = fromPool ? [...fromPool] : [];
  const picked: string[] = [];
  const want = Math.min(TRAIT_LIMIT, Math.max(1, count));
  for (let i = 0; i < want; i += 1) {
    const usePool = leftover.length > 0 && rng() < 0.72;
    if (usePool) {
      const options = leftover.filter((id) => TRAITS[id] && !picked.includes(id) && !conflicts(id, picked));
      if (options.length) {
        const id = options[Math.floor(rng() * options.length)]!;
        leftover.splice(leftover.indexOf(id), 1);
        picked.push(id);
        continue;
      }
    }
    const id = pickOneTrait(picked, rng);
    if (!id) break;
    const at = leftover.indexOf(id);
    if (at >= 0) leftover.splice(at, 1);
    picked.push(id);
  }
  if (!picked.length) {
    const id = pickOneTrait([], rng);
    if (id) picked.push(id);
  }
  return picked;
}

export function rollTraits(rng: () => number = Math.random): string[] {
  return fillTraits(rollTraitCount(rng), rng);
}

export function inheritTraits(a: string[] | undefined, b: string[] | undefined, rng: () => number = Math.random): string[] {
  const leftover = [...new Set([...sanitizeTraits(a), ...sanitizeTraits(b)])];
  return fillTraits(rollTraitCount(rng), rng, leftover);
}

function traitSum(c: { traits?: string[] }, key: "exp" | "friendship"): number {
  return sanitizeTraits(c.traits).reduce((sum, id) => sum + (TRAITS[id]?.[key] ?? 0), 0);
}

export function traitStatMul(c: { traits?: string[] }, key: StatKey): number {
  const n = sanitizeTraits(c.traits).reduce((sum, id) => sum + (TRAITS[id]?.stats?.[key] ?? 0), 0);
  return Math.max(0.5, 1 + n);
}

export function traitExpMul(c: { traits?: string[] }): number {
  return Math.max(0.2, 1 + traitSum(c, "exp"));
}

export function traitFriendMul(c: { traits?: string[] }): number {
  return Math.max(0, 1 + traitSum(c, "friendship"));
}

export function addExp(c: Creature, amount: number): void {
  c.exp += Math.max(0, Math.round(amount * traitExpMul(c)));
}

export function addFriendship(c: Creature, amount: number): void {
  c.friendship = Math.min(255, Math.max(0, c.friendship + Math.round(amount * traitFriendMul(c))));
}

export function hasEpicTrait(c: { traits?: string[] }): boolean {
  return sanitizeTraits(c.traits).some((id) => TRAITS[id]?.rarity === "epic");
}
