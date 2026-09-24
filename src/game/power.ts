import { computedStats, energyOf, makeAiCreature } from "./combat";
import { MOVES } from "./data";
import { positionSkills } from "./positions";
import { STAT_KEYS, type Creature } from "./types";

export interface PowerBreakdown {
  total: number;
  stats: number;
  moves: number;
  bond: number;
}

function moveScore(c: Creature): number {
  const skills = positionSkills(c.position ?? c.youthClass ?? "F");
  return c.moves.reduce((sum, id) => {
    const mv = MOVES[id];
    if (!mv) return sum;
    const stab = skills.includes(mv.type) ? 1.25 : 1;
    return sum + mv.power * (mv.accuracy / 100) * stab;
  }, 0);
}

export function powerBreakdown(c: Creature): PowerBreakdown {
  const s = computedStats(c);
  const stats = STAT_KEYS.reduce((sum, k) => sum + s[k], 0);
  const moves = moveScore(c);
  const bond = 1 + (c.friendship / 255) * 0.06;
  return {
    stats: Math.round(stats * 2.4),
    moves: Math.round(moves * 1.4),
    bond: Math.round((bond - 1) * 1000) / 10,
    total: Math.max(1, Math.round((stats * 2.4 + moves * 1.4) * bond)),
  };
}

export function creaturePower(c: Creature): number {
  return powerBreakdown(c).total;
}

export function energyMul(c: Creature): number {
  const e = energyOf(c);
  if (e.down || e.max <= 0) return 0;
  return Math.max(0.7, e.hp / e.max);
}

export function effectivePower(c: Creature): number {
  return Math.round(creaturePower(c) * energyMul(c));
}

export function teamPower(creatures: Creature[]): number {
  return creatures.reduce((sum, c) => sum + creaturePower(c), 0);
}

export function teamEffectivePower(creatures: Creature[]): number {
  return creatures.reduce((sum, c) => sum + effectivePower(c), 0);
}

export function partyAvgOvr(creatures: Creature[]): number {
  if (!creatures.length) return 0;
  return Math.round(creatures.reduce((sum, c) => sum + creaturePower(c), 0) / creatures.length);
}

export function formatPower(n: number): string {
  return n.toLocaleString("zh-CN");
}

export function rosterPower(team: { speciesId: number; level: number }[]): number {
  return teamPower(team.map((m, i) => makeAiCreature(m.speciesId, m.level, `ai${i}`)));
}
