export const SKILL_TYPES = ["shot", "slash", "dish", "board", "lock", "body"] as const;

export type SkillType = (typeof SKILL_TYPES)[number];

export type YouthClass = "C" | "F" | "G";

export type Position = "C" | "F" | "G" | "PF" | "SF" | "SG" | "PG" | "SW";

export type GrowthStage = 1 | 2 | 3;

export const STAT_KEYS = ["rebound", "jump", "run", "block", "three", "mid", "stamina", "pass"] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_LABEL: Record<StatKey, string> = {
  rebound: "篮板",
  jump: "弹跳",
  run: "跑动",
  block: "盖帽",
  three: "3分",
  mid: "中投",
  stamina: "体力",
  pass: "传球",
};

export interface Stats {
  rebound: number;
  jump: number;
  run: number;
  block: number;
  three: number;
  mid: number;
  stamina: number;
  pass: number;
}

export type Gender = "male" | "female";

export type MoveCategory = "physical" | "special" | "status";

export interface Move {
  id: string;
  name: string;
  type: SkillType;
  category: MoveCategory;
  power: number;
  accuracy: number;
  effect?: "burn" | "paralyze" | "buff-atk" | "buff-spe" | "heal" | "priority";
}

export interface Species {
  id: number;
  name: string;
  youthClass: YouthClass;
  dualRole: boolean;
  rarity: "normal" | "rare";
  genderBias: Gender | "either";
  stats: Stats;
  eggGroup: string;
  learnset: { level: number; moveId: string }[];
}

export interface Creature {
  uid: string;
  speciesId: number;
  level: number;
  exp: number;
  ivs: Stats;
  nature: string;
  friendship: number;
  shiny: boolean;
  gender: Gender;
  code: number;
  nickname?: string;
  moves: string[];
  obtainedAt: number;
  lastGrowthAt?: number;
  hp: number;
  traits: string[];
  youthClass: YouthClass;
  position: Position;
  stage: GrowthStage;
  training?: Stats;
}

export type JournalKind = "explore" | "hatch" | "raise" | "catch" | "shop" | "heal" | "battle" | "breed";

export interface JournalEntry {
  id: string;
  at: number;
  kind: JournalKind;
  title: string;
  lines: string[];
}

export type EggKind = "normal" | "trainer" | "legendary" | "mystery";

export interface Egg {
  uid: string;
  speciesId: number;
  kind: EggKind;
  startAt: number;
  durationMs: number;
  fromParents?: [string, string];
  inheritedIvs?: Partial<Stats>;
  inheritedNature?: string;
  inheritedMoves?: string[];
  inheritedTraits?: string[];
}

export interface IncubatorSlot {
  egg: Egg | null;
  lastHatch?: { speciesId: number; shiny: boolean; at: number; code?: number } | null;
}

export type DailyQuestId = "campaign" | "hatch" | "career" | "recruit" | "feed";

export interface DailyQuest {
  id: DailyQuestId;
  done: boolean;
}

export type NoticeKind = "debut" | "recruit" | "promote" | "awaken" | "career";

export interface PlayerNotice {
  id?: string;
  kind: NoticeKind;
  title: string;
  lines: string[];
  uid?: string;
  speciesId?: number;
  code?: number;
  shiny?: boolean;
  gender?: Gender;
  autoParty?: boolean;
  traits?: string[];
  position?: Position;
}

/** @deprecated use PlayerNotice; kept as alias for older saves */
export type HatchReveal = PlayerNotice;

export interface Exploration {
  creatureUids: string[];
  locationId: string;
  startAt: number;
  durationMs: number;
}

export interface Breeding {
  parentUids: [string, string];
  startAt: number;
  durationMs: number;
  egg: Egg;
}

export interface BattleReport {
  id: string;
  at: number;
  title: string;
  win: boolean;
  log: string[];
}

export type CareerTier = "national" | "pro" | "intl";

export interface CareerState {
  unlocked: CareerTier | null;
  wins: Record<CareerTier, number>;
  worldChampion: boolean;
  season: number;
  weekKey: string;
  playedThisWeek: boolean;
}

export interface Inventory {
  [itemId: string]: number;
}

export type Screen =
  | "home"
  | "hatch"
  | "box"
  | "outing"
  | "bag"
  | "more"
  | "adventure"
  | "warehouse"
  | "gyms"
  | "shop"
  | "dex"
  | "settings"
  | "battle"
  | "creature";

export type OutTab = "campaign" | "career" | "pk";

export type HatchTab = "youth" | "coach" | "gym";

export interface SaveData {
  version: 3;
  trainerName: string;
  createdAt: number;
  lastSeenAt: number;
  lastLunchDate: string;
  lastEncounterCheckAt: number;
  stamina: number;
  lastStaminaAt: number;
  lastHpRegenAt: number;
  money: number;
  party: string[];
  box: Creature[];
  incubators: IncubatorSlot[];
  nursery: Egg[];
  breeding: Breeding | null;
  exploration: Exploration | null;
  inventory: Inventory;
  dexSeen: number[];
  dexCaught: number[];
  occupiedCourts: string[];
  courtPayoutPending: number;
  lastCourtPayoutAt: number;
  career: CareerState;
  dailyDate: string;
  dailyClears: number;
  dailyQuests: DailyQuest[];
  dailyQuestClaimed: boolean;
  reports: BattleReport[];
  journal: JournalEntry[];
  pendingHatches: PlayerNotice[];
  timeScale: number;
  starterChosen: boolean;
  playerId: string;
  pkChallengesDate: string;
  pkChallengesCount: number;
  pkBeaten: string[];
}

export const SAVE_VERSION = 3 as const;
export const MAX_STAMINA = 8;
export const STAMINA_INTERVAL_MS = 45 * 60 * 1000;
export const LUNCH_BONUS = 3;
export const BOX_LIMIT = 30;
export const PARTY_LIMIT = 3;
export const TRAIT_LIMIT = 4;
export const INCUBATOR_MAX = 4;
export const INCUBATOR_UPGRADE_COST = [600, 1800, 4000] as const;
export const FRIENDSHIP_EVOLVE = 160;
export const HP_REGEN_INTERVAL_MS = 45 * 1000;
export const CAREER_WINS: Record<CareerTier, number> = { national: 4, pro: 4, intl: 3 };
export const OCCUPY_TO_UNLOCK = 2;
export const CAREER_OCCUPY: Record<CareerTier, number> = { national: 2, pro: 4, intl: 6 };
export const CAREER_OVR: Record<CareerTier, number> = { national: 420, pro: 560, intl: 720 };
export const CAMPAIGN_TRAVEL_MS = 10_000;
export const COURT_RENT_INTERVAL_MS = 3 * 60 * 1000;
export const COURT_RENT_MAX_MS = 8 * 60 * 60 * 1000;
export const MATURE_LEVEL = 16;
export const AWAKEN_LEVEL = 32;

export const EGG_DURATION: Record<EggKind, number> = {
  normal: 2 * 60 * 1000,
  trainer: 4 * 60 * 1000,
  legendary: 8 * 60 * 1000,
  mystery: 1 * 60 * 1000,
};

export const BREED_DURATION_MS = 3 * 60 * 1000;
export const NURSERY_LIMIT = 8;
export const TRAIN_CAP_MAX = 8;
export const TRAIN_COST_BASE = 25;
export const TRAIN_COST_STEP = 30;
export const TRAIN_HP_RATIO = 0.08;
export const PK_STAKE = 50;
export const PK_WIN_GOLD = 80;
export const PK_DAILY_CAP = 8;
export const GENDER_LABEL: Record<Gender, string> = { male: "♂", female: "♀" };

export function trainCap(level: number): number {
  return Math.min(TRAIN_CAP_MAX, Math.floor(Math.max(0, level) / 3) + 1);
}

export function trainCost(current: number): number {
  return TRAIN_COST_BASE + Math.max(0, current) * TRAIN_COST_STEP;
}

export function trainedOf(c: Creature, key: StatKey): number {
  return c.training?.[key] ?? 0;
}

export function incubatorUpgradeCost(owned: number): number | null {
  if (owned >= INCUBATOR_MAX) return null;
  return INCUBATOR_UPGRADE_COST[Math.max(0, owned - 1)] ?? null;
}

export function emptyCareer(): CareerState {
  return {
    unlocked: null,
    wins: { national: 0, pro: 0, intl: 0 },
    worldChampion: false,
    season: 1,
    weekKey: "",
    playedThisWeek: false,
  };
}

export function emptyStats(): Stats {
  return { rebound: 0, jump: 0, run: 0, block: 0, three: 0, mid: 0, stamina: 0, pass: 0 };
}

export function isEightStats(v: unknown): v is Stats {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return STAT_KEYS.every((k) => typeof o[k] === "number");
}
