import { CAREER_OCCUPY, CAREER_WINS, emptyCareer, type CareerTier, type DailyQuest, type DailyQuestId, type SaveData } from "./types";
import { occupiedCount } from "./courts";

export function todayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekKey(now: number): string {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function nextWeekAt(now = Date.now()): number {
  const key = weekKey(now);
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  let guard = 0;
  while (weekKey(d.getTime()) === key && guard < 10) {
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  return d.getTime();
}

export function formatWeekRemain(now = Date.now()): string {
  const ms = Math.max(0, nextWeekAt(now) - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${mins}分`;
  return `${Math.max(1, mins)}分钟`;
}

export const DAILY_QUEST_DEFS: { id: DailyQuestId; title: string }[] = [
  { id: "campaign", title: "完成一次征战" },
  { id: "hatch", title: "培养出一名新秀" },
  { id: "career", title: "打一场生涯赛" },
  { id: "recruit", title: "用招募券签人" },
  { id: "feed", title: "使用一次营养餐" },
];

export function dailyQuestTitle(id: DailyQuestId): string {
  return DAILY_QUEST_DEFS.find((d) => d.id === id)?.title ?? id;
}

function hashDay(key: string): number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function rollDailyQuests(dateKey: string): DailyQuest[] {
  const pool = [...DAILY_QUEST_DEFS];
  let h = hashDay(dateKey);
  const picked: DailyQuest[] = [];
  for (let i = 0; i < 3 && pool.length; i += 1) {
    const idx = h % pool.length;
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const [def] = pool.splice(idx, 1);
    picked.push({ id: def.id, done: false });
  }
  return picked;
}

export function ensureDailyQuests(save: SaveData, now = Date.now()): void {
  const key = todayKey(now);
  if (!save.dailyQuests) save.dailyQuests = [];
  if (save.dailyQuestClaimed == null) save.dailyQuestClaimed = false;
  if (save.dailyDate !== key || save.dailyQuests.length !== 3) {
    save.dailyDate = key;
    save.dailyClears = 0;
    save.dailyQuests = rollDailyQuests(key);
    save.dailyQuestClaimed = false;
  }
}

export function markDaily(save: SaveData, id: DailyQuestId, now = Date.now()): void {
  ensureDailyQuests(save, now);
  const q = save.dailyQuests.find((x) => x.id === id);
  if (q) q.done = true;
}

export function claimDailyBonus(save: SaveData, now = Date.now()): { ok: boolean; text: string } {
  ensureDailyQuests(save, now);
  if (save.dailyQuestClaimed) return { ok: false, text: "今天已经领过了。" };
  if (!save.dailyQuests.every((q) => q.done)) return { ok: false, text: "先把三件事做完。" };
  save.dailyQuestClaimed = true;
  save.money += 120;
  save.inventory["hp-pack"] = (save.inventory["hp-pack"] ?? 0) + 1;
  save.inventory["oran-berry"] = (save.inventory["oran-berry"] ?? 0) + 2;
  return { ok: true, text: "今日三件事完成：+120 金币、理疗包 ×1、能量棒 ×2" };
}

export function ensureCareerWeek(save: SaveData, now = Date.now()): void {
  if (!save.career) save.career = emptyCareer();
  const key = weekKey(now);
  if (save.career.weekKey !== key) {
    if (save.career.weekKey && save.career.unlocked && !save.career.playedThisWeek) {
      // missed week counts as a rest, not a forfeit loss
    }
    save.career.weekKey = key;
    save.career.playedThisWeek = false;
  }
}

export function nextCareerTier(current: CareerTier | null): CareerTier | null {
  if (!current) return "national";
  if (current === "national") return "pro";
  if (current === "pro") return "intl";
  return null;
}

export function careerHonorMet(save: SaveData, tier: CareerTier): boolean {
  return occupiedCount(save) >= CAREER_OCCUPY[tier];
}

export function careerReadyToPromote(save: SaveData): boolean {
  const c = save.career;
  if (!c?.unlocked || c.worldChampion) return false;
  return c.wins[c.unlocked] >= CAREER_WINS[c.unlocked];
}
