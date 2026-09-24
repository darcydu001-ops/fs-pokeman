import {
  beginPartyEdit,
  buyShop,
  cancelPartyEdit,
  challengePk,
  clearLastHatch,
  createTrainer,
  dismissHatchReveal,
  feed,
  healBattleSquad,
  healPartyStarters,
  mergeThree,
  battleReady,
  partyCreatures,
  pkCache,
  placeNurseryEgg,
  releaseCreature,
  renameCreature,
  renameTrainer,
  replaceSave,
  resetGame,
  runCareer,
  sellItem,
  setModal,
  setOutTab,
  setHatchTab,
  setPartyMember,
  setScreen,
  setTimeScale,
  skipBattlePlayback,
  skipMinutes,
  startBreed,
  startCampaign,
  toggleParty,
  trainStat,
  ui,
  upgradeIncubator,
  uploadPkTeam,
  toast,
  flushGymPayout,
} from "../game/actions";
import { CAREER_LABEL, CAREER_TEAM, CITIES, COURTS, ITEMS, MOVES, NATURES, SHOP, creatureLabel, natureEffectText, sellPrice, speciesById, allSpecies, teamNames } from "../game/data";
import { matureOptions, POSITION_COLOR, POSITION_LABEL, STAGE_LABEL } from "../game/positions";
import { computedStats, energyOf, maxHpOf } from "../game/combat";
import { cityUnlocked, courtRentFull, isOccupied, nextNamedTarget, occupiedCount, occupiedRentBreakdown, occupiedRentPerTick } from "../game/courts";
import { effectivePower, formatPower, partyAvgOvr, powerBreakdown, rosterPower, teamEffectivePower } from "../game/power";
import { careerReadyToPromote, formatWeekRemain, nextCareerTier } from "../game/daily";
import { PK_BOSS_ID, pkCloudReady, pkRemaining, pkStake, pkUnlocked, pkWinGold, sortPkOpponents } from "../game/pk";
import { downloadText, exportSaveJson, findCreature, parseSaveJson } from "../game/save";
import { dexTotal, effectiveRemain, formatRemain } from "../game/settle";
import { bgmEnabled, setBgmEnabled, toggleBgm } from "../game/audio";
import { TRAITS, TRAIT_GRADE, hasEpicTrait, sanitizeTraits } from "../game/traits";
import { BOX_LIMIT, CAREER_OCCUPY, CAREER_OVR, CAREER_WINS as WINS, GENDER_LABEL, INCUBATOR_MAX, STAT_KEYS, STAT_LABEL, incubatorUpgradeCost, trainCap, trainCost, trainedOf, type Creature, type HatchTab, type OutTab, type Position, type SaveData, type Screen, type StatKey, type YouthClass } from "../game/types";

let campaignPick: string[] = [];
let pendingCourt = "alley-main";
let coachMentor: string | null = null;
let coachAide: string | null = null;
let trainPick: string | null = null;
let dexFilter: "all" | YouthClass = "all";
let rosterFilter: "all" | YouthClass | "down" = "all";
let bagHealItem: string | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function traitChips(ids: string[] | undefined): string {
  const list = sanitizeTraits(ids);
  if (!list.length) return "";
  return `<div class="tags traits">${list.map((id) => {
    const t = TRAITS[id];
    if (!t) return "";
    return `<span class="trait ${t.rarity}" title="${TRAIT_GRADE[t.rarity]} · ${esc(t.desc)}"><i class="trait-grade">${TRAIT_GRADE[t.rarity]}</i>${esc(t.name)}</span>`;
  }).join("")}</div>`;
}

function posTag(pos: Position): string {
  return `<span class="tag" style="background:${POSITION_COLOR[pos]}">${POSITION_LABEL[pos]} ${pos}</span>`;
}

function avatar(speciesId: number, shiny = false, pos?: Position): string {
  const sp = speciesById(speciesId);
  const p = pos ?? sp.youthClass;
  const c1 = POSITION_COLOR[p];
  const letter = esc(sp.name.slice(0, 1));
  return `<div class="avatar ${shiny ? "shiny" : ""}">
    <img class="avatar-px" src="${import.meta.env.BASE_URL}portraits/${speciesId}.png" alt="" draggable="false" onerror="this.parentElement.classList.add('fallback');this.remove()" />
    <span class="avatar-fallback" style="background:linear-gradient(135deg,${c1},${c1})">${letter}</span>
  </div>`;
}

function hpBar(c: Creature, withText = false): string {
  const max = maxHpOf(c);
  const hp = Math.max(0, Math.min(typeof c.hp === "number" ? c.hp : max, max));
  const pct = max <= 0 ? 0 : Math.round((hp / max) * 100);
  const color = pct <= 20 ? "#c03028" : pct <= 50 ? "#e6b325" : "var(--ok)";
  return `<div class="hp" title="体力 ${hp}/${max}"><span style="width:${pct}%;background:${color}"></span></div>${
    withText ? `<div class="muted">体力 ${hp}/${max}${hp <= 0 ? " · 无法上场" : ""}</div>` : ""
  }`;
}

function monLine(c: Creature): string {
  const away = !!ui.save?.exploration?.creatureUids.includes(c.uid);
  return `Lv.${c.level} · ${POSITION_LABEL[c.position]} · ${formatPower(effectivePower(c))}${away ? " · 征战中" : ""}`;
}

function monBtn(c: Creature, extra = "", mode: "open" | "pick" | "assign" = "open"): string {
  const attr = mode === "pick" ? `data-pick="${c.uid}"` : mode === "assign" ? `data-assign="${c.uid}"` : `data-open="${c.uid}"`;
  const e = energyOf(c);
  const state = e.down ? " down" : e.weak ? " tired" : "";
  return `<button class="mon ${extra}${state}" ${attr}>
    ${avatar(c.speciesId, c.shiny, c.position)}
    <div class="mon-body">
      <strong class="mon-name">${esc(creatureLabel(c))}${hasEpicTrait(c) ? `<span class="trait-gold-dot" title="极品词条">◆</span>` : ""}</strong>
      <span class="muted mon-meta">${monLine(c)}</span>
    </div>
  </button>`;
}

function starterBtn(c: Creature): string {
  const e = energyOf(c);
  const state = e.down ? " down" : e.weak ? " tired" : "";
  return `<button class="mon starter-card${state}" data-open="${c.uid}">
    ${avatar(c.speciesId, c.shiny, c.position)}
    <div class="mon-body">
      <strong class="mon-name">${esc(creatureLabel(c))}${hasEpicTrait(c) ? `<span class="trait-gold-dot" title="极品词条">◆</span>` : ""}</strong>
      <span class="muted mon-meta">${monLine(c)}</span>
      ${hpBar(c, e.down)}
    </div>
  </button>`;
}

function navKey(screen: Screen): string {
  if (screen === "home" || screen === "creature" || screen === "box") return "home";
  if (screen === "outing" || screen === "battle" || screen === "adventure" || screen === "gyms") return "outing";
  if (screen === "hatch") return "hatch";
  if (screen === "bag" || screen === "warehouse" || screen === "shop") return "bag";
  return "more";
}

function nav(active: Screen): string {
  const current = navKey(active);
  const items = [
    ["home", "首页"],
    ["outing", "比赛"],
    ["hatch", "培养"],
    ["bag", "背包"],
    ["more", "更多"],
  ] as const;
  return `<nav class="nav">${items.map(([id, label]) => `<button data-nav="${id}" class="${current === id ? "active" : ""}">${label}</button>`).join("")}</nav>`;
}

type Frame = { head?: string; body: string; dock?: string };

function deviceChrome(frame: Frame, extras = ""): string {
  return `<div class="desk">
    <div class="gbc">
      <div class="gbc-brand">FS宝可梦之征战全国大赛</div>
      <div class="gbc-screen-wrap">
        <div class="gbc-led" aria-hidden="true"><i></i>BATTERY</div>
        <button type="button" class="gbc-note ${bgmEnabled() ? "on" : "off"}" data-act="bgm-toggle" title="音乐开关" aria-label="${bgmEnabled() ? "关闭音乐" : "打开音乐"}"><span>♪</span></button>
        <div class="gbc-lcd">
          <div class="gbc-scan" aria-hidden="true"></div>
          <div class="gbc-lcd-body">
            ${frame.head ? `<div class="lcd-head">${frame.head}</div>` : ""}
            <div class="shell">${frame.body}</div>
            ${frame.dock ?? ""}
            ${ui.save ? nav(ui.screen) : ""}
          </div>
          ${extras}
        </div>
      </div>
      <div class="gbc-deck" aria-hidden="true">
        <div class="gbc-dpad"><span class="v"></span><span class="h"></span><span class="c"></span></div>
        <div class="gbc-ab"><span class="b">B</span><span class="a">A</span></div>
      </div>
      <div class="gbc-seams" aria-hidden="true"><span><i></i>SELECT</span><span><i></i>START</span></div>
      <div class="gbc-speaker" aria-hidden="true"></div>
    </div>
  </div>`;
}

function outTabs(): string {
  return `<div class="tabs-bar"><div class="row tabs">
    <button class="btn ${ui.outTab === "campaign" ? "red" : "ghost"}" data-out="campaign">征战</button>
    <button class="btn ${ui.outTab === "career" ? "red" : "ghost"}" data-out="career">生涯</button>
    <button class="btn ${ui.outTab === "pk" ? "red" : "ghost"}" data-out="pk">PK</button>
  </div></div>`;
}

function hatchTabs(): string {
  return `<div class="tabs-bar"><div class="row tabs">
    <button class="btn ${ui.hatchTab === "youth" ? "red" : "ghost"}" data-hatch="youth">青训</button>
    <button class="btn ${ui.hatchTab === "coach" ? "red" : "ghost"}" data-hatch="coach">带教</button>
    <button class="btn ${ui.hatchTab === "gym" ? "red" : "ghost"}" data-hatch="gym">训练房</button>
  </div></div>`;
}

function toasts(): string {
  return `<div class="toasts">${ui.toast.map((t) => `<div class="toast">${esc(t)}</div>`).join("")}</div>`;
}

function flashNote(): string {
  if (!ui.flash) return "";
  return `<div class="flash-overlay"><div class="flash">${ui.flash.split("\n").map((l) => `<div>${esc(l)}</div>`).join("")}</div></div>`;
}

function top(save: SaveData): string {
  const pending = Math.max(0, Math.floor(save.courtPayoutPending ?? 0));
  const rentTick = occupiedRentPerTick(save);
  const rentPill = pending > 0
    ? `<button type="button" class="pill rent" data-act="collect-rent">待领 ${pending}${courtRentFull(save) ? " 已满" : ""}</button>`
    : rentTick
      ? `<div class="pill">租金 +${rentTick}/3分</div>`
      : "";
  return `<div class="topbar">
    <div class="brand"><img class="brand-logo" src="${import.meta.env.BASE_URL}brand-logo.png" alt="街头篮球" /><div>FS队长<div class="muted">${esc(save.trainerName)}</div></div></div>
    <div class="stats-pill">
      <div class="pill">金币 ${save.money}</div>
      ${rentPill}
      <div class="pill">球员 ${save.box.length}/${BOX_LIMIT}</div>
    </div>
  </div>`;
}

function onboard(): Frame {
  return {
    body: `<div class="card stack">
      <h2>FS宝可梦之征战全国大赛</h2>
      <p class="muted">开训即获中锋、前锋、后卫各一名，并带上金币和理疗包。先去巷口球场打一场。存档只在这台浏览器里。</p>
      <input id="name" type="text" maxlength="12" placeholder="队长名字" value="${esc(ui.onboardName)}" />
      <button class="btn red" data-act="create">开训</button>
    </div>`,
  };
}

function goalAttrs(goal: { nav?: Screen; out?: OutTab; hatch?: HatchTab; court?: string; act?: string }): string {
  return [
    goal.act ? `data-act="${goal.act}"` : "",
    goal.nav ? `data-nav="${goal.nav}"` : "",
    goal.out ? `data-out="${goal.out}"` : "",
    goal.hatch ? `data-hatch="${goal.hatch}"` : "",
    goal.court ? `data-court="${goal.court}"` : "",
  ].filter(Boolean).join(" ");
}

function nextGoal(save: SaveData): { text: string; cta: string; nav?: Screen; out?: OutTab; hatch?: HatchTab; court?: string; act?: string } {
  const party = partyCreatures(save);
  const wiped = party.filter((c) => energyOf(c).down);
  if (wiped.length) {
    const packs = (save.inventory["hp-pack"] ?? 0) + (save.inventory["oran-berry"] ?? 0);
    const names = wiped.map((c) => creatureLabel(c)).join("、");
    if (packs > 0) {
      return { text: `${names} 体力见底。给首发恢复，或去比赛换替补。`, cta: "给首发恢复", act: "heal-party" };
    }
    return { text: `${names} 体力见底。换替补，或去背包买理疗包。`, cta: "去背包", nav: "bag" };
  }
  const occ = occupiedCount(save);
  const nextNamed = nextNamedTarget(save);
  if (occ === 0) {
    return { text: "先去巷口球场打一场。赢了就能永久占领，不用再占第二次。", cta: "去巷口球场", out: "campaign", court: "alley-main" };
  }
  if (save.career?.worldChampion) {
    if (!save.career.playedThisWeek) {
      return { text: "本周卫冕赛还没打。", cta: "去打卫冕", out: "career" };
    }
  } else if (!save.career?.unlocked) {
    const ready = battleReady(save);
    const avg = partyAvgOvr(ready.length ? ready : party);
    if (occ === 1 && avg < 380) {
      return {
        text: "码头还早。先去巷口野场练人，或去训练房加练，也可以 PK 打芳芳。",
        cta: "去打巷口野场",
        out: "campaign",
        court: "alley-wild",
      };
    }
    const need = Math.max(0, CAREER_OCCUPY.national - occ);
    return {
      text: `再占 ${need} 座有名球场，解锁全国大赛。${nextNamed ? `下一座：${nextNamed.name}。` : ""}`,
      cta: nextNamed ? `去打${nextNamed.name}` : "去占场",
      out: "campaign",
      court: nextNamed?.id,
    };
  } else {
    const ready = battleReady(save);
    const avg = partyAvgOvr(ready.length ? ready : party);
    const tier = save.career.unlocked;
    if (careerReadyToPromote(save)) {
      const next = nextCareerTier(tier);
      if (next) {
        if (occ < CAREER_OCCUPY[next]) {
          return {
            text: `${CAREER_LABEL[tier]}冠军已到手。再占 ${CAREER_OCCUPY[next] - occ} 座有名球场进${CAREER_LABEL[next]}。`,
            cta: "去占场",
            out: "campaign",
            court: nextNamed?.id,
          };
        }
        if (avg < CAREER_OVR[next]) {
          return {
            text: `首发综合能力 ${avg} / ${CAREER_OVR[next]}，还差 ${CAREER_OVR[next] - avg} 才能进${CAREER_LABEL[next]}。去征战升级或训练房加练。`,
            cta: "去训练房",
            hatch: "gym",
          };
        }
        return { text: `可以晋级${CAREER_LABEL[next]}了。打一场生涯赛就会升档。`, cta: "去打生涯", out: "career" };
      }
    }
    if (avg < CAREER_OVR[tier]) {
      return {
        text: `首发综合能力 ${avg} / ${CAREER_OVR[tier]}，还差 ${CAREER_OVR[tier] - avg} 才能打${CAREER_LABEL[tier]}。去征战升级或训练房加练。`,
        cta: "去训练房",
        hatch: "gym",
      };
    }
    if (!save.career.playedThisWeek) {
      return { text: `本周${CAREER_LABEL[tier]}还没打。`, cta: "去打生涯", out: "career" };
    }
  }
  if (nextNamed) {
    return { text: `下一座可占：${nextNamed.name}。`, cta: `去打${nextNamed.name}`, out: "campaign", court: nextNamed.id };
  }
  const lockedCity = CITIES.find((c) => !cityUnlocked(save, c.id));
  if (lockedCity) {
    return { text: `先占上一座有名球场，解锁${lockedCity.name}。`, cta: "去征战", out: "campaign" };
  }
  return { text: "继续征战养人，刷资源和挖人。", cta: "去比赛", out: "campaign" };
}

function sortRoster(list: Creature[]): Creature[] {
  return [...list].sort((a, b) => effectivePower(b) - effectivePower(a) || b.level - a.level);
}

function filterRoster(list: Creature[]): Creature[] {
  const sorted = sortRoster(list);
  if (rosterFilter === "all") return sorted;
  if (rosterFilter === "down") return sorted.filter((c) => energyOf(c).down);
  return sorted.filter((c) => c.youthClass === rosterFilter);
}

function rosterFilters(): string {
  const opts: [typeof rosterFilter, string][] = [
    ["all", "全部"],
    ["C", "中锋"],
    ["F", "前锋"],
    ["G", "后卫"],
    ["down", "见底"],
  ];
  return `<div class="row roster-filters">${opts.map(([id, label]) =>
    `<button type="button" class="btn small ${rosterFilter === id ? "red" : "ghost"}" data-roster-filter="${id}">${label}</button>`).join("")}</div>`;
}

function home(save: SaveData): Frame {
  const party = [0, 1, 2].map((i) => {
    const c = partyCreatures(save)[i];
    if (ui.partySlot === i) {
      const cands = filterRoster(save.box.filter((x) => !save.party.includes(x.uid) && !save.exploration?.creatureUids.includes(x.uid) && !save.breeding?.parentUids.includes(x.uid)));
      return `<div class="slot-card picking"><div class="muted">点下面的人换上第 ${i + 1} 位</div>${rosterFilters()}
        ${cands.map((x) => monBtn(x, "", "assign")).join("") || `<p class="muted">没有可换的人。</p>`}</div>`;
    }
    if (!c) return `<button class="slot-card slot-empty-btn" data-slot="${i}"><div class="avatar" style="background:#cfc6b6">+</div>空位</button>`;
    return `<div class="slot-card">${starterBtn(c)}<button class="btn ghost small" data-slot="${i}">更换</button></div>`;
  });
  const career = save.career?.worldChampion
    ? "世界冠军"
    : save.career?.unlocked
      ? `${CAREER_LABEL[save.career.unlocked]} ${save.career.wins[save.career.unlocked]}/${WINS[save.career.unlocked]}`
      : occupiedCount(save) >= CAREER_OCCUPY.national
        ? "可报名全国大赛"
        : `再占 ${Math.max(0, CAREER_OCCUPY.national - occupiedCount(save))} 座球场解锁生涯`;
  const trip = save.exploration
    ? `<p class="power-line">征战中：${esc(COURTS.find((c) => c.id === save.exploration?.locationId)?.name ?? "")} · ${formatRemain(Math.max(0, save.exploration.startAt + save.exploration.durationMs - Date.now()))}</p>`
    : "";
  const bench = filterRoster(save.box.filter((c) => !save.party.includes(c.uid)));
  const rentTick = occupiedRentPerTick(save);
  const picking = ui.partySlot;
  const goal = nextGoal(save);
  const rentRows = occupiedRentBreakdown(save);
  const pending = Math.max(0, Math.floor(save.courtPayoutPending ?? 0));
  const occupiedNames = rentRows.map((row) => `${row.name} +${row.per}/3分`).join(" · ") || "还没有占领球场";
  const rentLine = rentTick
    ? `约每 3 分钟 +${rentTick} 金币，最多囤 8 小时${pending ? ` · 待领 ${pending}${courtRentFull(save) ? " 已满" : ""}` : ""}`
    : "占领有名球场后会收租";
  return {
    head: top(save),
    body: `<div class="stack">
    <div class="card goal-card">
      <h2>下一步</h2>
      <p class="power-line">${esc(goal.text)}</p>
    </div>
    ${trip}
    <div class="card stack"><h2>首发</h2><div class="grid grid-3">${party.join("")}</div></div>
    <div class="card"><h2>已占球场 ${occupiedCount(save)}</h2>
      <p class="muted">${esc(career)} · ${esc(rentLine)} · ${esc(occupiedNames)}</p>
    </div>
    <div class="card stack">
      <h2>替补 ${save.box.filter((c) => !save.party.includes(c.uid)).length}/${BOX_LIMIT}</h2>
      ${rosterFilters()}
      <div class="grid grid-list">${bench.map((c) => monBtn(c)).join("") || `<p class="muted">没有替补。</p>`}</div>
    </div>
    </div>`,
    dock: picking !== null
      ? `<div class="dock"><div class="dock-meta">更换第 ${picking + 1} 位</div><button class="btn ghost" data-act="cancel-party">取消</button></div>`
      : trip
        ? `<div class="dock"><div class="dock-meta">征战进行中</div><button class="btn red" data-nav="outing">去比赛</button></div>`
        : `<div class="dock"><div class="dock-meta">下一步</div><button class="btn red" ${goalAttrs(goal)}>${esc(goal.cta)}</button></div>`,
  };
}

function campaignPanel(save: SaveData): string {
  const now = Date.now();
  const idle = save.box.filter((c) => !save.exploration?.creatureUids.includes(c.uid) && !save.breeding?.parentUids.includes(c.uid));
  const trip = save.exploration;
  if (!trip && campaignPick.length === 0) {
    const starters = save.party.filter((id) => idle.some((c) => c.uid === id));
    campaignPick = (starters.length >= 3 ? starters : idle.map((c) => c.uid)).slice(0, 3);
  }
  const tiredPicked = idle.filter((c) => campaignPick.includes(c.uid) && energyOf(c).weak);
  const downPicked = idle.filter((c) => campaignPick.includes(c.uid) && energyOf(c).down);
  const sent = campaignPick.map((id) => findCreature(save, id)).filter((c): c is Creature => !!c);
  const myPower = sent.length === 3 ? teamEffectivePower(sent) : teamEffectivePower(partyCreatures(save));
  const powerLabel = sent.length === 3 ? "派出" : "首发";
  const shown = filterRoster(idle);
  return `<div class="card stack">
    <div class="row" style="justify-content:space-between">
      <h2>征战城市</h2>
      <button class="btn small ghost" data-modal="explore">记录</button>
    </div>
    ${trip ? `<p class="power-line">在路上：${esc(COURTS.find((c) => c.id === trip.locationId)?.name ?? "")} ${formatRemain(Math.max(0, trip.startAt + trip.durationMs - now))}</p>` : `<p class="muted">有名球场赢一次永久占领并收租。野场用招募券挖人，占不下来。</p>`}
    ${CITIES.map((city) => {
      const open = cityUnlocked(save, city.id);
      const courts = COURTS.filter((c) => c.cityId === city.id);
      return `<div class="card city-card" style="opacity:${open ? 1 : 0.45}">
        <strong>${esc(city.name)}</strong>
        <div class="muted">${esc(city.blurb)}${open ? "" : " · 先占上一座有名球场"}</div>
        ${open ? `<div class="court-row">${courts.map((ct) => {
          const occ = isOccupied(save, ct.id);
          const selected = pendingCourt === ct.id;
          const foe = rosterPower(ct.team);
          const under = myPower > 0 && myPower < foe * 0.95;
          const named = ct.team.some((m) => m.name);
          return `<button class="btn ${selected ? "red" : "ghost"}${under ? " underdog" : ""}" data-court="${ct.id}" ${trip ? "disabled" : ""}>
            <span>${esc(ct.name)} · ${ct.kind === "named" ? (occ ? "已占领" : "可占领") : "挖人"}</span>
            ${named ? `<span class="court-foes">${esc(teamNames(ct.team))}</span>` : ""}
            <span class="court-power">${powerLabel} ${formatPower(myPower)} / 对方 ${formatPower(foe)}</span>
          </button>`;
        }).join("")}</div>` : ""}
      </div>`;
    }).join("")}
    <div data-picks>
      <strong>派出</strong>
      <p class="muted">点头像选人，再点一次取消。约 10 秒后开战。</p>
      ${rosterFilters()}
      <div class="grid grid-list">${shown.map((c) => {
        const on = campaignPick.includes(c.uid);
        const order = on ? campaignPick.indexOf(c.uid) + 1 : 0;
        return `<div class="pick-card ${on ? "on" : ""}">${monBtn(c, `${on ? "selected" : ""}`, "pick")}${on ? `<div class="pick-badge">${order}</div>` : ""}</div>`;
      }).join("") || `<p class="muted">没有可派出的球员。</p>`}</div>
    </div>
    ${downPicked.length ? `<p class="power-line">${esc(downPicked.map((c) => creatureLabel(c)).join("、"))} 体力见底，不能出发。</p>` : tiredPicked.length ? `<p class="muted">${esc(tiredPicked.map((c) => creatureLabel(c)).join("、"))} 体力不足六成，上场会掉战力。</p>` : ""}
  </div>`;
}

function campaignDock(save: SaveData): string {
  const trip = save.exploration;
  if (trip) {
    const left = Math.max(0, trip.startAt + trip.durationMs - Date.now());
    const name = COURTS.find((c) => c.id === trip.locationId)?.name ?? "";
    return `<div class="dock"><div class="dock-meta">征战中 · ${esc(name)} · ${formatRemain(left)}</div></div>`;
  }
  const court = COURTS.find((c) => c.id === pendingCourt);
  const faces = campaignPick.map((id) => findCreature(save, id)).filter((c): c is Creature => !!c);
  const down = faces.filter((c) => energyOf(c).down);
  return `<div class="dock">
    ${faces.length ? `<div class="dock-faces">${faces.map((c) => avatar(c.speciesId, c.shiny, c.position)).join("")}</div>` : ""}
    <button class="dock-meta" data-jump-picks type="button">${down.length ? `${esc(down.map((c) => creatureLabel(c)).join("、"))}体力见底` : `${esc(court?.name ?? "球场")} · ${campaignPick.length}/3`}</button>
    <button class="btn red" data-act="go-campaign">出发</button>
  </div>`;
}

function careerDock(save: SaveData): string {
  const unlocked = save.career?.unlocked;
  const played = save.career?.playedThisWeek;
  const world = save.career?.worldChampion;
  if (world) {
    return `<div class="dock">
      <div class="dock-meta">卫冕赛</div>
      <button class="btn ${played ? "ghost" : "red"}" data-act="run-career"${played ? " disabled" : ""}>${played ? "本周已赛" : "打本周卫冕"}</button>
    </div>`;
  }
  const label = unlocked ? (played ? "本周已赛" : "打本周比赛") : "报名全国大赛";
  return `<div class="dock">
    <div class="dock-meta">${unlocked ? CAREER_LABEL[unlocked] : "全国大赛"}</div>
    <button class="btn ${played ? "ghost" : "red"}" data-act="run-career"${played ? " disabled" : ""}>${label}</button>
  </div>`;
}

function foePreview(tier: "national" | "pro" | "intl"): string {
  const team = CAREER_TEAM[tier];
  const foe = rosterPower(team);
  return `<p class="power-line">对手 ${esc(teamNames(team))} · 战力 ${formatPower(foe)}</p>
    <p class="muted">${team.map((m) => `${esc(m.name || speciesById(m.speciesId).name)} Lv.${m.level}`).join(" · ")}</p>`;
}

function careerPanel(save: SaveData): string {
  const unlocked = save.career?.unlocked;
  const world = save.career?.worldChampion;
  const played = save.career?.playedThisWeek;
  const occ = occupiedCount(save);
  const ready = battleReady(save);
  const mine = ready.length ? ready : partyCreatures(save);
  const avg = partyAvgOvr(mine);
  const myEff = teamEffectivePower(mine);
  const gate = unlocked ?? "national";
  const occupyNeed = CAREER_OCCUPY[gate];
  const ovrNeed = CAREER_OVR[gate];
  const next = unlocked && careerReadyToPromote(save) ? nextCareerTier(unlocked) : null;
  const weekLine = played ? `本周已赛，距下周刷新还有 ${formatWeekRemain()}。` : "本周 1 场待打。体力见底的首发不能上场。";
  let status = "";
  if (world) {
    status = played
      ? `<p class="power-line">世界冠军 · ${weekLine}</p>`
      : `<p class="power-line">世界冠军 · 本周卫冕赛待打</p>${foePreview("intl")}<p class="muted">打国际档对手，赢了 +400 金币，不改冠军身份。</p>`;
  } else if (!unlocked) {
    status = `<p class="muted">还差 ${Math.max(0, CAREER_OCCUPY.national - occ)} 座有名球场、综合能力差 ${Math.max(0, CAREER_OVR.national - avg)} 可报名。</p>${foePreview("national")}`;
  } else if (next) {
    status = `<p class="power-line">${CAREER_LABEL[unlocked]}冠军已到手</p>
      <p class="muted">晋级${CAREER_LABEL[next]}：占领 ${occ}/${CAREER_OCCUPY[next]} 座、综合能力 ${avg}/${CAREER_OVR[next]}。</p>
      ${foePreview(next)}`;
  } else {
    status = `<p class="power-line">${played ? "本周已赛" : "本周 1 场待打"}</p>
      ${played ? "" : foePreview(unlocked)}
      <p class="muted">我方有效战力 ${formatPower(myEff)} · ${weekLine}</p>`;
  }
  return `<div class="card stack">
    <h2>职业生涯</h2>
    <div class="gate-row"><span>荣誉</span><strong>${occ}/${occupyNeed} 座${occ >= occupyNeed ? " · 达标" : ""}</strong></div>
    <div class="gate-row"><span>能力</span><strong>${avg}/${ovrNeed}${avg >= ovrNeed ? " · 达标" : ""}</strong></div>
    ${unlocked ? `<p>当前：${CAREER_LABEL[unlocked]} · 胜场 ${save.career.wins[unlocked]}/${WINS[unlocked]}</p>` : ""}
    ${status}
    <ul class="career-path">
      <li>全国 ${CAREER_OCCUPY.national} 座 / 综合能力 ${CAREER_OVR.national}</li>
      <li>职业 ${CAREER_OCCUPY.pro} 座 / 综合能力 ${CAREER_OVR.pro}</li>
      <li>国际 ${CAREER_OCCUPY.intl} 座 / 综合能力 ${CAREER_OVR.intl}</li>
      <li>世界冠军</li>
    </ul>
  </div>`;
}

function pkPanel(save: SaveData): string {
  const open = pkUnlocked(save);
  const left = pkRemaining(save);
  const mine = pkCache.find((x) => x.playerId === save.playerId);
  const others = sortPkOpponents(
    pkCache.filter((x) => x.playerId !== save.playerId),
    save.pkBeaten ?? [],
  );
  const beaten = new Set(save.pkBeaten ?? []);
  const poolHint = pkCloudReady()
    ? "阵容在云端共用池，同事能打到你。"
    : "当前用本机池，这台浏览器里的存档能互相打。配置 VITE_PK_API 后可联机。";
  if (!open) {
    return `<div class="card stack"><h2>街球 PK</h2><p class="muted">先占领一座有名球场再来上传阵容、挑战别人。</p></div>`;
  }
  return `<div class="card stack">
    <h2>街球 PK</h2>
    <p class="muted">${esc(poolHint)} 挑战 ${pkStake()} 金币，赢 +${pkWinGold()}。今天还能打 ${left} 场。</p>
    <p class="power-line">${mine ? `已上传 · 胜 ${mine.wins} 负 ${mine.losses}${mine.pendingGold ? ` · 待领 ${mine.pendingGold}` : ""}` : "还没上传阵容"}</p>
    <div class="row">
      <button class="btn red" data-act="pk-upload">上传当前首发</button>
    </div>
    <h2>挑战</h2>
    ${others.map((row) => `<div class="shop-row">
      <div><strong>${esc(row.trainerName)}</strong>${row.playerId === PK_BOSS_ID ? `<span class="muted"> · 终极BOSS</span>` : ""}${beaten.has(row.playerId) ? `<span class="muted"> · 已战胜</span>` : ""}
        <div class="muted">${esc(row.team.map((m) => `${speciesById(m.speciesId).name} Lv.${m.level}`).join(" / "))} · 战力 ${formatPower(row.power)}${row.playerId.startsWith("npc-") ? "" : ` · ${row.wins}胜${row.losses}负`}</div>
      </div>
      <button class="btn small ${beaten.has(row.playerId) ? "ghost" : "red"}" data-pk-challenge="${esc(row.playerId)}" ${left <= 0 || save.money < pkStake() ? "disabled" : ""}>打</button>
    </div>`).join("")}
  </div>`;
}

function outing(save: SaveData): Frame {
  const body = ui.outTab === "career" ? careerPanel(save) : ui.outTab === "pk" ? pkPanel(save) : campaignPanel(save);
  const dock = ui.outTab === "career"
    ? careerDock(save)
    : ui.outTab === "pk"
      ? `<div class="dock"><div class="dock-meta">今天还能打 ${pkRemaining(save)} 场</div><button class="btn red" data-act="pk-upload">上传阵容</button></div>`
      : campaignDock(save);
  return {
    head: `${top(save)}${outTabs()}`,
    body: `<div class="stack">${body}</div>`,
    dock,
  };
}

function hatchCenter(save: SaveData): Frame {
  const now = Date.now();
  const job = save.breeding;
  let dock = "";
  if (ui.hatchTab === "coach") {
    if (job) {
      const left = effectiveRemain(job.startAt + job.durationMs, save, now);
      dock = `<div class="dock"><div class="dock-meta">${left <= 0 ? "带教完成，待领取" : `带教中 · ${formatRemain(left)}`}</div></div>`;
    } else {
      const mentor = coachMentor ? findCreature(save, coachMentor) : null;
      const aide = coachAide ? findCreature(save, coachAide) : null;
      dock = `<div class="dock">
        <div class="dock-meta">${mentor ? esc(creatureLabel(mentor)) : "导师未选"} × ${aide ? esc(creatureLabel(aide)) : "助教未选"}</div>
        <button class="btn red" data-act="start-breed">开始带教</button>
      </div>`;
    }
  }
  return {
    head: `${top(save)}${hatchTabs()}`,
    body: `<div class="stack">${ui.hatchTab === "coach" ? coachPanel(save) : ui.hatchTab === "gym" ? gymPanel(save) : youthPanel(save)}</div>`,
    dock,
  };
}

function youthPanel(save: SaveData): string {
  const now = Date.now();
  return `<div class="card stack">
      <div class="row" style="justify-content:space-between"><h2>青训营 ${save.incubators.length}/${INCUBATOR_MAX}</h2>
        <button class="btn small ghost" data-modal="hatch">记录</button></div>
      ${save.incubators.map((slot, i) => {
        if (slot.egg) {
          const left = effectiveRemain(slot.egg.startAt + slot.egg.durationMs, save, now);
          return `<div class="card"><strong>培养中</strong><div class="muted">${esc(eggHintSafe(slot.egg.speciesId))} · ${formatRemain(left)}</div></div>`;
        }
        if (slot.lastHatch) {
          return `<div class="card"><strong>刚刚出道</strong> ${esc(speciesById(slot.lastHatch.speciesId).name)}
            <button class="btn small ghost" data-clear-hatch="${i}">知道了</button></div>`;
        }
        return `<div class="card muted">空席。可以买随机青训种子。</div>`;
      }).join("")}
      ${(() => {
        const cost = incubatorUpgradeCost(save.incubators.length);
        if (cost == null) return "";
        return `<button class="btn gold" data-act="upgrade-incubator" ${save.money < cost ? "disabled" : ""}>扩建青训营 ${cost} 金币（${save.incubators.length}/${INCUBATOR_MAX}）</button>`;
      })()}
    </div>
    <div class="card stack">
      <h2>待培养 ${(save.nursery ?? []).length}/8</h2>
      ${(save.nursery ?? []).length
        ? save.nursery.map((e) => `<div class="shop-row"><div>${esc(eggHintSafe(e.speciesId))}</div><button class="btn small" data-place-egg="${e.uid}">送进青训营</button></div>`).join("")
        : `<p class="muted">带教完成后会出现在这里。</p>`}
    </div>`;
}

function coachPanel(save: SaveData): string {
  const now = Date.now();
  const job = save.breeding;
  const mentorOnJob = job ? findCreature(save, job.parentUids[0]) : null;
  const aideOnJob = job ? findCreature(save, job.parentUids[1]) : null;
  const idle = save.box.filter((c) => !save.exploration?.creatureUids.includes(c.uid) && !save.breeding?.parentUids.includes(c.uid));
  const mentor = coachMentor ? findCreature(save, coachMentor) : null;
  const aide = coachAide ? findCreature(save, coachAide) : null;
  const leftPool = idle.filter((c) => c.uid !== coachAide);
  const rightPool = idle.filter((c) => c.uid !== coachMentor);
  return `<div class="card stack">
      <h2>带教新人 · 200 金币</h2>
      <p class="muted">两名球员带教新人，约 3 分钟后接到青训种子。</p>
      ${job ? `<p>${esc(mentorOnJob ? creatureLabel(mentorOnJob) : "?")} × ${esc(aideOnJob ? creatureLabel(aideOnJob) : "?")}</p>
        <p class="power-line">${effectiveRemain(job.startAt + job.durationMs, save, now) <= 0 ? "完成，待领取" : formatRemain(effectiveRemain(job.startAt + job.durationMs, save, now))}</p>`
        : `<div class="grid grid-2">
        <div><strong>导师</strong> <span class="muted">${mentor ? esc(creatureLabel(mentor)) : "未选"}</span>
          <div class="cluster">${leftPool.slice(0, 10).map((c) => `<button class="btn small ${coachMentor === c.uid ? "red" : "ghost"}" data-coach-mentor="${c.uid}">${esc(creatureLabel(c))}</button>`).join("") || `<p class="muted">没有可带教的球员。</p>`}</div></div>
        <div><strong>助教</strong> <span class="muted">${aide ? esc(creatureLabel(aide)) : "未选"}</span>
          <div class="cluster">${rightPool.slice(0, 10).map((c) => `<button class="btn small ${coachAide === c.uid ? "red" : "ghost"}" data-coach-aide="${c.uid}">${esc(creatureLabel(c))}</button>`).join("") || `<p class="muted">没有可带教的球员。</p>`}</div></div>
      </div>`}
    </div>`;
}

function gymPanel(save: SaveData): string {
  const idle = save.box.filter((c) => !save.exploration?.creatureUids.includes(c.uid) && !save.breeding?.parentUids.includes(c.uid));
  if (trainPick && !idle.some((c) => c.uid === trainPick)) trainPick = idle[0]?.uid ?? null;
  if (!trainPick && idle[0]) trainPick = idle[0].uid;
  const c = trainPick ? findCreature(save, trainPick) : null;
  const cap = c ? trainCap(c.level) : 0;
  const stats = c ? computedStats(c) : null;
  return `<div class="card stack">
      <h2>训练房</h2>
      <p class="muted">花金币加练单项。前期便宜，上限随等级提高。</p>
      <div>
        <strong>球员</strong>
        <div class="cluster">${idle.map((x) => `<button class="btn small ${trainPick === x.uid ? "red" : "ghost"}" data-train-pick="${x.uid}">${esc(creatureLabel(x))}</button>`).join("") || `<p class="muted">没有空闲球员。</p>`}</div>
      </div>
      ${c && stats ? `<p class="power-line">${esc(creatureLabel(c))} · Lv.${c.level} · 上限 ${cap}</p>
        ${hpBar(c, true)}
        <div class="grid grid-2">${STAT_KEYS.map((k) => {
          const n = trainedOf(c, k);
          const cost = trainCost(n);
          const capped = n >= cap;
          const poor = save.money < cost;
          return `<div class="card">
            <strong>${STAT_LABEL[k]} ${stats[k]}</strong>
            <div class="muted">训练 ${n}/${cap}${n ? ` · 训 +${n}` : ""}</div>
            <div class="muted">${capped ? "需升级后再练" : `下一档 ${cost} 金币`}</div>
            <button class="btn small red" data-train-stat="${k}" ${capped || poor ? "disabled" : ""}>${capped ? "需升级" : poor ? "金币不足" : "练"}</button>
          </div>`;
        }).join("")}</div>` : `<p class="muted">选一名球员开始加练。</p>`}
    </div>`;
}

function eggHintSafe(id: number): string {
  try { return `青训种子「${speciesById(id).name}」`; } catch { return "青训种子"; }
}

function bag(save: SaveData): Frame {
  const rows = Object.entries(save.inventory).filter(([, n]) => n > 0);
  const injured = sortRoster(save.box.filter((c) => {
    const e = energyOf(c);
    return e.down || e.hp < e.max;
  }));
  const picker = bagHealItem
    ? `<div class="card stack"><h2>给谁用${esc(ITEMS[bagHealItem]?.name ?? "")}</h2>
        ${injured.map((c) => `<button class="btn" data-bag-heal-uid="${c.uid}">${esc(creatureLabel(c))} · 体力 ${energyOf(c).hp}/${energyOf(c).max}</button>`).join("") || `<p class="muted">没人需要恢复。</p>`}
        <button class="btn ghost" data-act="bag-heal-cancel">取消</button>
      </div>`
    : "";
  return {
    head: top(save),
    body: `<div class="stack">
    ${picker}
    <div class="card"><h2>商店</h2>
      ${SHOP.map((g) => `<div class="shop-row">
        <div><strong>${esc(g.name)}</strong> · ${g.price} 金币<div class="muted">${esc(g.desc)}</div></div>
        <button class="btn small red" data-buy="${g.id}" ${save.money < g.price ? "disabled" : ""}>买</button>
      </div>`).join("")}
    </div>
    <div class="card"><h2>仓库</h2>
      ${rows.map(([id, n]) => {
        const heal = id === "hp-pack" || id === "oran-berry";
        return `<div class="shop-row">
        <div><strong>${esc(ITEMS[id]?.name ?? id)}</strong> ×${n}<div class="muted">回收 ${sellPrice(id)} 金币</div></div>
        <div class="row">${heal ? `<button class="btn small red" data-bag-heal="${id}">用</button>` : ""}<button class="btn small ghost" data-sell="${id}">卖</button></div>
      </div>`;
      }).join("") || `<p class="muted">空的。</p>`}
    </div>
  </div>`,
  };
}

function creature(save: SaveData): Frame {
  const back = `<div class="page-head"><button class="btn ghost" data-nav="home">返回</button></div>`;
  const c = save.box.find((x) => x.uid === ui.selectedUid);
  if (!c) return { head: `${top(save)}${back}`, body: `<div class="card">找不到这名球员。</div>` };
  const stats = computedStats(c);
  const power = powerBreakdown(c);
  const nature = NATURES.find((n) => n.id === c.nature)?.name ?? c.nature;
  const sp = speciesById(c.speciesId);
  const inParty = save.party.includes(c.uid);
  const busy = save.exploration?.creatureUids.includes(c.uid) || !!save.breeding?.parentUids.includes(c.uid);
  return {
    head: `${top(save)}${back}`,
    body: `<div class="card stack">
      <div class="portrait">${avatar(c.speciesId, c.shiny, c.position)}
        <div class="portrait-meta">
          <h2>${esc(creatureLabel(c))} ${c.shiny ? "✦" : ""}</h2>
          <div class="tags">${posTag(c.position)}<span class="tag" style="background:#6a5a48">${STAGE_LABEL[c.stage ?? 1]}</span></div>
          <p class="muted">${GENDER_LABEL[c.gender]} · Lv.${c.level}</p>
          <p class="power-line">综合能力 ${formatPower(power.total)}${busy ? (save.breeding?.parentUids.includes(c.uid) ? " · 带教中" : " · 征战中") : ""}</p>
          ${hpBar(c, true)}
        </div>
      </div>
      <div>
        <p class="muted">球风 ${esc(nature)}（${esc(natureEffectText(c.nature))}）</p>
        <p class="muted">忠诚度 ${c.friendship}</p>
        ${(c.stage ?? 1) < 2 ? `<p class="muted">${esc(matureOptions(c.youthClass, sp.dualRole))}</p>` : ""}
      </div>
      <div class="grid grid-2">
        ${STAT_KEYS.map((k) => {
          const n = trainedOf(c, k);
          return `<div class="stat-cell"><div class="stat-row"><span>${STAT_LABEL[k]}</span><strong>${stats[k]}</strong></div><div class="muted">天赋 ${c.ivs[k]}${n ? ` · 训 +${n}` : ""}</div></div>`;
        }).join("")}
      </div>
      ${traitChips(c.traits)}
      <p class="muted">${c.moves.map((id) => MOVES[id]?.name ?? id).join("、")}</p>
      <div class="action-grid">
        <button class="btn ${inParty ? "ghost" : "red"}" data-act="toggle-party">${inParty ? "移出首发" : save.party.length >= 3 ? "更换首发" : "加入首发"}</button>
        <button class="btn gold" data-feed="feed">营养餐 ${save.inventory.feed ?? 0}</button>
        <button class="btn gold" data-feed="oran-berry">能量棒 ${save.inventory["oran-berry"] ?? 0}</button>
        <button class="btn gold" data-feed="hp-pack">理疗包 ${save.inventory["hp-pack"] ?? 0}</button>
      </div>
      <details class="more-ops" ${ui.creatureMoreOpen ? "open" : ""}>
        <summary>更多操作</summary>
        <p class="muted">词条最多 4 条，分凡品、稀有、极品。</p>
        <div class="row">
          <input id="nick" type="text" maxlength="8" value="${esc(c.nickname ?? "")}" placeholder="昵称" />
          <button class="btn" data-act="rename-mon">改名</button>
        </div>
        <div class="row">
          <button class="btn ghost" data-act="merge">抽调同名球员</button>
          <button class="btn ghost" data-act="release">解约</button>
        </div>
      </details>
    </div>`,
  };
}

function more(save: SaveData): Frame {
  const list = allSpecies().filter((sp) => dexFilter === "all" || sp.youthClass === dexFilter);
  return {
    head: top(save),
    body: `<div class="stack">
    <div class="card stack">
      <h2>球员名册 ${save.dexCaught.length}/${dexTotal()}</h2>
      <div class="row">
        <button class="btn small ${dexFilter === "all" ? "red" : "ghost"}" data-dex="all">全部</button>
        <button class="btn small ${dexFilter === "C" ? "red" : "ghost"}" data-dex="C">中锋 C</button>
        <button class="btn small ${dexFilter === "F" ? "red" : "ghost"}" data-dex="F">前锋 F</button>
        <button class="btn small ${dexFilter === "G" ? "red" : "ghost"}" data-dex="G">后卫 G</button>
      </div>
      <div class="grid grid-list">${list.map((sp) => {
        const owned = save.box.filter((c) => c.speciesId === sp.id);
        const caught = save.dexCaught.includes(sp.id);
        const seen = save.dexSeen.includes(sp.id) || caught;
        const maxLv = owned.reduce((m, c) => Math.max(m, c.level), 0);
        const shiny = owned.some((c) => c.shiny);
        const extra = caught ? `${owned.length}人${maxLv ? ` · Lv.${maxLv}` : ""}${shiny ? " ✦" : ""}` : seen ? "见过" : "";
        return `<div class="mon" style="opacity:${seen ? 1 : 0.4}">
          ${seen ? avatar(sp.id, shiny, sp.youthClass) : `<div class="avatar" style="background:#ccc">?</div>`}
          <div class="mon-body"><strong class="mon-name">${seen ? esc(sp.name) : "???"}</strong>
          <div class="muted mon-meta">No.${String(sp.id).padStart(3, "0")}${seen ? ` · ${POSITION_LABEL[sp.youthClass]}` : ""}${extra ? ` · ${extra}` : ""}</div></div>
        </div>`;
      }).join("")}</div>
    </div>
    <div class="card stack">
      <h2>存档</h2>
      <div class="row">
        <button class="btn gold" data-act="export">导出</button>
        <label class="btn ghost">导入<input id="import" type="file" accept="application/json" hidden /></label>
      </div>
      <div class="row">
        <input id="rename" type="text" maxlength="12" value="${esc(save.trainerName)}" />
        <button class="btn" data-act="rename">改名</button>
      </div>
      <button class="btn ghost" data-act="new-game">重新开始</button>
    </div>
    <div class="card stack">
      <h2>音乐</h2>
      <div class="row">
        <button class="btn ${bgmEnabled() ? "red" : "ghost"}" data-act="bgm-on">开</button>
        <button class="btn ${bgmEnabled() ? "ghost" : "red"}" data-act="bgm-off">关</button>
      </div>
    </div>
    <div class="card stack">
      <h2>加速</h2>
      <div class="row">
        <button class="btn ${save.timeScale <= 1 ? "red" : "ghost"}" data-scale="1">真实</button>
        <button class="btn ${save.timeScale > 1 ? "red" : "ghost"}" data-scale="60">×60</button>
        <button class="btn ghost" data-act="skip30">+30 分钟</button>
      </div>
    </div>
  </div>`,
  };
}

function logClass(line: string): string {
  if (line.includes("命中") || line.includes("获胜") || line.includes("终场")) return "ok";
  if (line.includes("失利") || line.includes("不中")) return "";
  return "";
}

function recordsModal(title: string, inner: string): string {
  return `<div class="modal-backdrop" data-act="close-modal">
    <div class="modal" data-stop="1">
      <div class="row" style="justify-content:space-between"><h2>${title}</h2><button class="btn ghost small" data-act="close-modal">关闭</button></div>
      <div class="modal-body">${inner}</div>
    </div>
  </div>`;
}

function outingModal(save: SaveData): string {
  if (ui.modal === "explore") {
    const list = (save.journal ?? []).filter((j) => j.kind === "explore");
    const inner = list.length
      ? list.map((j) => `<div class="journal"><strong>${esc(j.title)}</strong> <span class="muted">${new Date(j.at).toLocaleString()}</span>${j.lines.map((line) => `<div class="muted">${esc(line)}</div>`).join("")}</div>`).join("")
      : `<p class="muted">还没有征战记录。</p>`;
    return recordsModal("征战记录", inner);
  }
  if (ui.modal === "hatch") {
    const list = (save.journal ?? []).filter((j) => j.kind === "hatch" || j.kind === "breed");
    const inner = list.length
      ? list.map((j) => `<div class="journal"><strong>${esc(j.title)}</strong>${j.lines.map((line) => `<div class="muted">${esc(line)}</div>`).join("")}</div>`).join("")
      : `<p class="muted">还没有培养记录。</p>`;
    return recordsModal("培养记录", inner);
  }
  return "";
}

function hatchReveal(save: SaveData): string {
  if (ui.screen === "battle") return "";
  const h = save.pendingHatches?.[0];
  if (!h) return "";
  const kind = h.kind ?? "debut";
  const baby = h.uid ? save.box.find((c) => c.uid === h.uid) : undefined;
  const pos = h.position ?? baby?.position;
  const speciesId = h.speciesId ?? baby?.speciesId;
  const action = kind === "debut" || kind === "recruit" ? "收下" : "知道了";
  const meta = [
    h.code ? `#${h.code}` : "",
    h.gender === "female" ? "♀" : h.gender === "male" ? "♂" : "",
    h.shiny ? "✦" : "",
    h.autoParty ? "已编入首发" : "",
  ].filter(Boolean).join(" ");
  return `<div class="hatch-overlay"><div class="hatch-pop">
    ${speciesId ? avatar(speciesId, h.shiny, pos) : ""}
    <h2>${esc(h.title)}</h2>
    ${speciesId ? `<p class="muted">${esc(speciesById(speciesId).name)}${meta ? ` · ${esc(meta)}` : ""}</p>` : ""}
    ${pos ? `<div class="tags" style="justify-content:center">${posTag(pos)}</div>` : ""}
    ${traitChips(h.traits)}
    ${(h.lines ?? []).map((line) => `<p class="muted">${esc(line)}</p>`).join("")}
    <button class="btn red" data-act="dismiss-hatch">${action}</button>
  </div></div>`;
}

function battleHealNeeded(save: SaveData): boolean {
  const team = ui.battleUids.map((id) => findCreature(save, id)).filter((c): c is Creature => !!c);
  const hurt = team.some((c) => energyOf(c).down || energyOf(c).weak);
  const items = (save.inventory["hp-pack"] ?? 0) + (save.inventory["oran-berry"] ?? 0);
  return hurt && items > 0;
}

function battle(save: SaveData): Frame {
  const shown = ui.battleLog.slice(0, ui.battleShown);
  const done = ui.battleShown >= ui.battleLog.length && ui.battleLog.length > 0;
  const allyLine = ui.battleAllies.map((s) => `${esc(s.name)} ${posTag(s.position)}`).join(" · ");
  const foeLine = ui.battleFoes.map((s) => `${esc(s.name)} ${posTag(s.position)}`).join(" · ");
  const goal = nextGoal(save);
  const main = !done
    ? ""
    : battleHealNeeded(save)
      ? `<button class="btn gold" data-act="heal-squad" data-battle-next>给上场的人恢复</button>`
      : `<button class="btn red" data-battle-next ${goalAttrs(goal)}>${esc(goal.cta)}</button>`;
  return {
    head: top(save),
    body: `<div class="card stack" data-battle="1">
    <h2>${esc(ui.battleTitle)}</h2>
    <p data-battle-status>${done ? (ui.battleWin ? "获胜" : "失利") : "比赛进行中…"}</p>
    <div class="muted" data-battle-sides>我方 ${allyLine || "—"}</div>
    <div class="muted" data-battle-foes>对方 ${foeLine || "—"}</div>
    <div class="log">${shown.map((l) => `<div data-log="1" class="${logClass(l)}">${esc(l)}</div>`).join("") || `<div class="muted" data-log-placeholder>即将开始…</div>`}</div>
    <p class="power-line" data-battle-summary ${done ? "" : "hidden"}>${esc(ui.battleSummary)}</p>
  </div>`,
    dock: `<div class="dock">
      <button class="btn gold" data-act="skip-battle"${done ? " hidden" : ""}>跳过</button>
      ${main}
      <button class="btn ghost" data-nav="outing">返回比赛</button>
    </div>`,
  };
}

function patchBattlePlayback(root: HTMLElement): boolean {
  if (ui.screen !== "battle") return false;
  const existing = root.querySelector("[data-battle]");
  if (!existing) return false;
  const titleEl = existing.querySelector("h2");
  if (titleEl && titleEl.textContent !== ui.battleTitle) return false;
  if (ui.battleShown >= ui.battleLog.length && ui.battleLog.length > 0) return false;
  const logEl = existing.querySelector(".log");
  if (!logEl) return false;
  const shown = ui.battleLog.slice(0, ui.battleShown);
  if (logEl.querySelectorAll("[data-log]").length > shown.length) return false;
  logEl.querySelector("[data-log-placeholder]")?.remove();
  const current = logEl.querySelectorAll("[data-log]").length;
  for (let i = current; i < shown.length; i += 1) {
    const div = document.createElement("div");
    div.dataset.log = "1";
    div.className = logClass(shown[i] ?? "");
    div.textContent = shown[i] ?? "";
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
  const status = existing.querySelector("[data-battle-status]");
  if (status) status.textContent = "比赛进行中…";
  return true;
}

let renderedScreen = "";

export function render(root: HTMLElement): void {
  const save = ui.save;
  const screenKey = save ? `${ui.screen}:${ui.outTab}:${ui.hatchTab}:${ui.selectedUid ?? ""}:${dexFilter}:${rosterFilter}:${bagHealItem ?? ""}` : "onboard";
  const shell = root.querySelector(".shell");
  const modalEl = root.querySelector(".modal");
  const keepShell = screenKey === renderedScreen && shell instanceof HTMLElement ? shell.scrollTop : 0;
  const keepModal = screenKey === renderedScreen && modalEl instanceof HTMLElement ? modalEl.scrollTop : 0;
  if (!save) {
    root.innerHTML = deviceChrome(onboard(), `${flashNote()}${toasts()}`);
    bind(root);
    renderedScreen = screenKey;
    return;
  }
  if (patchBattlePlayback(root)) return;
  let frame: Frame;
  switch (ui.screen) {
    case "hatch": frame = hatchCenter(save); break;
    case "bag":
    case "warehouse":
    case "shop": frame = bag(save); break;
    case "creature": frame = creature(save); break;
    case "outing":
    case "adventure":
    case "gyms": frame = outing(save); break;
    case "more":
    case "dex":
    case "settings": frame = more(save); break;
    case "battle": frame = battle(save); break;
    default: frame = home(save);
  }
  root.innerHTML = deviceChrome(
    frame,
    `${outingModal(save)}${hatchReveal(save)}${flashNote()}${toasts()}`,
  );
  bind(root);
  renderedScreen = screenKey;
  const nextShell = root.querySelector(".shell");
  if (nextShell instanceof HTMLElement) nextShell.scrollTop = keepShell;
  const nextModal = root.querySelector(".modal");
  if (nextModal instanceof HTMLElement) nextModal.scrollTop = keepModal;
  root.querySelector(".slot-card.picking")?.scrollIntoView({ block: "nearest" });
}

function emitRefresh(): void {
  setScreen(ui.screen, ui.selectedUid);
}

function bind(root: HTMLElement): void {
  root.querySelector("#name")?.addEventListener("input", (e) => {
    ui.onboardName = (e.target as HTMLInputElement).value;
  });
  root.querySelector("[data-act='create']")?.addEventListener("click", () => void createTrainer());
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => setScreen((el as HTMLElement).dataset.nav as typeof ui.screen));
  });
  root.querySelectorAll("[data-out]").forEach((el) => {
    el.addEventListener("click", () => setOutTab((el as HTMLElement).dataset.out as OutTab));
  });
  root.querySelectorAll("[data-hatch]").forEach((el) => {
    el.addEventListener("click", () => setHatchTab((el as HTMLElement).dataset.hatch as HatchTab));
  });
  root.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => setScreen("creature", (el as HTMLElement).dataset.open!));
  });
  root.querySelectorAll("[data-slot]").forEach((el) => {
    el.addEventListener("click", () => beginPartyEdit(Number((el as HTMLElement).dataset.slot)));
  });
  root.querySelectorAll("[data-assign]").forEach((el) => {
    el.addEventListener("click", () => {
      if (ui.partySlot === null) return;
      void setPartyMember((el as HTMLElement).dataset.assign!, ui.partySlot);
    });
  });
  root.querySelectorAll("[data-pick]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.pick!;
      if (campaignPick.includes(id)) campaignPick = campaignPick.filter((x) => x !== id);
      else if (campaignPick.length < 3) campaignPick = [...campaignPick, id];
      else toast("已经派出 3 人，先点掉一个再换。");
      ui.outTab = "campaign";
      setScreen("outing");
    });
  });
  root.querySelectorAll("[data-court]").forEach((el) => {
    el.addEventListener("click", () => {
      pendingCourt = (el as HTMLElement).dataset.court!;
      ui.outTab = "campaign";
      setScreen("outing");
    });
  });
  root.querySelector("[data-jump-picks]")?.addEventListener("click", () => {
    root.querySelector("[data-picks]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  root.querySelector("[data-act='go-campaign']")?.addEventListener("click", () => {
    if (ui.save?.exploration) {
      toast("还在路上。");
      return;
    }
    if (campaignPick.length !== 3) {
      toast("先选出 3 名球员。");
      return;
    }
    void startCampaign(pendingCourt, campaignPick).then(() => { campaignPick = []; });
  });
  root.querySelector("[data-act='run-career']")?.addEventListener("click", () => void runCareer());
  root.querySelector("[data-act='heal-party']")?.addEventListener("click", () => void healPartyStarters());
  root.querySelector("[data-act='heal-squad']")?.addEventListener("click", () => void healBattleSquad());
  root.querySelector("[data-act='collect-rent']")?.addEventListener("click", () => void flushGymPayout());
  root.querySelector("[data-act='pk-upload']")?.addEventListener("click", () => void uploadPkTeam());
  root.querySelectorAll("[data-pk-challenge]").forEach((el) => {
    el.addEventListener("click", () => void challengePk((el as HTMLElement).dataset.pkChallenge!));
  });
  root.querySelectorAll("[data-roster-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      rosterFilter = ((el as HTMLElement).dataset.rosterFilter ?? "all") as typeof rosterFilter;
      emitRefresh();
    });
  });
  root.querySelectorAll("[data-bag-heal]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.bagHeal!;
      const save = ui.save;
      if (!save) return;
      const injured = save.box.some((c) => {
        const e = energyOf(c);
        return e.down || e.hp < e.max;
      });
      if (!injured) {
        toast("没人需要恢复。");
        return;
      }
      bagHealItem = id;
      emitRefresh();
    });
  });
  root.querySelectorAll("[data-bag-heal-uid]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!bagHealItem) return;
      const uid = (el as HTMLElement).dataset.bagHealUid!;
      void feed(uid, bagHealItem).then(() => {
        bagHealItem = null;
        emitRefresh();
      });
    });
  });
  root.querySelector("[data-act='bag-heal-cancel']")?.addEventListener("click", () => {
    bagHealItem = null;
    emitRefresh();
  });
  root.querySelector("[data-act='toggle-party']")?.addEventListener("click", () => {
    if (ui.selectedUid) void toggleParty(ui.selectedUid);
  });
  root.querySelector("[data-act='release']")?.addEventListener("click", () => {
    const c = ui.save?.box.find((x) => x.uid === ui.selectedUid);
    if (!c) return;
    if (!confirm(`确定解约 ${creatureLabel(c)}？`)) return;
    void releaseCreature(c.uid);
  });
  root.querySelectorAll("[data-feed]").forEach((el) => {
    el.addEventListener("click", () => {
      if (ui.selectedUid) void feed(ui.selectedUid, (el as HTMLElement).dataset.feed!);
    });
  });
  root.querySelector("[data-act='cancel-party']")?.addEventListener("click", () => cancelPartyEdit());
  root.querySelector("[data-act='merge']")?.addEventListener("click", () => {
    const c = ui.save?.box.find((x) => x.uid === ui.selectedUid);
    if (c) void mergeThree(c.speciesId);
  });
  root.querySelectorAll("[data-coach-mentor]").forEach((el) => {
    el.addEventListener("click", () => { coachMentor = (el as HTMLElement).dataset.coachMentor!; ui.hatchTab = "coach"; setScreen("hatch"); });
  });
  root.querySelectorAll("[data-coach-aide]").forEach((el) => {
    el.addEventListener("click", () => { coachAide = (el as HTMLElement).dataset.coachAide!; ui.hatchTab = "coach"; setScreen("hatch"); });
  });
  root.querySelector("[data-act='start-breed']")?.addEventListener("click", () => {
    if (!coachMentor || !coachAide || coachMentor === coachAide) {
      toast("先选导师和助教。");
      return;
    }
    void startBreed(coachMentor, coachAide).then(() => { coachMentor = null; coachAide = null; });
  });
  root.querySelectorAll("[data-train-pick]").forEach((el) => {
    el.addEventListener("click", () => { trainPick = (el as HTMLElement).dataset.trainPick!; ui.hatchTab = "gym"; setScreen("hatch"); });
  });
  root.querySelectorAll("[data-train-stat]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!trainPick) return;
      void trainStat(trainPick, (el as HTMLElement).dataset.trainStat as StatKey);
    });
  });
  root.querySelectorAll("[data-place-egg]").forEach((el) => {
    el.addEventListener("click", () => void placeNurseryEgg((el as HTMLElement).dataset.placeEgg!));
  });
  root.querySelectorAll("[data-sell]").forEach((el) => el.addEventListener("click", () => void sellItem((el as HTMLElement).dataset.sell!)));
  root.querySelectorAll("[data-buy]").forEach((el) => el.addEventListener("click", () => void buyShop((el as HTMLElement).dataset.buy!)));
  root.querySelector("[data-act='upgrade-incubator']")?.addEventListener("click", () => void upgradeIncubator());
  root.querySelector("[data-act='skip-battle']")?.addEventListener("click", () => skipBattlePlayback());
  root.querySelectorAll("[data-modal]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setModal((el as HTMLElement).dataset.modal as "explore" | "gym" | "hatch");
    });
  });
  root.querySelectorAll("[data-act='close-modal']").forEach((el) => el.addEventListener("click", () => setModal(null)));
  root.querySelectorAll("[data-stop]").forEach((el) => el.addEventListener("click", (ev) => ev.stopPropagation()));
  root.querySelectorAll("[data-clear-hatch]").forEach((el) => {
    el.addEventListener("click", () => void clearLastHatch(Number((el as HTMLElement).dataset.clearHatch)));
  });
  root.querySelectorAll("[data-dex]").forEach((el) => {
    el.addEventListener("click", () => {
      dexFilter = ((el as HTMLElement).dataset.dex ?? "all") as "all" | YouthClass;
      setScreen("more");
    });
  });
  root.querySelector("[data-act='export']")?.addEventListener("click", () => {
    if (!ui.save) return;
    downloadText(`fs-bokemon-${ui.save.trainerName}.json`, exportSaveJson(ui.save));
  });
  root.querySelector("#import")?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try { await replaceSave(parseSaveJson(await file.text())); }
    catch (err) { alert(err instanceof Error ? err.message : "导入失败"); }
  });
  root.querySelector("[data-act='rename']")?.addEventListener("click", () => {
    void renameTrainer((root.querySelector("#rename") as HTMLInputElement | null)?.value ?? "");
  });
  root.querySelectorAll("[data-scale]").forEach((el) => el.addEventListener("click", () => void setTimeScale(Number((el as HTMLElement).dataset.scale))));
  root.querySelector("[data-act='skip30']")?.addEventListener("click", () => void skipMinutes(30));
  root.querySelector("[data-act='dismiss-hatch']")?.addEventListener("click", () => void dismissHatchReveal());
  root.querySelector(".more-ops")?.addEventListener("toggle", (e) => { ui.creatureMoreOpen = (e.target as HTMLDetailsElement).open; });
  root.querySelector("[data-act='rename-mon']")?.addEventListener("click", () => {
    if (!ui.selectedUid) return;
    void renameCreature(ui.selectedUid, (root.querySelector("#nick") as HTMLInputElement | null)?.value ?? "");
  });
  root.querySelector("[data-act='new-game']")?.addEventListener("click", () => {
    if (!confirm("确定清空本机存档并重新开始？")) return;
    void resetGame();
  });
  root.querySelector("[data-act='bgm-on']")?.addEventListener("click", () => {
    setBgmEnabled(true);
    emitRefresh();
  });
  root.querySelector("[data-act='bgm-off']")?.addEventListener("click", () => {
    setBgmEnabled(false);
    emitRefresh();
  });
  root.querySelector("[data-act='bgm-toggle']")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleBgm();
    const btn = ev.currentTarget as HTMLElement;
    const on = bgmEnabled();
    btn.classList.toggle("on", on);
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-label", on ? "关闭音乐" : "打开音乐");
    emitRefresh();
  });
}
