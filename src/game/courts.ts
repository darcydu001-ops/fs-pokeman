import { CITIES, COURTS, courtById } from "./data";
import { COURT_RENT_INTERVAL_MS, COURT_RENT_MAX_MS, type SaveData } from "./types";

export function occupiedCount(save: SaveData): number {
  return (save.occupiedCourts ?? []).length;
}

export function isOccupied(save: SaveData, courtId: string): boolean {
  return (save.occupiedCourts ?? []).includes(courtId);
}

export function cityUnlocked(save: SaveData, cityId: string): boolean {
  const city = CITIES.find((c) => c.id === cityId);
  if (!city) return false;
  if (!city.unlockAfter) return true;
  return isOccupied(save, city.unlockAfter);
}

export function namedCourts(): typeof COURTS {
  return COURTS.filter((c) => c.kind === "named");
}

export function nextNamedTarget(save: SaveData) {
  return COURTS.find((c) => c.kind === "named" && !isOccupied(save, c.id) && cityUnlocked(save, c.cityId));
}

export function courtRentPerTick(courtId: string): number {
  const court = courtById(courtId);
  if (!court || court.kind !== "named") return 0;
  return Math.max(4, Math.round(court.money * 0.08));
}

export function occupiedRentPerTick(save: SaveData): number {
  return (save.occupiedCourts ?? []).reduce((sum, id) => sum + courtRentPerTick(id), 0);
}

export function courtRentCap(save: SaveData): number {
  const per = occupiedRentPerTick(save);
  if (per <= 0) return 0;
  return per * Math.floor(COURT_RENT_MAX_MS / COURT_RENT_INTERVAL_MS);
}

export function courtRentFull(save: SaveData): boolean {
  const cap = courtRentCap(save);
  return cap > 0 && Math.floor(save.courtPayoutPending ?? 0) >= cap;
}

export function occupiedRentBreakdown(save: SaveData): { id: string; name: string; per: number }[] {
  return (save.occupiedCourts ?? []).map((id) => {
    const court = courtById(id);
    return { id, name: court?.name ?? id, per: courtRentPerTick(id) };
  }).filter((row) => row.per > 0);
}

export function accrueCourtRent(save: SaveData, now: number, scaledTime: number): void {
  if (save.courtPayoutPending == null) save.courtPayoutPending = 0;
  if (!save.lastCourtPayoutAt) save.lastCourtPayoutAt = save.lastSeenAt ?? now;
  const occ = (save.occupiedCourts ?? []).filter((id) => courtById(id)?.kind === "named");
  if (!occ.length) {
    save.lastCourtPayoutAt = scaledTime;
    save.courtPayoutPending = 0;
    return;
  }
  const cap = courtRentCap(save);
  save.courtPayoutPending = Math.min(Math.max(0, save.courtPayoutPending), cap);
  if (save.courtPayoutPending >= cap) {
    save.lastCourtPayoutAt = scaledTime;
    return;
  }
  const elapsed = Math.max(0, scaledTime - save.lastCourtPayoutAt);
  const ticks = Math.floor(elapsed / COURT_RENT_INTERVAL_MS);
  if (ticks <= 0) return;
  const per = occupiedRentPerTick(save);
  if (per <= 0) {
    save.lastCourtPayoutAt = scaledTime;
    return;
  }
  const room = cap - save.courtPayoutPending;
  const add = Math.min(ticks * per, room);
  save.courtPayoutPending += add;
  if (save.courtPayoutPending >= cap) save.lastCourtPayoutAt = scaledTime;
  else save.lastCourtPayoutAt += (add / per) * COURT_RENT_INTERVAL_MS;
}

export function collectCourtRent(save: SaveData): number {
  const n = Math.max(0, Math.floor(save.courtPayoutPending ?? 0));
  if (!n) return 0;
  save.courtPayoutPending = 0;
  save.money += n;
  return n;
}

export { courtById };
