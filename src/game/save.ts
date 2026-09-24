import {
  BOX_LIMIT,
  EGG_DURATION,
  INCUBATOR_MAX,
  MAX_STAMINA,
  PARTY_LIMIT,
  SAVE_VERSION,
  emptyStats,
  isEightStats,
  type Creature,
  type Gender,
  type IncubatorSlot,
  type JournalEntry,
  type JournalKind,
  type PlayerNotice,
  type SaveData,
  type Stats,
  type YouthClass,
} from "./types";
import { NATURES, allSpecies, creatureLabel, randomBabySpeciesId, speciesById } from "./data";
import { computedStats } from "./combat";
import { syncGrowth } from "./positions";
import { rollDailyQuests, todayKey, weekKey } from "./daily";
import { rngFromSeed, rollTraits, sanitizeTraits } from "./traits";
import { emptyCareer } from "./types";
import { clearLocalPkPool } from "./pk";

const DB_NAME = "fs-bokemon-save";
const STORE = "slot";
const KEY = "main";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as SaveData | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function persistSave(save: SaveData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(save, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSave(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  clearLocalPkPool();
}

export function exportSaveJson(save: SaveData): string {
  return JSON.stringify(save, null, 2);
}

export function parseSaveJson(text: string): SaveData {
  const data = JSON.parse(text) as SaveData;
  if (!data || !data.trainerName) {
    throw new Error("这份进度读不了，请换一份再试。");
  }
  return migrateSave(data);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function randomIvs(): Stats {
  const iv = () => Math.floor(Math.random() * 32);
  return {
    rebound: iv(),
    jump: iv(),
    run: iv(),
    block: iv(),
    three: iv(),
    mid: iv(),
    stamina: iv(),
    pass: iv(),
  };
}

export function randomNature(): string {
  return NATURES[Math.floor(Math.random() * NATURES.length)].id;
}

export function movesForLevel(speciesId: number, level: number): string[] {
  const learned = speciesById(speciesId)
    .learnset.filter((m) => m.level <= level)
    .map((m) => m.moveId);
  const unique = [...new Set(learned)];
  return unique.slice(-4);
}

export function randomGender(): Gender {
  return Math.random() < 0.5 ? "male" : "female";
}

export function genderForSpecies(speciesId: number): Gender {
  const bias = speciesById(speciesId).genderBias;
  if (bias === "male") return Math.random() < 0.9 ? "male" : "female";
  if (bias === "female") return Math.random() < 0.9 ? "female" : "male";
  return randomGender();
}

export function genderFromUid(id: string): Gender {
  let h = 0;
  for (const ch of id) h += ch.charCodeAt(0);
  return h % 2 === 0 ? "male" : "female";
}

export function allocCreatureCode(existing: Creature[], seed?: string): number {
  const used = new Set(
    existing.map((c) => c.code).filter((n): n is number => typeof n === "number" && n >= 1000 && n <= 9999),
  );
  let n: number;
  if (seed) {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    n = 1000 + (h % 9000);
  } else {
    n = 1000 + Math.floor(Math.random() * 9000);
  }
  for (let i = 0; i < 9000; i += 1) {
    if (!used.has(n)) return n;
    n = n >= 9999 ? 1000 : n + 1;
  }
  return n;
}

export function fillStarterLineup(save: SaveData): Creature[] {
  const added: Creature[] = [];
  const need = Math.max(0, PARTY_LIMIT - (save.box?.length ?? 0));
  if (need > 0) {
    const haveYouth = new Set((save.box ?? []).map((c) => speciesById(c.speciesId).youthClass));
    const order: YouthClass[] = (["C", "F", "G"] as const).filter((y) => !haveYouth.has(y));
    for (const y of ["C", "F", "G"] as const) {
      if (order.length >= need) break;
      order.push(y);
    }
    const used = new Set((save.box ?? []).map((c) => c.speciesId));
    for (const youth of order.slice(0, need)) {
      const pool = allSpecies().filter((s) => s.youthClass === youth && s.rarity === "normal" && !used.has(s.id));
      const fallback = allSpecies().filter((s) => !used.has(s.id));
      const source = pool.length ? pool : fallback;
      const pick = source[Math.floor(Math.random() * source.length)];
      if (!pick) continue;
      used.add(pick.id);
      added.push(makeCreature(pick.id, 7, { friendship: 90 }, [...(save.box ?? []), ...added]));
    }
    save.box = [...(save.box ?? []), ...added];
    for (const c of added) markDex(save, c.speciesId, true);
    for (const slot of save.incubators ?? []) {
      if (slot.egg?.kind === "mystery") slot.egg = null;
    }
  }
  if (added.length || !(save.party ?? []).length) {
    save.party = save.party ?? [];
    for (const c of save.box ?? []) {
      if (save.party.length >= PARTY_LIMIT) break;
      if (!save.party.includes(c.uid) && !save.exploration?.creatureUids.includes(c.uid)) {
        save.party.push(c.uid);
      }
    }
  }
  return added;
}

export function makeCreature(speciesId: number, level: number, opts?: Partial<Creature>, siblings: Creature[] = []): Creature {
  const sp = speciesById(speciesId);
  const c: Creature = {
    uid: opts?.uid ?? uid("pl"),
    speciesId,
    level,
    exp: opts?.exp ?? 0,
    ivs: opts?.ivs ?? randomIvs(),
    nature: opts?.nature ?? randomNature(),
    friendship: opts?.friendship ?? 70,
    shiny: opts?.shiny ?? Math.random() < 1 / 64,
    gender: opts?.gender ?? genderForSpecies(speciesId),
    code: opts?.code ?? allocCreatureCode(siblings),
    moves: opts?.moves ?? movesForLevel(speciesId, level),
    obtainedAt: opts?.obtainedAt ?? Date.now(),
    lastGrowthAt: opts?.lastGrowthAt ?? opts?.obtainedAt ?? Date.now(),
    hp: opts?.hp ?? 1,
    traits: (() => {
      const given = opts?.traits !== undefined ? sanitizeTraits(opts.traits) : [];
      return given.length ? given : rollTraits();
    })(),
    youthClass: opts?.youthClass ?? sp.youthClass,
    position: opts?.position ?? sp.youthClass,
    stage: opts?.stage ?? 1,
    training: opts?.training ?? emptyStats(),
  };
  syncGrowth(c);
  if (opts?.hp === undefined) c.hp = computedStats(c).stamina;
  return c;
}

export function pushJournal(save: SaveData, kind: JournalKind, title: string, lines: string[]): void {
  if (!save.journal) save.journal = [];
  const entry: JournalEntry = { id: uid("jo"), at: Date.now(), kind, title, lines };
  save.journal.unshift(entry);
  save.journal = save.journal.slice(0, 40);
}

export function pushNotice(save: SaveData, notice: PlayerNotice): void {
  if (!save.pendingHatches) save.pendingHatches = [];
  save.pendingHatches.push({
    ...notice,
    id: notice.id ?? uid("nt"),
    lines: notice.lines ?? [],
  });
  save.pendingHatches = save.pendingHatches.slice(0, 8);
}

export function migrateSave(save: SaveData): SaveData {
  const now = Date.now();
  const staleRoster = (save.box ?? []).some((c) => !isEightStats(c.ivs) || !c.youthClass || !c.position);
  if (staleRoster) {
    save.box = [];
    save.party = [];
    save.nursery = [];
    save.breeding = null;
    save.exploration = null;
    save.pendingHatches = [];
    save.dexSeen = [];
    save.dexCaught = [];
    save.incubators = [{ egg: null }];
    save.journal = [
      {
        id: uid("jo"),
        at: now,
        kind: "hatch",
        title: "球员体系更新",
        lines: ["球员改为八维能力与 C/F/G 职业。开训包会重新发一套三人首发。"],
      },
      ...(save.journal ?? []).slice(0, 20),
    ];
  }
  if (!save.journal) save.journal = [];
  if (!save.lastHpRegenAt) save.lastHpRegenAt = save.lastSeenAt ?? now;
  if (!save.inventory) save.inventory = {};
  if (save.inventory["hp-pack"] == null) save.inventory["hp-pack"] = 1;
  if (save.inventory.feed == null) save.inventory.feed = 2;
  if (save.inventory["recruit-ticket"] == null) save.inventory["recruit-ticket"] = save.inventory["poke-ball"] ?? 5;
  if (!save.nursery) save.nursery = [];
  if (save.breeding === undefined) save.breeding = null;
  if (!save.occupiedCourts) save.occupiedCourts = [];
  if (save.courtPayoutPending == null) save.courtPayoutPending = 0;
  if (!save.lastCourtPayoutAt) save.lastCourtPayoutAt = save.lastSeenAt ?? now;
  if (!save.career) save.career = emptyCareer();
  if (!save.career.weekKey) save.career.weekKey = weekKey(now);
  if (!save.dailyQuests) save.dailyQuests = [];
  if (save.dailyQuestClaimed == null) save.dailyQuestClaimed = false;
  if (!save.pendingHatches) save.pendingHatches = [];
  save.pendingHatches = save.pendingHatches.map((n) => ({
    ...n,
    kind: n.kind ?? "debut",
    title: n.title ?? "出道",
    lines: n.lines ?? [],
  }));
  if (!Array.isArray(save.incubators) || save.incubators.length < 1) {
    save.incubators = [{ egg: null }];
  } else {
    save.incubators = save.incubators.slice(0, INCUBATOR_MAX).map((slot): IncubatorSlot =>
      slot && typeof slot === "object" ? { egg: slot.egg ?? null, lastHatch: slot.lastHatch } : { egg: null },
    );
  }
  const granted = fillStarterLineup(save);
  if (granted.length) {
    pushJournal(save, "hatch", "开训三人组", [
      granted.map((c) => creatureLabel(c)).join("、"),
      "中锋、前锋、后卫已编入首发。新手物资已发，先去巷口球场打一场。",
    ]);
  }
  if (!save.playerId) save.playerId = uid("pl");
  if (!save.pkChallengesDate) save.pkChallengesDate = "";
  if (save.pkChallengesCount == null) save.pkChallengesCount = 0;
  if (!Array.isArray(save.pkBeaten)) save.pkBeaten = [];
  if (!Number.isFinite(save.timeScale) || save.timeScale < 1) save.timeScale = 1;
  if (!Array.isArray(save.reports)) save.reports = [];
  if (!Number.isFinite(save.money)) save.money = 0;
  if (!Number.isFinite(save.courtPayoutPending)) save.courtPayoutPending = 0;
  save.version = SAVE_VERSION;
  for (const c of save.box ?? []) {
    const kept = Array.isArray(c.traits) ? sanitizeTraits(c.traits) : [];
    c.traits = kept.length ? kept : rollTraits(rngFromSeed(`${c.uid}:traits`));
    syncGrowth(c);
    if (typeof c.hp !== "number") c.hp = computedStats(c).stamina;
    else c.hp = Math.min(c.hp, computedStats(c).stamina);
    if (c.gender !== "male" && c.gender !== "female") c.gender = genderFromUid(c.uid);
    c.training = isEightStats(c.training) ? c.training : emptyStats();
  }
  const coded: Creature[] = [];
  for (const c of save.box ?? []) {
    if (typeof c.code === "number" && c.code >= 1000 && c.code <= 9999) {
      coded.push(c);
      continue;
    }
    c.code = allocCreatureCode(coded, c.uid);
    coded.push(c);
  }
  return save;
}

export function emptySave(trainerName: string): SaveData {
  const now = Date.now();
  const save: SaveData = {
    version: SAVE_VERSION,
    trainerName,
    createdAt: now,
    lastSeenAt: now,
    lastLunchDate: "",
    lastEncounterCheckAt: now,
    stamina: MAX_STAMINA,
    lastStaminaAt: now,
    lastHpRegenAt: now,
    money: 1200,
    party: [],
    box: [],
    incubators: [{ egg: null }],
    nursery: [],
    breeding: null,
    exploration: null,
    inventory: { "recruit-ticket": 8, "oran-berry": 10, feed: 6, "hp-pack": 6 },
    dexSeen: [],
    dexCaught: [],
    occupiedCourts: [],
    courtPayoutPending: 0,
    lastCourtPayoutAt: now,
    career: emptyCareer(),
    dailyDate: todayKey(now),
    dailyClears: 0,
    dailyQuests: rollDailyQuests(todayKey(now)),
    dailyQuestClaimed: false,
    reports: [],
    journal: [
      {
        id: uid("jo"),
        at: now,
        kind: "hatch",
        title: "开训三人组",
        lines: ["开训包已到位：中锋、前锋、后卫各一名，编入首发。", "新手物资：金币、招募券、能量棒和理疗包。青训营有一颗种子，先去巷口球场打一场。"],
      },
    ],
    pendingHatches: [],
    timeScale: 1,
    starterChosen: true,
    playerId: uid("pl"),
    pkChallengesDate: "",
    pkChallengesCount: 0,
    pkBeaten: [],
  };
  const pack = fillStarterLineup(save);
  if (pack.length) {
    save.journal[0]!.lines = [
      pack.map((c) => creatureLabel(c)).join("、"),
      "中锋、前锋、后卫已编入首发。青训营有一颗种子，先去巷口球场打一场。",
    ];
  }
  const slot = save.incubators[0];
  if (slot && !slot.egg) {
    slot.egg = {
      uid: uid("egg"),
      speciesId: randomBabySpeciesId(),
      kind: "mystery",
      startAt: now,
      durationMs: EGG_DURATION.mystery,
    };
  }
  return save;
}

export function findCreature(save: SaveData, uid: string): Creature | undefined {
  return save.box.find((c) => c.uid === uid);
}

export function canAddToBox(save: SaveData): boolean {
  return save.box.length < BOX_LIMIT;
}

export function markDex(save: SaveData, speciesId: number, caught: boolean): void {
  if (!save.dexSeen.includes(speciesId)) save.dexSeen.push(speciesId);
  if (caught && !save.dexCaught.includes(speciesId)) save.dexCaught.push(speciesId);
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
