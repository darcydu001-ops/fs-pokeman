import "./style.css";
import { boot, subscribe, ui, applySettleNotes } from "./game/actions";
import { startBgm } from "./game/audio";
import { loadSave, persistSave } from "./game/save";
import { needsIdleTick, settle } from "./game/settle";
import { render } from "./ui/view";

{
  const href = `${import.meta.env.BASE_URL}fonts/fusion-pixel.woff2`;
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"Fusion Pixel 12px Proportional SC";font-style:normal;font-weight:400;font-display:swap;src:url("${href}") format("woff2")}`;
  document.head.appendChild(style);
}

const rootEl = document.querySelector("#app");
if (!(rootEl instanceof HTMLElement)) throw new Error("缺少 #app");
const root = rootEl;

subscribe(() => render(root));

function hasLiveTimer(): boolean {
  return !!ui.save && needsIdleTick(ui.save);
}

let lastFullTick = 0;

async function refreshIdle(force = false): Promise<void> {
  if (!ui.save) return;
  const now = Date.now();
  const ticking = hasLiveTimer();
  if (!force && !ticking && now - lastFullTick < 10000) {
    return;
  }
  lastFullTick = now;
  const notes = settle(ui.save);
  if (notes.lines.length || notes.pendingBattle) await persistSave(ui.save);
  applySettleNotes(notes);
  render(root);
}

void (async () => {
  const save = await loadSave();
  await boot(save);
  render(root);
  startBgm();
})();

setInterval(() => {
  void refreshIdle();
}, 1000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshIdle(true);
});
