import { clampHp, computedStats, energyOf, makeAiCreature } from "./combat";
import { creatureLabel, NATURES, speciesIdsByClass } from "./data";
import { creaturePower } from "./power";
import { syncGrowth } from "./positions";
import { occupiedCount } from "./courts";
import { rngFromSeed } from "./traits";
import {
  PK_DAILY_CAP,
  PK_STAKE,
  PK_WIN_GOLD,
  STAT_KEYS,
  emptyStats,
  trainCap,
  type Creature,
  type Position,
  type SaveData,
  type Stats,
  type YouthClass,
} from "./types";
import { todayKey } from "./daily";

export interface PkMember {
  speciesId: number;
  level: number;
  nickname?: string;
  position: Position;
  youthClass: YouthClass;
  stage: 1 | 2 | 3;
  moves: string[];
  traits: string[];
  nature: string;
  ivs: Stats;
  training?: Stats;
  friendship: number;
  shiny: boolean;
  gender: "male" | "female";
}

export interface PkLineup {
  id: string;
  playerId: string;
  trainerName: string;
  team: PkMember[];
  power: number;
  wins: number;
  losses: number;
  pendingGold: number;
  updatedAt: number;
}

const LOCAL_KEY = "fs-bokemon-pk-pool";
const NPC_PREFIX = "npc-";
const PK_CAPTAINS = ["辉少", "菊座", "戈登", "松本", "王鸽", "会长", "周明", "李之骏", "虾老板", "萌太", "芳芳"] as const;
const NPC_POSITIONS: YouthClass[] = ["C", "F", "G"];
export const PK_BOSS_NAME = "玉皇大帝";
export const PK_BOSS_ID = `${NPC_PREFIX}${PK_BOSS_NAME}`;
const PK_BOSS_POWER = 9999;

export function isNpcPlayer(playerId: string): boolean {
  return playerId.startsWith(NPC_PREFIX);
}

function pickFrom<T>(rng: () => number, list: T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

function captainTier(index: number): number {
  return index / Math.max(1, PK_CAPTAINS.length - 1);
}

function npcLevel(rng: () => number, captainIndex: number, slot: number): number {
  const base = Math.round(40 - captainTier(captainIndex) * 34);
  return Math.max(5, Math.min(42, base + slot - 1 + Math.floor(rng() * 3) - 1));
}

function npcIvs(rng: () => number, captainIndex: number): Stats {
  const mid = Math.round(31 - captainTier(captainIndex) * 26);
  const ivs = emptyStats();
  for (const key of STAT_KEYS) {
    ivs[key] = Math.max(0, Math.min(31, mid + Math.floor(rng() * 5) - 2));
  }
  return ivs;
}

function npcSpeciesPool(pos: YouthClass, index: number, rng: () => number): number[] {
  if (index <= 2) {
    const rare = speciesIdsByClass(pos, "rare");
    if (rare.length) return rare;
  }
  if (index >= 8) return speciesIdsByClass(pos, "normal");
  if (index <= 5 && rng() < 0.55) {
    const rare = speciesIdsByClass(pos, "rare");
    if (rare.length) return rare;
  }
  return speciesIdsByClass(pos);
}

function buildNpcLineup(name: string, index: number): PkLineup {
  const rng = rngFromSeed(`pk-captain:${name}`);
  const used = new Set<number>();
  const team: PkMember[] = [];
  const creatures: Creature[] = [];
  const t = captainTier(index);
  NPC_POSITIONS.forEach((pos, slot) => {
    const source = npcSpeciesPool(pos, index, rng);
    const pool = source.filter((id) => !used.has(id));
    const speciesId = pickFrom(rng, pool.length ? pool : speciesIdsByClass(pos));
    used.add(speciesId);
    const c = makeAiCreature(speciesId, npcLevel(rng, index, slot), `${NPC_PREFIX}${name}-${pos}`);
    c.ivs = npcIvs(rng, index);
    c.nature = pickFrom(rng, NATURES).id;
    c.gender = rng() < 0.5 ? "female" : "male";
    c.friendship = Math.round(220 * (1 - t));
    if (index <= 2) {
      const training = emptyStats();
      const bonus = 12 - index * 3;
      for (const key of STAT_KEYS) training[key] = bonus + Math.floor(rng() * 4);
      c.training = training;
    }
    syncGrowth(c);
    c.hp = computedStats(c).stamina;
    creatures.push(c);
    team.push(snapshotMember(c));
  });
  return {
    id: `${NPC_PREFIX}${name}`,
    playerId: `${NPC_PREFIX}${name}`,
    trainerName: name,
    team,
    power: creatures.reduce((sum, c) => sum + creaturePower(c), 0),
    wins: 0,
    losses: 0,
    pendingGold: 0,
    updatedAt: 1,
  };
}

function maxIvs(): Stats {
  const ivs = emptyStats();
  for (const key of STAT_KEYS) ivs[key] = 31;
  return ivs;
}

function buildJadeEmperor(): PkLineup {
  const team: PkMember[] = [];
  const trained = emptyStats();
  const cap = trainCap(99);
  for (const key of STAT_KEYS) trained[key] = cap;
  NPC_POSITIONS.forEach((pos) => {
    const rares = speciesIdsByClass(pos, "rare");
    const speciesId = rares[0] ?? speciesIdsByClass(pos)[0]!;
    const c = makeAiCreature(speciesId, 99, `${PK_BOSS_ID}-${pos}`);
    c.ivs = maxIvs();
    c.training = { ...trained };
    c.friendship = 255;
    c.shiny = true;
    syncGrowth(c);
    c.hp = computedStats(c).stamina;
    team.push(snapshotMember(c));
  });
  return {
    id: PK_BOSS_ID,
    playerId: PK_BOSS_ID,
    trainerName: PK_BOSS_NAME,
    team,
    power: PK_BOSS_POWER,
    wins: 0,
    losses: 0,
    pendingGold: 0,
    updatedAt: 1,
  };
}

let npcCache: PkLineup[] | null = null;

export function npcPkLineups(): PkLineup[] {
  if (!npcCache) npcCache = [buildJadeEmperor(), ...PK_CAPTAINS.map((name, i) => buildNpcLineup(name, i))];
  return npcCache;
}

export function sortPkOpponents(list: PkLineup[], beatenIds: string[]): PkLineup[] {
  const beaten = new Set(beatenIds);
  const open = list
    .filter((row) => !beaten.has(row.playerId))
    .sort((a, b) => a.power - b.power || a.trainerName.localeCompare(b.trainerName, "zh"));
  const done = beatenIds
    .map((id) => list.find((row) => row.playerId === id))
    .filter((row): row is PkLineup => !!row);
  const leftover = list.filter((row) => beaten.has(row.playerId) && !beatenIds.includes(row.playerId));
  return [...open, ...done, ...leftover];
}

export function markPkBeaten(save: SaveData, foeId: string): void {
  const list = save.pkBeaten ?? [];
  if (list.includes(foeId)) return;
  save.pkBeaten = [...list, foeId];
}

function mergePkPool(live: PkLineup[]): PkLineup[] {
  const npcs = npcPkLineups();
  const npcIds = new Set(npcs.map((n) => n.playerId));
  const players = live
    .filter((x) => !npcIds.has(x.playerId) && !isNpcPlayer(x.playerId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return [...npcs, ...players];
}

function apiBase(): string {
  return (import.meta.env.VITE_PK_API ?? "").replace(/\/$/, "");
}

function readLocal(): PkLineup[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PkLineup[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(list: PkLineup[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list.filter((x) => !isNpcPlayer(x.playerId))));
}

function snapshotMember(c: Creature): PkMember {
  return {
    speciesId: c.speciesId,
    level: c.level,
    nickname: c.nickname,
    position: c.position,
    youthClass: c.youthClass,
    stage: c.stage ?? 1,
    moves: [...c.moves],
    traits: [...(c.traits ?? [])],
    nature: c.nature,
    ivs: { ...c.ivs },
    training: c.training ? { ...c.training } : undefined,
    friendship: c.friendship,
    shiny: c.shiny,
    gender: c.gender,
  };
}

export function creatureFromPk(m: PkMember, uid: string): Creature {
  const c: Creature = {
    uid,
    speciesId: m.speciesId,
    level: m.level,
    exp: 0,
    ivs: { ...m.ivs },
    nature: m.nature,
    friendship: m.friendship,
    shiny: m.shiny,
    gender: m.gender,
    code: 0,
    nickname: m.nickname,
    moves: [...m.moves],
    obtainedAt: 0,
    hp: 1,
    traits: [...(m.traits ?? [])],
    youthClass: m.youthClass,
    position: m.position,
    stage: m.stage ?? 1,
    training: m.training ? { ...m.training } : undefined,
  };
  syncGrowth(c);
  c.hp = computedStats(c).stamina;
  return c;
}

export function snapshotParty(team: Creature[]): PkMember[] {
  return team.map(snapshotMember);
}

export function pkUnlocked(save: SaveData): boolean {
  return occupiedCount(save) >= 1;
}

export function ensurePkDaily(save: SaveData, now = Date.now()): void {
  const key = todayKey(now);
  if (save.pkChallengesDate !== key) {
    save.pkChallengesDate = key;
    save.pkChallengesCount = 0;
  }
}

export function pkRemaining(save: SaveData, now = Date.now()): number {
  ensurePkDaily(save, now);
  return Math.max(0, PK_DAILY_CAP - (save.pkChallengesCount ?? 0));
}

export function pkStake(): number {
  return PK_STAKE;
}

export function pkWinGold(): number {
  return PK_WIN_GOLD;
}

export async function listLineups(): Promise<PkLineup[]> {
  let live: PkLineup[] = [];
  const base = apiBase();
  if (base) {
    try {
      const res = await fetch(`${base}/lineups`);
      if (res.ok) live = (await res.json()) as PkLineup[];
      else live = readLocal();
    } catch {
      live = readLocal();
    }
  } else {
    live = readLocal();
  }
  return mergePkPool(live);
}

export async function uploadLineup(save: SaveData, team: Creature[]): Promise<PkLineup> {
  if (!pkUnlocked(save)) throw new Error("先占领一座有名球场再来 PK。");
  if (isNpcPlayer(save.playerId)) throw new Error("队长阵容不能覆盖上传。");
  if (team.length !== 3) throw new Error("上传需要 3 名首发。");
  const down = team.filter((c) => energyOf(c).down);
  if (down.length) throw new Error(`${down.map((c) => creatureLabel(c)).join("、")} 体力见底，先恢复再上传。`);
  for (const c of team) clampHp(c);
  const lineup: PkLineup = {
    id: save.playerId,
    playerId: save.playerId,
    trainerName: save.trainerName,
    team: snapshotParty(team),
    power: team.reduce((sum, c) => sum + creaturePower(c), 0),
    wins: 0,
    losses: 0,
    pendingGold: 0,
    updatedAt: Date.now(),
  };
  const base = apiBase();
  if (base) {
    const res = await fetch(`${base}/lineups`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lineup),
    });
    if (!res.ok) throw new Error("上传失败。");
    return (await res.json()) as PkLineup;
  }
  const list = readLocal();
  const prev = list.find((x) => x.playerId === save.playerId);
  if (prev) {
    lineup.wins = prev.wins;
    lineup.losses = prev.losses;
    lineup.pendingGold = prev.pendingGold;
  }
  writeLocal([lineup, ...list.filter((x) => x.playerId !== save.playerId)]);
  return lineup;
}

function applyPlayerRecord(list: PkLineup[], playerId: string, won: boolean): void {
  const mine = list.find((x) => x.playerId === playerId);
  if (!mine || isNpcPlayer(playerId)) return;
  if (won) mine.wins += 1;
  else mine.losses += 1;
}

async function reportCloudSelf(playerId: string, won: boolean): Promise<void> {
  const base = apiBase();
  if (!base || isNpcPlayer(playerId)) return;
  try {
    await fetch(`${base}/lineups/${encodeURIComponent(playerId)}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, won, selfOnly: true }),
    });
  } catch {
    /* captains still settle locally */
  }
}

export async function reportPkResult(playerId: string, foeId: string, won: boolean): Promise<PkLineup | null> {
  if (isNpcPlayer(foeId)) {
    await reportCloudSelf(playerId, won);
    const list = readLocal();
    applyPlayerRecord(list, playerId, won);
    writeLocal(list);
    return npcPkLineups().find((x) => x.playerId === foeId) ?? null;
  }
  const base = apiBase();
  if (base) {
    const res = await fetch(`${base}/lineups/${encodeURIComponent(foeId)}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, won, stake: PK_STAKE, prize: PK_WIN_GOLD }),
    });
    if (!res.ok) throw new Error("战报同步失败。");
    return (await res.json()) as PkLineup;
  }
  const list = readLocal();
  const foe = list.find((x) => x.playerId === foeId);
  if (foe && !isNpcPlayer(foe.playerId)) {
    if (won) foe.losses += 1;
    else {
      foe.wins += 1;
      foe.pendingGold += PK_STAKE;
    }
  }
  applyPlayerRecord(list, playerId, won);
  writeLocal(list);
  return foe ?? null;
}

export async function collectPkGold(playerId: string): Promise<number> {
  if (isNpcPlayer(playerId)) return 0;
  const base = apiBase();
  if (base) {
    const res = await fetch(`${base}/me/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) throw new Error("领取失败。");
    const data = (await res.json()) as { gold: number };
    return Math.max(0, data.gold ?? 0);
  }
  const list = readLocal();
  const mine = list.find((x) => x.playerId === playerId);
  const n = Math.max(0, Math.floor(mine?.pendingGold ?? 0));
  if (mine) mine.pendingGold = 0;
  writeLocal(list);
  return n;
}

export function pkCloudReady(): boolean {
  return !!apiBase();
}

export function clearLocalPkPool(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
