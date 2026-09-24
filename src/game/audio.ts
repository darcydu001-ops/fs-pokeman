const MUTE_KEY = "fs-bokemon-bgm";
const VOLUME = 0.92;

const WORKLET = `
class CrushProcessor extends AudioWorkletProcessor {
  last = 0;
  acc = 0;
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    const ratio = sampleRate / 11025;
    for (let i = 0; i < output.length; i++) {
      this.acc += 1;
      if (this.acc >= ratio) {
        this.acc -= ratio;
        this.last = Math.round(input[i] * 127) / 127;
      }
      output[i] = this.last;
    }
    if (outputs[0][1]) outputs[0][1].set(output);
    return true;
  }
}
registerProcessor("gba-crush", CrushProcessor);
`;

type Runtime = {
  ctx: AudioContext | null;
  el: HTMLAudioElement | null;
  gain: GainNode | null;
  ready: Promise<void> | null;
  listening: boolean;
};

const g = globalThis as typeof globalThis & { __fsBgm?: Runtime };

function rt(): Runtime {
  if (!g.__fsBgm) g.__fsBgm = { ctx: null, el: null, gain: null, ready: null, listening: false };
  return g.__fsBgm;
}

export function bgmEnabled(): boolean {
  return localStorage.getItem(MUTE_KEY) !== "off";
}

export function setBgmEnabled(on: boolean): void {
  localStorage.setItem(MUTE_KEY, on ? "on" : "off");
  applyMute();
  if (on) void unlock();
}

export function toggleBgm(): void {
  setBgmEnabled(!bgmEnabled());
}

function applyMute(): void {
  const on = bgmEnabled();
  const { gain, el } = rt();
  if (gain) gain.gain.value = on ? VOLUME : 0;
  if (el && !on) el.pause();
}

function crushCurve(bits: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  const steps = 2 ** (bits - 1);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

function softClipCurve(): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.55);
  }
  return curve;
}

async function ensure(): Promise<void> {
  const s = rt();
  if (s.ready) return s.ready;
  s.ready = (async () => {
    s.ctx = new AudioContext();
    s.el = new Audio(`${import.meta.env.BASE_URL}audio/bgm.mp3`);
    s.el.loop = true;
    s.el.preload = "auto";
    s.el.crossOrigin = "anonymous";
    s.el.setAttribute("playsinline", "true");
    const src = s.ctx.createMediaElementSource(s.el);

    const hp = s.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;
    hp.Q.value = 0.55;

    const lp = s.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    lp.Q.value = 0.7;

    const crush = s.ctx.createWaveShaper();
    crush.curve = crushCurve(8) as WaveShaperNode["curve"];
    crush.oversample = "none";

    const sat = s.ctx.createWaveShaper();
    sat.curve = softClipCurve() as WaveShaperNode["curve"];
    sat.oversample = "none";

    s.gain = s.ctx.createGain();
    s.gain.gain.value = bgmEnabled() ? VOLUME : 0;

    let mid: AudioNode = crush;
    try {
      const blob = new Blob([WORKLET], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      await s.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      mid = new AudioWorkletNode(s.ctx, "gba-crush");
    } catch {
      mid = crush;
    }

    const comp = s.ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 16;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.008;
    comp.release.value = 0.18;

    src.connect(hp);
    hp.connect(mid);
    mid.connect(lp);
    lp.connect(sat);
    sat.connect(comp);
    comp.connect(s.gain);
    s.gain.connect(s.ctx.destination);
  })().catch((err) => {
    s.ready = null;
    s.ctx = null;
    s.el = null;
    s.gain = null;
    throw err;
  });
  return s.ready;
}

async function unlock(): Promise<void> {
  try {
    await ensure();
  } catch {
    return;
  }
  const s = rt();
  if (!s.ctx || !s.el) return;
  if (s.ctx.state === "suspended") await s.ctx.resume();
  applyMute();
  if (!bgmEnabled()) return;
  try {
    await s.el.play();
  } catch {
    /* wait for a later gesture */
  }
}

export function startBgm(): void {
  void unlock();
  const s = rt();
  if (s.listening) return;
  s.listening = true;
  const onGesture = () => {
    void unlock();
  };
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void unlock();
    else if (s.el && document.visibilityState === "hidden") s.el.pause();
  });
}

export function bgmStatus(): { enabled: boolean; paused: boolean | null; context: string | null } {
  const s = rt();
  return { enabled: bgmEnabled(), paused: s.el ? s.el.paused : null, context: s.ctx?.state ?? null };
}

applyMute();
