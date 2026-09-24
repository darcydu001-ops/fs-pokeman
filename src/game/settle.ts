import { SPECIES, creatureLabel, courtById, eggHint, speciesById } from "./data";
import { ensureCareerWeek, ensureDailyQuests, markDaily } from "./daily";
import { accrueCourtRent, cityUnlocked, nextNamedTarget, occupiedCount } from "./courts";
import { clampHp, energyOf, makeAiCreature, maxHpOf } from "./combat";
import { POSITION_LABEL, syncGrowth } from "./positions";
import { simulateMatch, type SimResult } from "./sim";
import { canAddToBox, makeCreature, markDex, pushJournal, pushNotice, randomIvs, uid } from "./save";
import { addExp, addFriendship } from "./traits";
import {
  EGG_DURATION,
  HP_REGEN_INTERVAL_MS,
  NURSERY_LIMIT,
  OCCUPY_TO_UNLOCK,
  type Creature,
  type Egg,
  type SaveData,
  type Stats,
} from "./types";

export { todayKey } from "./daily";

export interface PendingBattle {
  title: string;
  result: SimResult;
  allies: Creature[];
  foes: Creature[];
  recap?: string;
}

export interface SettleLog {
  lines: string[];
  pendingBattle?: PendingBattle;
}

function scaledNow(save: SaveData, now: number): number {
  if (save.timeScale <= 1) return now;
  const elapsed = now - save.lastSeenAt;
  return save.lastSeenAt + elapsed * save.timeScale;
}

export function formatRemain(ms: number): string {
  if (ms <= 0) return "完成";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${m}分${sec}秒`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

export function effectiveRemain(endAt: number, save: SaveData, now: number): number {
  const t = save.timeScale > 1 ? scaledNow(save, now) : now;
  return endAt - t;
}

function tickCalendar(save: SaveData, now: number): void {
  ensureDailyQuests(save, now);
  ensureCareerWeek(save, now);
}

export function growthFatigueRecap(mine: Creature[], beforeLv: Record<string, number>): string {
  const grew = mine.filter((c) => c.level > (beforeLv[c.uid] ?? c.level));
  const down = mine.filter((c) => energyOf(c).down);
  const weak = mine.filter((c) => energyOf(c).weak);
  const bits: string[] = [];
  if (grew.length) bits.push(grew.map((c) => `${creatureLabel(c)}升到Lv.${c.level}`).join("、"));
  if (down.length) bits.push(`${down.map((c) => creatureLabel(c)).join("、")}体力见底，该休息了`);
  else if (weak.length) bits.push(`${weak.map((c) => creatureLabel(c)).join("、")}体力不足六成`);
  return bits.join("\n");
}

function hatchEggs(save: SaveData, now: number, log: SettleLog): void {
  const t = scaledNow(save, now);
  let boxFullNoted = false;
  for (const slot of save.incubators) {
    const egg = slot.egg;
    if (!egg) continue;
    if (t < egg.startAt + egg.durationMs) continue;
    if (!canAddToBox(save)) {
      if (!boxFullNoted) {
        log.lines.push("球员名单已满，出道先等一等。");
        boxFullNoted = true;
      }
      continue;
    }
    const baby = makeCreature(egg.speciesId, egg.kind === "mystery" ? 5 : 1, {
      ivs: mergeIvs(egg.inheritedIvs),
      nature: egg.inheritedNature,
      moves: egg.inheritedMoves,
      friendship: egg.kind === "mystery" ? 90 : 80,
      ...(egg.inheritedTraits !== undefined ? { traits: egg.inheritedTraits } : {}),
    }, save.box);
    save.box.push(baby);
    markDex(save, baby.speciesId, true);
    slot.egg = null;
    const autoParty = save.party.length === 0;
    slot.lastHatch = { speciesId: baby.speciesId, shiny: baby.shiny, at: now, code: baby.code };
    const extras: string[] = ["已加入球员名单。"];
    if (autoParty) {
      save.party = [baby.uid];
      extras.push("首发还空着，已自动编入第 1 位。");
    }
    if (!save.pendingHatches) save.pendingHatches = [];
    pushNotice(save, {
      kind: "debut",
      title: "培养完成 · 出道",
      lines: extras,
      uid: baby.uid,
      speciesId: baby.speciesId,
      code: baby.code,
      shiny: baby.shiny,
      gender: baby.gender,
      autoParty,
      traits: baby.traits,
      position: baby.position,
    });
    const line = `${creatureLabel(baby)} 出道了！${baby.shiny ? "（星光）" : ""}`;
    log.lines.push(`${creatureLabel(baby)} 出道了。`);
    pushJournal(save, "hatch", "出道", [line, ...extras]);
    markDaily(save, "hatch", now);
  }
}

function mergeIvs(partial?: Partial<Stats>): Stats {
  const base = randomIvs();
  if (!partial) return base;
  return { ...base, ...partial };
}

export function applyMatchHp(save: SaveData, remaining: Record<string, number>): void {
  let touched = false;
  for (const c of save.box) {
    if (remaining[c.uid] == null) continue;
    c.hp = remaining[c.uid];
    clampHp(c);
    touched = true;
  }
  if (touched) save.lastHpRegenAt = Date.now();
}

function finishCampaign(save: SaveData, now: number, log: SettleLog): void {
  const ex = save.exploration;
  if (!ex) return;
  if (now < ex.startAt + ex.durationMs) return;
  const court = courtById(ex.locationId);
  const mine = ex.creatureUids.map((id) => save.box.find((x) => x.uid === id)).filter((c): c is Creature => !!c);
  const foes = (court?.team ?? []).map((m, i) => makeAiCreature(m.speciesId, m.level, `foe${i}`, m.name));
  if (!mine.length || !foes.length) {
    save.exploration = null;
    log.lines.push("征战无法结算，队伍已经解散。");
    return;
  }
  const result = simulateMatch(mine, foes, court?.name ?? "球场");
  const beforeLv: Record<string, number> = {};
  for (const c of mine) beforeLv[c.uid] = c.level;
  applyMatchHp(save, result.remainingHp);
  const report: string[] = [];
  report.push(`球场：${court?.name ?? ex.locationId}`);
  report.push(`派出：${mine.map((c) => creatureLabel(c)).join("、") || "无"}`);
  report.push(`比分 ${result.home}-${result.away}`);

  for (const c of mine) {
    const gained = Math.round((court?.exp ?? 20) * (result.won ? 1.25 : 1));
    addExp(c, gained);
    addFriendship(c, result.won ? 8 : 5);
    const grew = levelUpIfNeeded(c);
    if (grew) maybeLevelEvolve(save, c, log);
  }

  const recapBits: string[] = [];
  const held = court?.kind === "named" && (save.occupiedCourts ?? []).includes(court.id);
  if (result.won) {
    const money = held ? Math.round((court?.money ?? 40) * 0.55) : court?.money ?? 40;
    save.money += money;
    if (held) {
      report.push(`获胜，刷到 ${money} 金币和经验。球场已永久占领。`);
      save.inventory["oran-berry"] = (save.inventory["oran-berry"] ?? 0) + 1;
      report.push("额外获得能量棒 ×1。");
      recapBits.push(`${court?.name ?? "球场"}已占领，刷资源并收租`);
    } else {
      report.push(`获胜，获得 ${money} 金币。`);
    }
    if (court?.kind === "named" && !held) {
      save.occupiedCourts = [...(save.occupiedCourts ?? []), court.id];
      report.push(`永久占领了${court.name}！之后收租，再来只刷金币、材料和经验。`);
      recapBits.push(`永久占领了${court.name}，之后收租`);
      if (occupiedCount(save) >= OCCUPY_TO_UNLOCK && !save.career.unlocked) {
        save.career.unlocked = "national";
        report.push("全国大赛已解锁。去职业生涯报名吧。");
        recapBits.push("全国大赛已解锁");
        log.lines.push("全国大赛解锁了。");
        pushNotice(save, {
          kind: "career",
          title: "生涯晋级",
          lines: ["占领球场达标，全国大赛已经解锁。", "去比赛 → 生涯报名吧。"],
        });
      }
    }
  } else {
    const consolation = Math.round((court?.money ?? 40) * 0.3);
    save.money += consolation;
    if (held) report.push("惜败。球场仍归你所有，球员拿到了经验。");
    else if (court?.kind === "named") {
      report.push("惜败，未能占领。可以再派人来打。");
      recapBits.push(`未能占领${court.name}`);
    } else report.push("惜败。野场不能占领，可以再派人来挖人。");
    report.push(`出场费 ${consolation} 金币照付。`);
  }

  if (court?.kind === "wild") {
    recapBits.push("野场不能占领，用来挖人");
    const tickets = save.inventory["recruit-ticket"] ?? 0;
    if (tickets < 1) {
      report.push("没有招募券，错过了野场新人。");
      recapBits.push("没有招募券");
    } else if (!canAddToBox(save)) {
      report.push("球员名单已满，无法加盟。");
      recapBits.push("名单已满，没法加盟");
    } else {
      save.inventory["recruit-ticket"] = tickets - 1;
      const rate = result.won ? 0.55 : 0.28;
      const sid = court.recruitPool[Math.floor(Math.random() * court.recruitPool.length)];
      if (Math.random() < rate) {
        const baby = makeCreature(sid, Math.max(3, (court.level ?? 8) - 4), undefined, save.box);
        save.box.push(baby);
        markDex(save, sid, true);
        report.push(`消耗招募券 ×1，${creatureLabel(baby)} 加盟！`);
        recapBits.push(`${creatureLabel(baby)} 加盟`);
        pushNotice(save, {
          kind: "recruit",
          title: "野场加盟",
          lines: [`从${court.name}带回了新球员。`, baby.shiny ? "还是星光！" : "已加入球员名单。"],
          uid: baby.uid,
          speciesId: baby.speciesId,
          code: baby.code,
          shiny: baby.shiny,
          gender: baby.gender,
          traits: baby.traits,
          position: baby.position,
        });
        markDaily(save, "recruit", now);
      } else {
        report.push(`消耗招募券 ×1，${speciesById(sid).name} 拒绝了加盟。`);
        recapBits.push(`${speciesById(sid).name} 拒绝加盟`);
      }
    }
  }

  save.exploration = null;
  if (!save.reports) save.reports = [];
  save.reports.unshift({ id: uid("rp"), at: now, title: court?.name ?? "征战", win: result.won, log: result.log });
  save.reports = save.reports.slice(0, 20);
  pushJournal(save, "explore", `${court?.name ?? "征战"}战报`, report);
  log.lines.push(`${court?.name ?? "征战"}开战。`);
  const fatigue = growthFatigueRecap(mine, beforeLv);
  if (fatigue) recapBits.push(fatigue);
  const next = nextNamedTarget(save);
  if (next) recapBits.push(`下一座可占：${next.name}`);
  log.pendingBattle = {
    title: court?.name ?? "征战",
    result,
    allies: mine,
    foes,
    recap: recapBits.filter(Boolean).join("\n"),
  };
  markDaily(save, "campaign", now);
}

export function makeEgg(speciesId: number, kind: Egg["kind"], extra?: Partial<Egg>): Egg {
  return {
    uid: extra?.uid ?? uid("egg"),
    speciesId,
    kind,
    startAt: extra?.startAt ?? Date.now(),
    durationMs: extra?.durationMs ?? EGG_DURATION[kind],
    fromParents: extra?.fromParents,
    inheritedIvs: extra?.inheritedIvs,
    inheritedNature: extra?.inheritedNature,
    inheritedMoves: extra?.inheritedMoves,
    inheritedTraits: extra?.inheritedTraits,
  };
}

export function levelUpIfNeeded(c: Creature): boolean {
  let grew = false;
  while (c.exp >= expToNext(c.level)) {
    const beforeMax = maxHpOf(c);
    c.exp -= expToNext(c.level);
    c.level += 1;
    grew = true;
    c.moves = mergeMoves(c);
    addFriendship(c, 2);
    const afterMax = maxHpOf(c);
    c.hp = Math.min(afterMax, (typeof c.hp === "number" ? c.hp : beforeMax) + Math.max(0, afterMax - beforeMax));
  }
  return grew;
}

function mergeMoves(c: Creature): string[] {
  const learned = speciesById(c.speciesId).learnset.filter((m) => m.level <= c.level).map((m) => m.moveId);
  const set = [...new Set([...c.moves, ...learned])];
  return set.slice(-4);
}

export function expToNext(level: number): number {
  return Math.round(8 + level * 5);
}

function restoreHp(save: SaveData, now: number, log: SettleLog): void {
  if (!save.lastHpRegenAt) save.lastHpRegenAt = save.lastSeenAt;
  const t = scaledNow(save, now);
  const elapsed = t - save.lastHpRegenAt;
  if (elapsed < HP_REGEN_INTERVAL_MS) return;
  const ticks = Math.floor(elapsed / HP_REGEN_INTERVAL_MS);
  save.lastHpRegenAt += ticks * HP_REGEN_INTERVAL_MS;
  const healed: string[] = [];
  for (const c of save.box) {
    if (save.exploration?.creatureUids.includes(c.uid)) continue;
    clampHp(c);
    const max = maxHpOf(c);
    if (c.hp >= max) continue;
    const add = Math.max(2, Math.floor(max / 5)) * ticks;
    const before = c.hp;
    c.hp = Math.min(max, c.hp + add);
    if (c.hp > before) healed.push(`${creatureLabel(c)} ${before}→${c.hp}/${max}`);
  }
  if (healed.length) {
    log.lines.push("球员在家休息，体力有所恢复。");
    pushJournal(save, "heal", "自然恢复", healed);
  }
}

function finishBreeding(save: SaveData, now: number, log: SettleLog): void {
  const job = save.breeding;
  if (!job) return;
  if (!save.nursery) save.nursery = [];
  const t = scaledNow(save, now);
  if (t < job.startAt + job.durationMs) return;
  if (save.nursery.length >= NURSERY_LIMIT) return;
  save.nursery.push(job.egg);
  save.breeding = null;
  pushJournal(save, "breed", "带教完成", [`带出了${eggHint(job.egg.speciesId)}。`, "请到培养中心送进青训营。"]);
  log.lines.push("带教完成，一名青训种子已送到培养中心。");
}

function maybeLevelEvolve(save: SaveData, c: Creature, log: SettleLog): void {
  const from = creatureLabel(c);
  const ev = syncGrowth(c);
  c.moves = mergeMoves(c);
  clampHp(c);
  if (ev.matured) {
    const line = ev.matured === "SW"
      ? `${from} 特殊转为摇摆人！`
      : `${from} 成熟为${POSITION_LABEL[ev.matured]}！`;
    log.lines.push(line);
    pushJournal(save, "raise", "成熟", [line]);
    pushNotice(save, {
      kind: "promote",
      title: "职业成熟",
      lines: [line, "位置已经定型，超觉醒还要再练到 Lv.32。"],
      uid: c.uid,
      speciesId: c.speciesId,
      code: c.code,
      shiny: c.shiny,
      gender: c.gender,
      traits: c.traits,
      position: c.position,
    });
  }
  if (ev.awakened) {
    const line = `${from} 超觉醒了！`;
    log.lines.push(line);
    pushJournal(save, "raise", "超觉醒", [line]);
    pushNotice(save, {
      kind: "awaken",
      title: "超觉醒",
      lines: [line, "能力全面拔高，职业不变。"],
      uid: c.uid,
      speciesId: c.speciesId,
      code: c.code,
      shiny: c.shiny,
      gender: c.gender,
      traits: c.traits,
      position: c.position,
    });
  }
}

export { maybeLevelEvolve };

export function settle(save: SaveData, now = Date.now()): SettleLog {
  const log: SettleLog = { lines: [] };
  tickCalendar(save, now);
  accrueCourtRent(save, now, scaledNow(save, now));
  restoreHp(save, now, log);
  hatchEggs(save, now, log);
  finishBreeding(save, now, log);
  finishCampaign(save, now, log);
  save.lastSeenAt = now;
  return log;
}

export function dexTotal(): number {
  return Object.keys(SPECIES).length;
}

export function needsIdleTick(save: SaveData): boolean {
  if (save.incubators.some((s) => !!s.egg)) return true;
  if (save.exploration || save.breeding) return true;
  for (const c of save.box ?? []) {
    if ((typeof c.hp === "number" ? c.hp : maxHpOf(c)) < maxHpOf(c)) return true;
  }
  return false;
}

export function isCityOpen(save: SaveData, cityId: string): boolean {
  return cityUnlocked(save, cityId);
}
