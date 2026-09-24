import { NATURES, speciesById } from "./data";
import { syncGrowth } from "./positions";
import { traitStatMul } from "./traits";
import { STAT_KEYS, type Creature, type StatKey, type Stats } from "./types";

export function natureMul(natureId: string, key: StatKey): number {
  if (key === "stamina") return 1;
  const n = NATURES.find((x) => x.id === natureId);
  if (!n) return 1;
  if (n.up === key) return 1.1;
  if (n.down === key) return 0.9;
  return 1;
}

function stageMul(stage: number | undefined): number {
  if (stage === 3) return 1.16;
  if (stage === 2) return 1.08;
  return 1;
}

export function computedStats(c: Creature): Stats {
  const sp = speciesById(c.speciesId);
  const mul = stageMul(c.stage);
  const calc = (key: StatKey) => {
    const trained = c.training?.[key] ?? 0;
    const iv = (c.ivs[key] ?? 0) + trained * 6;
    const base = sp.stats[key];
    if (key === "stamina") {
      const raw = Math.floor(((2 * base + iv) * c.level) / 100) + c.level + 10;
      return Math.max(1, Math.floor(raw * mul * traitStatMul(c, key)) + trained * 2);
    }
    const raw = Math.max(1, Math.floor((Math.floor(((2 * base + iv) * c.level) / 100) + 5) * natureMul(c.nature, key)));
    return Math.max(1, Math.floor(raw * mul * traitStatMul(c, key)) + trained * 2);
  };
  const out = {} as Stats;
  for (const key of STAT_KEYS) out[key] = calc(key);
  return out;
}

export function maxHpOf(c: Creature): number {
  return computedStats(c).stamina;
}

export function clampHp(c: Creature): void {
  const max = maxHpOf(c);
  if (typeof c.hp !== "number") c.hp = max;
  c.hp = Math.max(0, Math.min(c.hp, max));
}

export function energyOf(c: Creature): { hp: number; max: number; down: boolean; weak: boolean } {
  const max = maxHpOf(c);
  const hp = typeof c.hp === "number" ? c.hp : max;
  return { hp, max, down: hp <= 0, weak: hp > 0 && hp < max * 0.6 };
}

function midIvs(): Stats {
  const n = 18;
  return { rebound: n, jump: n, run: n, block: n, three: n, mid: n, stamina: n, pass: n };
}

export function makeAiCreature(speciesId: number, level: number, uid = "ai", name?: string): Creature {
  const sp = speciesById(speciesId);
  const learned = sp.learnset.filter((m) => m.level <= level).map((m) => m.moveId).slice(-4);
  const c: Creature = {
    uid,
    speciesId,
    level,
    exp: 0,
    ivs: midIvs(),
    nature: "hardy",
    friendship: 0,
    shiny: false,
    gender: "male",
    code: 0,
    moves: learned.length ? learned : ["layup"],
    obtainedAt: 0,
    hp: 1,
    traits: [],
    youthClass: sp.youthClass,
    position: sp.youthClass,
    stage: 1,
    nickname: name || undefined,
  };
  syncGrowth(c);
  c.hp = computedStats(c).stamina;
  return c;
}
