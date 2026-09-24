import { speciesById } from "./data";
import { rngFromSeed } from "./traits";
import { AWAKEN_LEVEL, MATURE_LEVEL, type Creature, type Position, type SkillType, type YouthClass } from "./types";

export const POSITION_LABEL: Record<Position, string> = {
  C: "中锋",
  F: "前锋",
  G: "后卫",
  PF: "大前锋",
  SF: "小前锋",
  SG: "得分后卫",
  PG: "组织后卫",
  SW: "摇摆人",
};

export const POSITION_COLOR: Record<Position, string> = {
  C: "#6b4f9a",
  F: "#3d8fd1",
  G: "#e06b2f",
  PF: "#5b7c3a",
  SF: "#3d8fd1",
  SG: "#d4a017",
  PG: "#e06b2f",
  SW: "#c44c4c",
};

export const STAGE_LABEL: Record<1 | 2 | 3, string> = {
  1: "青训",
  2: "成熟",
  3: "超觉醒",
};

export function positionSkills(pos: Position): SkillType[] {
  switch (pos) {
    case "C":
      return ["board", "lock", "body"];
    case "F":
      return ["slash", "body", "board"];
    case "G":
      return ["shot", "dish", "slash"];
    case "PF":
      return ["board", "body", "lock"];
    case "SF":
      return ["slash", "shot", "body"];
    case "SG":
      return ["shot", "slash"];
    case "PG":
      return ["dish", "slash", "shot"];
    case "SW":
      return ["shot", "slash", "body", "dish"];
  }
}

export function matureOptions(youth: YouthClass, dualRole = false): string {
  const extra = dualRole ? "，较高概率转为摇摆人" : "，小概率转为摇摆人";
  if (youth === "C") return "成熟后仍是中锋";
  if (youth === "F") return `成熟后成为大前锋或小前锋${extra}`;
  return `成熟后成为得分后卫或组织后卫${extra}`;
}

export function rollMaturePosition(c: Creature, rng: () => number = Math.random): Position {
  const youth = c.youthClass;
  if (youth === "C") return "C";
  const dual = speciesById(c.speciesId).dualRole;
  if (rng() < (dual ? 0.22 : 0.12)) return "SW";
  const base = speciesById(c.speciesId).stats;
  const v = (k: keyof Creature["ivs"]) => base[k] + c.ivs[k];
  if (youth === "F") {
    const paint = v("rebound") + v("block") + v("stamina");
    const wing = v("three") + v("mid") + v("run");
    return paint >= wing ? "PF" : "SF";
  }
  const pg = v("pass") + v("run");
  const sg = v("three") + v("mid");
  return pg >= sg ? "PG" : "SG";
}

export interface GrowthEvent {
  matured?: Position;
  awakened?: boolean;
}

export function syncGrowth(c: Creature): GrowthEvent {
  const ev: GrowthEvent = {};
  if (!c.youthClass) c.youthClass = speciesById(c.speciesId).youthClass;
  if (!c.position) c.position = c.youthClass;
  if (!c.stage) c.stage = 1;
  if (c.level >= MATURE_LEVEL && c.stage < 2) {
    c.stage = 2;
    const rng = rngFromSeed(`${c.uid}:mature:${c.speciesId}`);
    c.position = rollMaturePosition(c, rng);
    ev.matured = c.position;
  }
  if (c.level >= AWAKEN_LEVEL && c.stage < 3) {
    c.stage = 3;
    ev.awakened = true;
  }
  return ev;
}
