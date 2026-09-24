import { creatureLabel, MOVES } from "./data";
import { computedStats, maxHpOf } from "./combat";
import { positionSkills } from "./positions";
import type { Creature, Position, SkillType } from "./types";

export interface SimResult {
  won: boolean;
  log: string[];
  remainingHp: Record<string, number>;
  home: number;
  away: number;
}

interface Unit {
  c: Creature;
  pos: Position;
  energy: number;
  max: number;
  rebound: number;
  jump: number;
  run: number;
  block: number;
  three: number;
  mid: number;
  pass: number;
}

function unit(c: Creature): Unit {
  const s = computedStats(c);
  const energy = Math.max(0, typeof c.hp === "number" ? c.hp : s.stamina);
  return {
    c,
    pos: c.position ?? c.youthClass ?? "F",
    energy,
    max: s.stamina,
    rebound: s.rebound,
    jump: s.jump,
    run: s.run,
    block: s.block,
    three: s.three,
    mid: s.mid,
    pass: s.pass,
  };
}

function pick(team: Unit[], preferPass = false): Unit | undefined {
  if (!team.length) return undefined;
  const live = team.filter((u) => u.energy > 0);
  const pool = live.length ? live : team;
  const weights = pool.map((u) => {
    const s = (u.run + (preferPass ? u.pass * 0.35 : 0)) * (0.5 + u.energy / Math.max(1, u.max));
    return Math.max(1, s) ** 1.6;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function shotKind(u: Unit): { name: string; pts: number; off: number; inner: boolean; skill: SkillType } {
  const r = Math.random();
  const perimeter = u.pos === "G" || u.pos === "SG" || u.pos === "PG" || u.pos === "SW" || u.pos === "SF";
  const big = u.pos === "C" || u.pos === "PF";
  if (perimeter && r < 0.22 + u.three / 500) return { name: "三分", pts: 3, off: u.three, inner: false, skill: "shot" };
  if (big && r < 0.42) return { name: "暴扣", pts: 2, off: u.jump, inner: true, skill: "body" };
  if (r < 0.32) return { name: "上篮", pts: 2, off: (u.jump + u.run) / 2, inner: true, skill: "slash" };
  if (r < 0.68) return { name: "中投", pts: 2, off: u.mid, inner: false, skill: "shot" };
  return { name: "抛投", pts: 2, off: (u.mid + u.jump) / 2, inner: true, skill: "slash" };
}

function tired(u: Unit): number {
  return Math.max(0.45, u.energy / Math.max(1, u.max));
}

function moveShotBonus(u: Unit, skill: SkillType): number {
  const stabSkills = positionSkills(u.pos);
  let best = 0;
  for (const id of u.c.moves ?? []) {
    const mv = MOVES[id];
    if (!mv || mv.type !== skill || mv.power <= 0) continue;
    const stab = stabSkills.includes(mv.type) ? 1.1 : 1;
    best = Math.max(best, (mv.power / 100) * (mv.accuracy / 100) * stab);
  }
  return 1 + Math.min(0.08, best * 0.12);
}

const SHOT_DRAIN = 0.025;
const DEF_DRAIN = 0.015;
const BOARD_DRAIN = 0.5;

function drain(u: Unit, amount: number): void {
  u.energy = Math.max(0, u.energy - amount);
}

function leftoverHp(units: Unit[]): Record<string, number> {
  const remainingHp: Record<string, number> = {};
  for (const u of units) remainingHp[u.c.uid] = Math.max(0, Math.min(maxHpOf(u.c), Math.round(u.energy)));
  return remainingHp;
}

export function simulateMatch(homeTeam: Creature[], awayTeam: Creature[], label = "比赛"): SimResult {
  if (!homeTeam.length || !awayTeam.length) {
    const remainingHp: Record<string, number> = {};
    for (const c of [...homeTeam, ...awayTeam]) {
      remainingHp[c.uid] = Math.max(0, typeof c.hp === "number" ? c.hp : maxHpOf(c));
    }
    const won = homeTeam.length > 0 && awayTeam.length === 0;
    return {
      won,
      log: [`${label}开始。`, "比赛无法进行。"],
      remainingHp,
      home: won ? 1 : 0,
      away: won ? 0 : 1,
    };
  }
  const home = homeTeam.map(unit);
  const away = awayTeam.map(unit);
  const log: string[] = [`${label}开始。`];
  let hs = 0;
  let as = 0;
  const possessions = 28;
  for (let i = 1; i <= possessions; i += 1) {
    const offenseIsHome = i % 2 === 1;
    const off = offenseIsHome ? home : away;
    const def = offenseIsHome ? away : home;
    const handler = pick(off, true);
    const defender = pick(def);
    if (!handler || !defender) continue;
    const others = off.filter((u) => u.c.uid !== handler.c.uid);
    const assisted = handler.pass > 22 && Math.random() < 0.28 + handler.pass / 400;
    const shooter = assisted ? pick(others.length ? others : off) ?? handler : handler;
    const kind = shotKind(shooter);
    const defStat = kind.inner ? defender.block * 0.65 + defender.jump * 0.35 : defender.run;
    const raw =
      ((kind.off * tired(shooter)) / (kind.off * tired(shooter) + defStat * tired(defender) * 0.9)) * (kind.pts === 3 ? 0.82 : 1);
    const chance = Math.min(0.9, Math.max(0.14, raw) * moveShotBonus(shooter, kind.skill));
    drain(shooter, shooter.max * SHOT_DRAIN);
    drain(defender, defender.max * DEF_DRAIN);
    const made = Math.random() < chance;
    const assistBit = assisted && shooter.c.uid !== handler.c.uid ? `${creatureLabel(handler.c)} 助攻，` : "";
    if (made) {
      if (offenseIsHome) hs += kind.pts;
      else as += kind.pts;
      log.push(`第${i}球 ${assistBit}${creatureLabel(shooter.c)} ${kind.name}命中  ${hs}-${as}`);
    } else {
      const offBoard = pick(off);
      const defBoard = pick(def);
      if (!offBoard || !defBoard) continue;
      const defChance = 0.45 + (defBoard.rebound - offBoard.rebound) / 400;
      const rebounder = Math.random() < defChance ? defBoard : offBoard;
      drain(rebounder, BOARD_DRAIN);
      log.push(`第${i}球 ${assistBit}${creatureLabel(shooter.c)} ${kind.name}不中，${creatureLabel(rebounder.c)} 抢下篮板  ${hs}-${as}`);
    }
  }
  if (hs === as) {
    const homeOt = Math.random() < 0.5;
    const extra = pick(homeOt ? home : away);
    if (homeOt) hs += 2;
    else as += 2;
    const name = extra ? creatureLabel(extra.c) : homeOt ? "我方" : "对方";
    log.push(`加时 ${name} 上篮得手  ${hs}-${as}`);
  }
  const won = hs > as;
  log.push(`终场 ${hs}-${as}，${won ? "我方获胜" : "我方失利"}。`);
  return { won, log, remainingHp: leftoverHp([...home, ...away]), home: hs, away: as };
}
