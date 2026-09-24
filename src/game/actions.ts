import { CAREER_LABEL, CAREER_TEAM, CITIES, ITEMS, LUCKY_EGG_POOL, SHOP, babyOf, creatureLabel, courtById, eggHint, sellPrice, speciesById } from "./data";
import { clampHp, computedStats, energyOf, makeAiCreature, maxHpOf } from "./combat";
import { careerHonorMet, careerReadyToPromote, claimDailyBonus, ensureCareerWeek, markDaily, nextCareerTier } from "./daily";
import { cityUnlocked, occupiedCount, collectCourtRent } from "./courts";
import { addExp, addFriendship, inheritTraits } from "./traits";
import { clearSave, emptySave, findCreature, migrateSave, persistSave, pushJournal, pushNotice, uid } from "./save";
import { applyMatchHp, expToNext, growthFatigueRecap, makeEgg, levelUpIfNeeded, maybeLevelEvolve, settle, type PendingBattle, type SettleLog } from "./settle";
import { simulateMatch, type SimResult } from "./sim";
import { partyAvgOvr } from "./power";
import {
  collectPkGold,
  creatureFromPk,
  ensurePkDaily,
  isNpcPlayer,
  listLineups,
  markPkBeaten,
  npcPkLineups,
  pkRemaining,
  pkUnlocked,
  reportPkResult,
  uploadLineup,
  type PkLineup,
} from "./pk";
import {
  BOX_LIMIT,
  BREED_DURATION_MS,
  CAMPAIGN_TRAVEL_MS,
  CAREER_OCCUPY,
  CAREER_OVR,
  CAREER_WINS,
  FRIENDSHIP_EVOLVE,
  NURSERY_LIMIT,
  PARTY_LIMIT,
  PK_STAKE,
  PK_WIN_GOLD,
  STAT_KEYS,
  STAT_LABEL,
  TRAIN_HP_RATIO,
  emptyStats,
  incubatorUpgradeCost,
  trainCap,
  trainCost,
  trainedOf,
  type Creature,
  type EggKind,
  type HatchTab,
  type OutTab,
  type Position,
  type SaveData,
  type Screen,
  type StatKey,
} from "./types";

export interface BattleSide {
  name: string;
  position: Position;
}

export interface UiState {
  save: SaveData | null;
  screen: Screen;
  selectedUid: string | null;
  partySlot: number | null;
  battleTitle: string;
  battleLog: string[];
  battleShown: number;
  battleWin: boolean | null;
  battleAllies: BattleSide[];
  battleFoes: BattleSide[];
  battleSummary: string;
  battleBack: Screen;
  battleUids: string[];
  toast: string[];
  onboardName: string;
  modal: "explore" | "gym" | "hatch" | null;
  outTab: OutTab;
  hatchTab: HatchTab;
  creatureMoreOpen: boolean;
  flash: string;
  queuedBattles: PendingBattle[];
}

export const ui: UiState = {
  save: null,
  screen: "home",
  selectedUid: null,
  partySlot: null,
  battleTitle: "",
  battleLog: [],
  battleShown: 0,
  battleWin: null,
  battleAllies: [],
  battleFoes: [],
  battleSummary: "",
  battleBack: "outing",
  battleUids: [],
  toast: [],
  onboardName: "",
  modal: null,
  outTab: "campaign",
  hatchTab: "youth",
  creatureMoreOpen: false,
  flash: "",
  queuedBattles: [],
};

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function toast(msg: string): void {
  ui.toast = [...ui.toast.slice(-4), msg];
  emit();
  setTimeout(() => {
    ui.toast = ui.toast.filter((t) => t !== msg);
    emit();
  }, 3200);
}

export function flash(msg: string): void {
  ui.flash = msg;
  emit();
  window.setTimeout(() => {
    if (ui.flash === msg) {
      ui.flash = "";
      emit();
    }
  }, 2400);
}

async function commit(): Promise<void> {
  if (ui.save) await persistSave(ui.save);
  emit();
}

export function setScreen(screen: Screen, selectedUid?: string | null): void {
  if (screen === "box") screen = "home";
  if (screen === "gyms") {
    screen = "outing";
    ui.outTab = "career";
  } else if (screen === "adventure") {
    screen = "outing";
    ui.outTab = "campaign";
  }
  if (screen === "warehouse" || screen === "shop") screen = "bag";
  if (screen === "dex" || screen === "settings") screen = "more";
  const leavingBattle = ui.screen === "battle" && screen !== "battle";
  ui.screen = screen;
  if (selectedUid !== undefined && selectedUid !== ui.selectedUid) ui.creatureMoreOpen = false;
  if (selectedUid !== undefined) ui.selectedUid = selectedUid;
  if (screen !== "creature") ui.creatureMoreOpen = false;
  if (screen !== "home") ui.partySlot = null;
  if (screen !== "battle") stopBattleTicker();
  if (screen !== "outing" && screen !== "hatch") ui.modal = null;
  emit();
  if (leavingBattle) flushQueuedBattle();
}

export function setOutTab(tab: OutTab): void {
  ui.outTab = tab;
  ui.screen = "outing";
  emit();
  if (tab === "pk") void refreshPkList();
}

export function setHatchTab(tab: HatchTab): void {
  ui.hatchTab = tab;
  ui.screen = "hatch";
  emit();
}

export async function flushGymPayout(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const n = collectCourtRent(save);
  if (!n) return;
  toast(`球场租金 +${n}`);
  await persistSave(save);
  emit();
}

export function setModal(modal: "explore" | "gym" | "hatch" | null): void {
  ui.modal = modal;
  emit();
}

export async function clearLastHatch(index: number): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const slot = save.incubators[index];
  if (slot) slot.lastHatch = null;
  await commit();
}

export function beginPartyEdit(slot: number): void {
  ui.partySlot = Math.max(0, Math.min(PARTY_LIMIT - 1, slot));
  ui.screen = "home";
  emit();
}

export function cancelPartyEdit(): void {
  ui.partySlot = null;
  emit();
}

function isBreedingParent(save: SaveData, creatureUid: string): boolean {
  return !!save.breeding?.parentUids.includes(creatureUid);
}

function busy(save: SaveData, id: string): boolean {
  return !!save.exploration?.creatureUids.includes(id) || isBreedingParent(save, id);
}

export async function boot(save: SaveData | null): Promise<void> {
  if (!save) {
    ui.save = null;
    ui.screen = "home";
    emit();
    return;
  }
  const before = save.box.length;
  migrateSave(save);
  const notes = settle(save);
  ui.save = save;
  ui.screen = save.box.length === 0 && save.incubators.some((s) => s.egg) ? "hatch" : "home";
  await persistSave(save);
  applySettleNotes(notes);
  await flushGymPayout();
  emit();
  if (save.box.length > before) toast("已补齐开训三人组，可直接去比赛。");
  for (const line of notes.lines) toast(line);
}

export async function createTrainer(): Promise<void> {
  const name = ui.onboardName.trim() || "街球队长";
  const save = emptySave(name);
  ui.save = save;
  ui.screen = "home";
  await persistSave(save);
  toast(`欢迎，${name}！开训包和物资已到位，先去巷口球场打一场。`);
  emit();
}

export function partyCreatures(save: SaveData): Creature[] {
  return save.party
    .map((id) => findCreature(save, id))
    .filter((c): c is Creature => !!c);
}

export function battleReady(save: SaveData): Creature[] {
  return partyCreatures(save).filter((c) => {
    clampHp(c);
    return c.hp > 0 && !busy(save, c.uid);
  });
}

export async function setPartyMember(id: string, index: number): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const c = findCreature(save, id);
  if (!c) return;
  if (busy(save, id)) {
    toast("这名球员正忙，先等他回来。");
    return;
  }
  if (save.party.includes(id)) {
    toast(`${creatureLabel(c)} 已经在首发了。`);
    return;
  }
  const slot = Math.max(0, Math.min(PARTY_LIMIT - 1, index));
  const next = [...save.party];
  while (next.length < slot) next.push("");
  if (slot >= next.length) next.push(id);
  else next[slot] = id;
  save.party = next.filter(Boolean).slice(0, PARTY_LIMIT);
  ui.partySlot = null;
  toast(`${creatureLabel(c)} 已放入首发 ${Math.min(slot, save.party.length - 1) + 1}`);
  ui.screen = "home";
  await commit();
}

export async function releaseCreature(id: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const c = findCreature(save, id);
  if (!c) return;
  if (busy(save, id)) {
    toast("正忙的球员不能解约。");
    return;
  }
  if (save.party.includes(id) && save.party.filter((x) => x !== id).length === 0) {
    toast("不能解约最后一名首发，先换人。");
    return;
  }
  const name = creatureLabel(c);
  save.box = save.box.filter((x) => x.uid !== id);
  save.party = save.party.filter((x) => x !== id);
  if (ui.selectedUid === id) {
    ui.selectedUid = null;
    ui.screen = "home";
  }
  pushJournal(save, "raise", "解约", [`${name} 离开了球队。`]);
  toast(`${name} 已解约。`);
  await commit();
}

export async function toggleParty(id: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  if (save.party.includes(id)) {
    if (save.party.length <= 1) {
      toast("至少要留一名首发。");
      return;
    }
    save.party = save.party.filter((x) => x !== id);
  } else {
    if (busy(save, id)) {
      toast("这名球员正在征战或带教。");
      return;
    }
    if (save.party.length >= PARTY_LIMIT) {
      beginPartyEdit(0);
      toast("首发已满，点空位更换。");
      return;
    }
    save.party.push(id);
  }
  await commit();
}

function applyHealItem(save: SaveData, c: Creature, itemId: string): string | null {
  const n = save.inventory[itemId] ?? 0;
  if (n <= 0) return null;
  clampHp(c);
  const max = maxHpOf(c);
  if (c.hp >= max) return "full";
  if (itemId === "oran-berry") {
    save.inventory[itemId] = n - 1;
    const before = c.hp;
    c.hp = Math.min(max, before + Math.ceil(max * 0.5));
    addFriendship(c, 4);
    pushJournal(save, "heal", "使用能量棒", [`${creatureLabel(c)} ${before}→${c.hp}/${max}`]);
    return `${creatureLabel(c)} 体力 ${before}→${c.hp}`;
  }
  if (itemId === "hp-pack") {
    save.inventory[itemId] = n - 1;
    const fromHp = c.hp;
    c.hp = max;
    pushJournal(save, "heal", "使用理疗包", [`${creatureLabel(c)} ${fromHp}→${max}/${max}`]);
    return `${creatureLabel(c)} 体力回满`;
  }
  return null;
}

function healCreatures(save: SaveData, list: Creature[]): string[] {
  const notes: string[] = [];
  const ratio = (c: Creature) => {
    const e = energyOf(c);
    return e.max ? e.hp / e.max : 1;
  };
  const need = [...list]
    .filter((c) => {
      const e = energyOf(c);
      return e.down || e.hp < e.max;
    })
    .sort((a, b) => ratio(a) - ratio(b));
  const down = need.filter((c) => energyOf(c).down);
  const rest = need.filter((c) => !energyOf(c).down);
  const spend = (c: Creature, preferPack: boolean): boolean => {
    if (preferPack) {
      const packed = applyHealItem(save, c, "hp-pack");
      if (packed && packed !== "full") {
        notes.push(packed);
        return true;
      }
    }
    const bar = applyHealItem(save, c, "oran-berry");
    if (bar && bar !== "full") {
      notes.push(bar);
      return true;
    }
    const packed = applyHealItem(save, c, "hp-pack");
    if (packed && packed !== "full") {
      notes.push(packed);
      return true;
    }
    return false;
  };
  for (const c of down) {
    if (!spend(c, true)) break;
  }
  for (const c of rest) {
    if (energyOf(c).hp >= maxHpOf(c)) continue;
    if (!spend(c, false)) break;
  }
  return notes;
}

export async function healBattleSquad(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const team = ui.battleUids.map((id) => findCreature(save, id)).filter((c): c is Creature => !!c);
  const notes = healCreatures(save, team);
  if (!notes.length) {
    toast("没有恢复道具，或上场的人不用恢复。");
    return;
  }
  await commit();
  flash(notes.join("\n"));
}

export async function healPartyStarters(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const notes = healCreatures(save, partyCreatures(save));
  if (!notes.length) {
    toast("没有恢复道具，或首发不用恢复。");
    return;
  }
  await commit();
  flash(notes.join("\n"));
}

export async function feed(id: string, itemId: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const c = findCreature(save, id);
  if (!c) return;
  if (itemId === "oran-berry" || itemId === "hp-pack") {
    const line = applyHealItem(save, c, itemId);
    if (line === null) {
      toast("没有这个道具。");
      return;
    }
    if (line === "full") {
      toast("体力已经满了。");
      return;
    }
    await commit();
    flash(line);
    return;
  }
  const n = save.inventory[itemId] ?? 0;
  if (n <= 0) {
    toast("没有这个道具。");
    return;
  }
  save.inventory[itemId] = n - 1;
  const fromLv = c.level;
  const fromFriend = c.friendship;
  if (itemId === "feed") {
    addExp(c, expToNext(c.level));
    addFriendship(c, 20);
  } else {
    save.inventory[itemId] = n;
    toast("这个用不上。");
    return;
  }
  const grew = levelUpIfNeeded(c);
  if (grew) maybeLevelEvolve(save, c, { lines: [] });
  const lines = [`使用了 ${ITEMS[itemId]?.name ?? itemId}`];
  if (grew) lines.push(`${creatureLabel(c)} 升到了 Lv.${c.level}（原 Lv.${fromLv}）`);
  else lines.push(`${creatureLabel(c)} 获得了经验，忠诚度 ${c.friendship}`);
  pushJournal(save, "raise", "养成", lines);
  markDaily(save, "feed");
  await commit();
  const bits = [`忠诚度 ${fromFriend} → ${c.friendship}`];
  if (grew) bits.unshift(`升到 Lv.${c.level}`);
  flash(`${creatureLabel(c)}\n${bits.join("\n")}`);
}

export async function startCampaign(courtId: string, uids: string[]): Promise<void> {
  const save = ui.save;
  if (!save) return;
  if (save.exploration) {
    toast("已经有队伍在路上。");
    return;
  }
  const court = courtById(courtId);
  if (!court) return;
  const city = CITIES.find((c) => c.id === court.cityId);
  if (!city || !cityUnlocked(save, city.id)) {
    toast("这座城市还没解锁。");
    return;
  }
  if (uids.length !== 3) {
    toast("征战需要派出 3 名球员。");
    return;
  }
  if (uids.some((id) => busy(save, id))) {
    toast("有球员正忙。");
    return;
  }
  const team = uids.map((id) => findCreature(save, id)).filter((c): c is Creature => !!c);
  if (team.length !== 3) {
    toast("征战需要派出 3 名球员。");
    return;
  }
  const down = team.filter((c) => energyOf(c).down);
  if (down.length) {
    toast(`${down.map((c) => creatureLabel(c)).join("、")} 体力见底，换人或用理疗包。`);
    return;
  }
  save.exploration = {
    creatureUids: uids,
    locationId: courtId,
    startAt: Date.now(),
    durationMs: CAMPAIGN_TRAVEL_MS,
  };
  const names = uids.map((id) => {
    const c = findCreature(save, id);
    return c ? creatureLabel(c) : "?";
  });
  pushJournal(save, "explore", "出发征战", [`前往 ${court.name}，约 10 秒后开战。`, `成员：${names.join("、")}`]);
  toast(`已出发前往 ${court.name}，约 10 秒后开战。`);
  await commit();
}

export const startExplore = startCampaign;

export async function upgradeIncubator(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const cost = incubatorUpgradeCost(save.incubators.length);
  if (cost == null) {
    toast("青训营已经满级。");
    return;
  }
  if (save.money < cost) {
    toast(`扩建需要 ${cost} 金币。`);
    return;
  }
  save.money -= cost;
  save.incubators.push({ egg: null });
  toast(`青训营扩建到 ${save.incubators.length} 席。`);
  await commit();
}

export async function putEggInSlot(speciesId: number, kind: EggKind): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const slot = save.incubators.find((s) => !s.egg);
  if (!slot) {
    toast("青训营已满。");
    return;
  }
  slot.egg = makeEgg(speciesId, kind);
  slot.lastHatch = null;
  await commit();
}

export async function mergeThree(speciesId: number): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const same = save.box.filter((c) => c.speciesId === speciesId && !save.party.includes(c.uid) && !busy(save, c.uid));
  if (same.length < 3) {
    toast("需要 3 名空闲的同名球员。");
    return;
  }
  const eaten = same.slice(0, 3);
  save.box = save.box.filter((c) => !eaten.some((e) => e.uid === c.uid));
  save.party = save.party.filter((id) => !eaten.some((e) => e.uid === id));
  const slot = save.incubators.find((s) => !s.egg);
  if (!slot) {
    toast("请先空出一个青训席。");
    save.box.push(...eaten);
    return;
  }
  slot.egg = makeEgg(speciesId, "trainer");
  slot.lastHatch = null;
  toast(`三名同名球员已抽去带新秀，开始培养 ${eggHint(speciesId)}。`);
  await commit();
}

export async function startBreed(mentorUid: string, aideUid: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  if (save.breeding) {
    toast("已经有一组在带教了。");
    return;
  }
  const mentor = findCreature(save, mentorUid);
  const aide = findCreature(save, aideUid);
  if (!mentor || !aide || mentor.uid === aide.uid) {
    toast("请选择两名不同的球员。");
    return;
  }
  if (busy(save, mentor.uid) || busy(save, aide.uid)) {
    toast("正忙的球员不能参加带教。");
    return;
  }
  if (save.money < 200) {
    toast("带教新人需要 200 金币。");
    return;
  }
  if ((save.nursery ?? []).length >= NURSERY_LIMIT) {
    toast("待培养的青训种子太多了，先送进青训营。");
    return;
  }
  save.money -= 200;
  const [main, other] = mentor.level >= aide.level ? [mentor, aide] : [aide, mentor];
  const childSpecies = Math.random() < 0.65 ? babyOf(main.speciesId) : babyOf(other.speciesId);
  const keys = [...STAT_KEYS];
  const pick = [...keys].sort(() => Math.random() - 0.5).slice(0, 3);
  const inheritedIvs: Partial<Creature["ivs"]> = {};
  for (const k of pick) inheritedIvs[k] = Math.random() < 0.5 ? mentor.ivs[k] : aide.ivs[k];
  const egg = makeEgg(childSpecies, "trainer", {
    startAt: 0,
    fromParents: [mentor.uid, aide.uid],
    inheritedIvs,
    inheritedNature: Math.random() < 0.9 ? (Math.random() < 0.5 ? mentor.nature : aide.nature) : undefined,
    inheritedMoves: [...new Set([...mentor.moves, ...aide.moves])].slice(0, 2),
    inheritedTraits: inheritTraits(mentor.traits, aide.traits),
  });
  save.breeding = {
    parentUids: [mentor.uid, aide.uid],
    startAt: Date.now(),
    durationMs: BREED_DURATION_MS,
    egg,
  };
  pushJournal(save, "breed", "开始带教新人", [
    `导师 ${creatureLabel(mentor)} · 助教 ${creatureLabel(aide)}`,
    "大约 3 分钟后会带出一名青训种子。",
  ]);
  toast("带教开始，约 3 分钟后可接到人。");
  ui.screen = "hatch";
  ui.hatchTab = "coach";
  await commit();
}

export async function trainStat(uid: string, key: StatKey): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const c = findCreature(save, uid);
  if (!c) return;
  if (busy(save, c.uid)) {
    toast("这名球员正忙，不能训练。");
    return;
  }
  if (!c.training || !STAT_KEYS.every((k) => typeof c.training?.[k] === "number")) {
    c.training = emptyStats();
  }
  const current = trainedOf(c, key);
  const cap = trainCap(c.level);
  if (cap <= 0) {
    toast("等级还低，先去比赛升级再练。");
    return;
  }
  if (current >= cap) {
    toast("先去比赛升级，才能继续练这项。");
    return;
  }
  const cost = trainCost(current);
  if (save.money < cost) {
    toast(`训练需要 ${cost} 金币。`);
    return;
  }
  clampHp(c);
  const max = maxHpOf(c);
  const drain = Math.max(1, Math.floor(max * TRAIN_HP_RATIO));
  if (c.hp <= drain) {
    toast("太累了，先休息或用理疗包。");
    return;
  }
  save.money -= cost;
  const before = computedStats(c)[key];
  c.training[key] = current + 1;
  c.hp = Math.max(1, c.hp - drain);
  clampHp(c);
  const after = computedStats(c)[key];
  pushJournal(save, "raise", "训练房", [
    `${creatureLabel(c)} 加练${STAT_LABEL[key]} ${before}→${after}`,
    `训练 ${current}→${current + 1}/${cap}，花费 ${cost} 金币。`,
  ]);
  toast(`${creatureLabel(c)} ${STAT_LABEL[key]} ${before}→${after}`);
  ui.hatchTab = "gym";
  await commit();
}

export async function placeNurseryEgg(eggUid: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const slot = save.incubators.find((s) => !s.egg);
  if (!slot) {
    toast("青训营已满。");
    return;
  }
  const egg = (save.nursery ?? []).find((e) => e.uid === eggUid);
  if (!egg) return;
  save.nursery = save.nursery.filter((e) => e.uid !== eggUid);
  egg.startAt = Date.now();
  slot.egg = egg;
  slot.lastHatch = null;
  await commit();
}

export async function sellItem(itemId: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const n = save.inventory[itemId] ?? 0;
  if (n <= 0) return;
  const price = sellPrice(itemId);
  save.inventory[itemId] = n - 1;
  save.money += price;
  pushJournal(save, "shop", `出售${ITEMS[itemId]?.name ?? itemId}`, [`卖出 1 个，获得 ${price} 金币`]);
  toast(`卖出 ${ITEMS[itemId]?.name ?? itemId}，+${price} 金币`);
  await commit();
}

export async function runCareer(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  ensureCareerWeek(save);
  if (save.career.worldChampion) {
    if (save.career.playedThisWeek) {
      toast("本周卫冕赛已经打过了。");
      return;
    }
    const ready = battleReady(save);
    if (ready.length < 3) {
      if (partyCreatures(save).some((c) => energyOf(c).down)) {
        toast("有首发体力见底，换替补或用理疗包再报名。");
        return;
      }
      toast("卫冕赛需要 3 名能上场的首发。");
      return;
    }
    save.career.playedThisWeek = true;
    const foes = CAREER_TEAM.intl.map((m, i) => makeAiCreature(m.speciesId, m.level, `defend${i}`, m.name));
    const result = simulateMatch(ready, foes, "卫冕赛");
    const beforeLv: Record<string, number> = {};
    for (const c of ready) beforeLv[c.uid] = c.level;
    applyMatchHp(save, result.remainingHp);
    if (result.won) {
      save.money += 400;
      for (const c of ready) {
        addExp(c, 70);
        addFriendship(c, 6);
        if (levelUpIfNeeded(c)) maybeLevelEvolve(save, c, { lines: [] });
      }
    }
    pushJournal(save, "battle", "卫冕赛", [`比分 ${result.home}-${result.away}`, result.won ? "获胜" : "失利"]);
    markDaily(save, "career");
    if (!save.reports) save.reports = [];
    save.reports.unshift({ id: uid("rp"), at: Date.now(), title: "卫冕赛", win: result.won, log: result.log });
    save.reports = save.reports.slice(0, 20);
    const recapBits: string[] = [result.won ? "卫冕成功 +400 金币" : "卫冕失利"];
    const fatigue = growthFatigueRecap(ready, beforeLv);
    if (fatigue) recapBits.push(fatigue);
    ui.outTab = "career";
    openBattle("卫冕赛", result, "outing", ready, foes, recapBits.filter(Boolean).join("\n"));
    await commit();
    return;
  }
  if (!save.career.unlocked) {
    if (!careerHonorMet(save, "national")) {
      toast(`先占领 ${CAREER_OCCUPY.national} 座有名球场。当前 ${occupiedCount(save)}/${CAREER_OCCUPY.national}。`);
      return;
    }
    save.career.unlocked = "national";
  }
  if (save.career.playedThisWeek) {
    toast("本周生涯赛已经打过了。");
    return;
  }
  const ready = battleReady(save);
  if (ready.length < 3) {
    if (partyCreatures(save).some((c) => energyOf(c).down)) {
      toast("有首发体力见底，换替补或用理疗包再报名。");
      return;
    }
    toast("生涯赛需要 3 名能上场的首发。");
    return;
  }
  if (careerReadyToPromote(save)) {
    const next = nextCareerTier(save.career.unlocked);
    if (next) {
      if (!careerHonorMet(save, next)) {
        toast(`${CAREER_LABEL[save.career.unlocked]}冠军已到手。再占领 ${Math.max(0, CAREER_OCCUPY[next] - occupiedCount(save))} 座有名球场，才能进${CAREER_LABEL[next]}。`);
        return;
      }
      const need = CAREER_OVR[next];
      const avg = partyAvgOvr(ready);
      if (avg < need) {
        toast(`晋级${CAREER_LABEL[next]}需要首发平均综合能力 ${need}，当前 ${avg}。先去征战和训练房。`);
        return;
      }
      save.career.unlocked = next;
      toast(`晋级${CAREER_LABEL[next]}！`);
      pushNotice(save, {
        kind: "career",
        title: "生涯晋级",
        lines: [`球队打进了${CAREER_LABEL[next]}。`, "下一场将面对更强的对手。"],
      });
    }
  }
  const tier = save.career.unlocked;
  if (!tier) return;
  const avg = partyAvgOvr(ready);
  if (avg < CAREER_OVR[tier]) {
    toast(`首发平均综合能力 ${avg}，${CAREER_LABEL[tier]}需要 ${CAREER_OVR[tier]}。先去征战和训练房。`);
    return;
  }
  save.career.playedThisWeek = true;
  const roster = CAREER_TEAM[tier];
  const foes = roster.map((m, i) => makeAiCreature(m.speciesId, m.level, `career${i}`, m.name));
  const result = simulateMatch(ready, foes, CAREER_LABEL[tier]);
  const beforeLv: Record<string, number> = {};
  for (const c of ready) beforeLv[c.uid] = c.level;
  applyMatchHp(save, result.remainingHp);
  if (result.won) {
    save.career.wins[tier] += 1;
    const prize = tier === "national" ? 220 : tier === "pro" ? 420 : 800;
    save.money += prize;
    for (const c of ready) {
      addExp(c, tier === "intl" ? 140 : 90);
      addFriendship(c, 8);
      if (levelUpIfNeeded(c)) maybeLevelEvolve(save, c, { lines: [] });
    }
    if (save.career.wins[tier] >= CAREER_WINS[tier]) {
      if (tier === "intl") {
        save.career.worldChampion = true;
        const placed = grantWorldChampionEgg(save);
        const eggLine = placed === "incubator"
          ? "一名天才级青训种子已送入青训营。"
          : placed === "nursery"
            ? "青训席满了，种子先放到培养中心。"
            : "青训营和培养中心都满了，种子没能收下。";
        toast(placed ? `拿下世界冠军！${eggLine}` : "拿下世界冠军！");
        pushNotice(save, {
          kind: "career",
          title: "世界冠军",
          lines: ["国际大赛夺冠。", eggLine],
        });
      } else {
        toast(`${CAREER_LABEL[tier]}冠军！下一场将晋级。`);
        pushNotice(save, {
          kind: "career",
          title: `${CAREER_LABEL[tier]}冠军`,
          lines: ["本级联赛已经拿下。", "再占够有名球场、首发综合能力达标后，下一场将晋级。"],
        });
      }
    }
  }
  markDaily(save, "career");
  if (!save.reports) save.reports = [];
  save.reports.unshift({ id: uid("rp"), at: Date.now(), title: CAREER_LABEL[tier], win: result.won, log: result.log });
  save.reports = save.reports.slice(0, 20);
  const recapBits: string[] = [];
  if (result.won) recapBits.push(`${CAREER_LABEL[tier]} ${save.career.wins[tier]}/${CAREER_WINS[tier]}`);
  const fatigue = growthFatigueRecap(ready, beforeLv);
  if (fatigue) recapBits.push(fatigue);
  pushJournal(save, "battle", CAREER_LABEL[tier], [`比分 ${result.home}-${result.away}`, result.won ? "获胜" : "失利"]);
  ui.outTab = "career";
  openBattle(CAREER_LABEL[tier], result, "outing", ready, foes, recapBits.filter(Boolean).join("\n"));
  await commit();
}

function grantWorldChampionEgg(save: SaveData): "incubator" | "nursery" | null {
  const sid = LUCKY_EGG_POOL[Math.floor(Math.random() * LUCKY_EGG_POOL.length)];
  const egg = makeEgg(sid, "legendary");
  const slot = save.incubators.find((s) => !s.egg);
  if (slot) {
    slot.egg = egg;
    slot.lastHatch = null;
    return "incubator";
  }
  if (!save.nursery) save.nursery = [];
  if (save.nursery.length < NURSERY_LIMIT) {
    save.nursery.push(egg);
    return "nursery";
  }
  return null;
}

let battleTicker: number | undefined;

function stopBattleTicker(): void {
  if (battleTicker !== undefined) {
    window.clearInterval(battleTicker);
    battleTicker = undefined;
  }
}

function openBattle(title: string, result: SimResult, back: Screen, allies: Creature[], foes: Creature[], recap = ""): void {
  ui.screen = "battle";
  ui.battleTitle = title;
  ui.battleLog = result.log;
  ui.battleShown = result.log.length ? 1 : 0;
  ui.battleWin = result.won;
  ui.battleBack = back;
  ui.battleUids = allies.map((c) => c.uid);
  ui.battleAllies = allies.map((c) => ({ name: creatureLabel(c), position: c.position }));
  ui.battleFoes = foes.map((c) => ({ name: creatureLabel(c), position: c.position }));
  const head = `${result.home}-${result.away} · ${result.won ? "获胜" : "失利"}`;
  ui.battleSummary = recap ? `${head}\n${recap}` : head;
  stopBattleTicker();
  battleTicker = window.setInterval(() => {
    if (ui.screen !== "battle") {
      stopBattleTicker();
      return;
    }
    if (ui.battleShown >= ui.battleLog.length) {
      stopBattleTicker();
      emit();
      return;
    }
    ui.battleShown += 1;
    emit();
  }, 380);
}

export function skipBattlePlayback(): void {
  ui.battleShown = ui.battleLog.length;
  stopBattleTicker();
  emit();
}

function flushQueuedBattle(): void {
  const next = ui.queuedBattles.shift();
  if (!next) return;
  openBattle(next.title, next.result, "outing", next.allies, next.foes, next.recap ?? "");
}

export function applySettleNotes(notes: SettleLog): void {
  if (!notes.pendingBattle) return;
  if (ui.screen === "battle") {
    ui.queuedBattles.push(notes.pendingBattle);
    return;
  }
  const b = notes.pendingBattle;
  openBattle(b.title, b.result, "outing", b.allies, b.foes, b.recap ?? "");
  emit();
}

export async function buyShop(itemId: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const goods = SHOP.find((g) => g.id === itemId);
  if (!goods) return;
  if (save.money < goods.price) {
    toast("钱不够。");
    return;
  }
  if (itemId === "lucky-seed") {
    const slot = save.incubators.find((s) => !s.egg);
    if (!slot) {
      toast("请先空出一个青训席。");
      return;
    }
    save.money -= goods.price;
    const sid = LUCKY_EGG_POOL[Math.floor(Math.random() * LUCKY_EGG_POOL.length)];
    slot.egg = makeEgg(sid, "trainer");
    slot.lastHatch = null;
    pushJournal(save, "shop", "购买随机青训种子", [`花费 ${goods.price} 金币`, `开始培养 ${eggHint(sid)}`]);
    toast(`${eggHint(sid)} 开始接受培养`);
    await commit();
    return;
  }
  save.money -= goods.price;
  save.inventory[itemId] = (save.inventory[itemId] ?? 0) + 1;
  pushJournal(save, "shop", `购买${goods.name}`, [`花费 ${goods.price} 金币`, `仓库 ${goods.name} ×${save.inventory[itemId]}`]);
  toast(`买到了 ${goods.name}`);
  await commit();
}

export async function useBagLuckyEgg(): Promise<void> {
  toast("请在商店直接买随机青训种子。");
}

export async function setTimeScale(n: number): Promise<void> {
  if (!ui.save) return;
  ui.save.timeScale = n;
  toast(n > 1 ? "已开启加速（计时 ×60）" : "已恢复真实时间");
  await commit();
}

export async function skipMinutes(mins: number): Promise<void> {
  if (!ui.save) return;
  ui.save.lastSeenAt -= mins * 60 * 1000;
  ui.save.lastStaminaAt -= mins * 60 * 1000;
  ui.save.lastHpRegenAt = (ui.save.lastHpRegenAt ?? ui.save.lastSeenAt) - mins * 60 * 1000;
  ui.save.lastCourtPayoutAt = (ui.save.lastCourtPayoutAt ?? ui.save.lastSeenAt) - mins * 60 * 1000;
  if (ui.save.exploration) ui.save.exploration.startAt -= mins * 60 * 1000;
  if (ui.save.breeding) ui.save.breeding.startAt -= mins * 60 * 1000;
  for (const slot of ui.save.incubators) {
    if (slot.egg) slot.egg.startAt -= mins * 60 * 1000;
  }
  const notes = settle(ui.save);
  await commit();
  applySettleNotes(notes);
  await flushGymPayout();
  for (const line of notes.lines) toast(line);
  if (!notes.lines.length) toast(`快进了 ${mins} 分钟。`);
}

export async function renameTrainer(name: string): Promise<void> {
  if (!ui.save) return;
  ui.save.trainerName = name.trim() || ui.save.trainerName;
  await commit();
}

export async function renameCreature(creatureUid: string, name: string): Promise<void> {
  if (!ui.save) return;
  const c = findCreature(ui.save, creatureUid);
  if (!c) return;
  const next = name.trim().slice(0, 8);
  c.nickname = next || undefined;
  toast(next ? `${speciesById(c.speciesId).name} 现在叫 ${next}` : "已恢复本名");
  await commit();
}

export async function claimDailyReward(): Promise<void> {
  if (!ui.save) return;
  const r = claimDailyBonus(ui.save);
  toast(r.text);
  if (r.ok) await commit();
}

export async function dismissHatchReveal(): Promise<void> {
  if (!ui.save?.pendingHatches?.length) return;
  ui.save.pendingHatches.shift();
  await commit();
}

export async function resetGame(): Promise<void> {
  await clearSave();
  ui.save = null;
  ui.screen = "home";
  ui.selectedUid = null;
  ui.partySlot = null;
  ui.onboardName = "";
  ui.queuedBattles = [];
  pkCache = npcPkLineups();
  toast("可以重新起名了。");
  emit();
}

export async function replaceSave(next: SaveData): Promise<void> {
  migrateSave(next);
  settle(next);
  ui.save = next;
  await persistSave(next);
  toast("进度已读入。");
  ui.screen = "home";
  emit();
}

export function setOnboard(name: string): void {
  ui.onboardName = name;
}

export async function useStone(): Promise<void> {
  toast("球员靠等级成熟和超觉醒。");
}

export let pkCache: PkLineup[] = npcPkLineups();

export async function refreshPkList(): Promise<void> {
  const save = ui.save;
  try {
    if (save?.playerId) {
      const n = await collectPkGold(save.playerId);
      if (n) {
        save.money += n;
        toast(`PK 防守金币 +${n}`);
        await persistSave(save);
      }
    }
    pkCache = await listLineups();
  } catch (err) {
    pkCache = npcPkLineups();
    toast(err instanceof Error ? err.message : "挑战名单暂时打不开。");
  }
  emit();
}

export async function uploadPkTeam(): Promise<void> {
  const save = ui.save;
  if (!save) return;
  const team = partyCreatures(save);
  if (team.length < 3) {
    toast("上传需要 3 名首发。");
    return;
  }
  try {
    await uploadLineup(save, team.slice(0, 3));
    toast("首发已挂上挑战墙。");
    await commit();
    await refreshPkList();
  } catch (err) {
    toast(err instanceof Error ? err.message : "上传失败。");
  }
}

export async function challengePk(foeId: string): Promise<void> {
  const save = ui.save;
  if (!save) return;
  if (!pkUnlocked(save)) {
    toast("先占领一座有名球场再来 PK。");
    return;
  }
  if (foeId === save.playerId) {
    toast("不能打自己的阵容。");
    return;
  }
  ensurePkDaily(save);
  if (pkRemaining(save) <= 0) {
    toast("今天挑战次数用完了。");
    return;
  }
  if (save.money < PK_STAKE) {
    toast(`挑战需要 ${PK_STAKE} 金币。`);
    return;
  }
  const ready = battleReady(save);
  if (ready.length < 3) {
    toast("需要 3 名能上场的首发。");
    return;
  }
  let foe: PkLineup | undefined;
  try {
    const list = pkCache.length ? pkCache : await listLineups();
    foe = list.find((x) => x.playerId === foeId);
  } catch (err) {
    toast(err instanceof Error ? err.message : "挑战名单暂时打不开。");
    return;
  }
  if (!foe) {
    toast("这支队伍不在了。");
    return;
  }
  save.money -= PK_STAKE;
  save.pkChallengesCount = (save.pkChallengesCount ?? 0) + 1;
  const foes = foe.team.map((m, i) => creatureFromPk(m, `pk${i}`));
  const result = simulateMatch(ready, foes, `PK · ${foe.trainerName}`);
  const beforeLv: Record<string, number> = {};
  for (const c of ready) beforeLv[c.uid] = c.level;
  applyMatchHp(save, result.remainingHp);
  if (result.won) {
    save.money += PK_WIN_GOLD;
    markPkBeaten(save, foeId);
  }
  for (const c of ready) {
    addExp(c, result.won ? 40 : 24);
    addFriendship(c, result.won ? 6 : 3);
    if (levelUpIfNeeded(c)) maybeLevelEvolve(save, c, { lines: [] });
  }
  try {
    await reportPkResult(save.playerId, foeId, result.won);
  } catch (err) {
    toast(err instanceof Error ? err.message : "战报同步失败。");
  }
  try {
    pkCache = await listLineups();
  } catch {
    if (!pkCache.length) pkCache = npcPkLineups();
  }
  const recapBits = [
    result.won ? `获胜 +${PK_WIN_GOLD} 金币` : isNpcPlayer(foeId) ? `失利，挑战费 ${PK_STAKE} 金币` : `失利，挑战费 ${PK_STAKE} 记到对方名下`,
    growthFatigueRecap(ready, beforeLv),
  ].filter(Boolean);
  pushJournal(save, "battle", `PK · ${foe.trainerName}`, [`比分 ${result.home}-${result.away}`, result.won ? "获胜" : "失利"]);
  ui.outTab = "pk";
  openBattle(`PK · ${foe.trainerName}`, result, "outing", ready, foes, recapBits.join("\n"));
  await commit();
}

export const BOX_CAP = BOX_LIMIT;
export const FRIENDSHIP_NEED = FRIENDSHIP_EVOLVE;
