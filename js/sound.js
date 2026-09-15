// Звук сайта. У каждой сцены свой фон, у каждого перехода свой «пролёт».
// Всё синтезируется прямо в браузере (Web Audio API) — аудиофайлы не нужны.
import { smoothstep, clamp } from "./lib/noise.js";

const HI_PENTA = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349.3];

function noiseBuffer(ctx, seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  // ---------- базовые кирпичики ----------
  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.white = noiseBuffer(ctx, 3, false);
    this.brown = noiseBuffer(ctx, 4, true);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = this.gain(0);
    this.master.connect(comp);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.4, 2.4);
    const wet = this.gain(0.6);
    this.verb.connect(wet).connect(this.master);

    this.layers = {
      hero: this.desertLayer(),
      artifacts: this.vaultLayer(),
      squares: this.gateLayer(),
      podium: this.podiumLayer(),
    };
    this.trans = [this.sandDive(), this.glitchSweep(), this.lightFlash(), this.windRush()];
  }

  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  osc(type, f, detune = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(); return o; }
  noise(brown) {
    const s = this.ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    s.loop = true;
    s.start(0, Math.random() * s.buffer.duration);
    return s;
  }
  lfo(freq, depth, param) { const o = this.osc("sine", freq); const g = this.gain(depth); o.connect(g).connect(param); return o; }
  set(param, v, tc = 0.1) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // слой = выход сцены (громкость по «весу» сцены) + отправка в эхо
  layer(level, send) {
    const out = this.gain(0);
    out.connect(this.master);
    const s = this.gain(send);
    out.connect(s).connect(this.verb);
    return { out, level };
  }

  pluck(freq, dest, { type = "sine", peak = 0.06, decay = 2.2 } = {}) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.gain(0);
    o.connect(g).connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // ---------- сцена 1: пустыня ----------
  desertLayer() {
    const L = this.layer(0.9, 0.18);
    const wind = this.noise(true);
    const wbp = this.filter("bandpass", 420, 0.8);
    this.lfo(0.09, 170, wbp.frequency);
    const wg = this.gain(0.9);
    wind.connect(wbp).connect(wg).connect(L.out);

    const howl = this.noise(false);
    const hbp = this.filter("bandpass", 950, 14);
    this.lfo(0.05, 260, hbp.frequency);
    const hg = this.gain(0.038);
    howl.connect(hbp).connect(hg).connect(L.out);

    const dlp = this.filter("lowpass", 320);
    const dg = this.gain(0.12);
    dlp.connect(dg).connect(L.out);
    this.lfo(0.16, 0.04, dg.gain);
    [55, 82.4, 110.2].forEach((f, i) => this.osc(i === 2 ? "triangle" : "sine", f, (i - 1) * 6).connect(dlp));

    // золотое мерцание, когда пирамида раскрывается
    const shim = this.gain(0);
    shim.connect(L.out);
    [880, 1318.5, 1760, 2637].forEach((f) => {
      const o = this.osc("sine", f);
      this.lfo(4 + Math.random() * 2, 7, o.detune);
      o.connect(this.gain(0.25)).connect(shim);
    });

    // хруст песка под курсором
    const crunch = this.noise(false);
    const chp = this.filter("highpass", 2000);
    const clp = this.filter("lowpass", 5200); // срезаем самый резкий «писк» песка
    const cg = this.gain(0);
    crunch.connect(chp).connect(clp).connect(cg).connect(L.out);

    // глухой гул камня, когда курсор двигает блоки пирамиды
    const rumble = this.noise(true);
    const rlp = this.filter("lowpass", 170, 0.9);
    const rg = this.gain(0);
    rumble.connect(rlp).connect(rg).connect(L.out);
    let nextClack = 0;

    L.update = (s, w, now) => {
      this.set(shim.gain, (s.hero?.open ?? 0) * 0.09, 0.25);
      this.set(cg.gain, (s.hero?.trail ?? 0) * (0.1 + Math.random() * 0.17), 0.02);
      this.set(wg.gain, 0.68 + Math.min(Math.abs(s.velocity), 2) * 0.2, 0.3);
      // чем быстрее ведёшь курсор по пирамиде, тем чаще стучат блоки
      const mv = clamp((s.hero?.move ?? 0) / 5, 0, 1);
      this.set(rg.gain, mv * 0.6, 0.06);
      if (mv > 0.04 && now > nextClack) {
        nextClack = now + 0.025 + (1 - mv) * 0.16 + Math.random() * 0.04;
        this.clack(L.out, mv);
      }
    };
    return L;
  }

  // короткий стук камня о камень
  clack(dest, amt) {
    const t = this.ctx.currentTime;
    const n = this.noise(false);
    const bp = this.filter("bandpass", 380 + Math.random() * 900, 3 + Math.random() * 4);
    const g = this.gain(0.0001);
    const peak = 0.06 + amt * 0.18 * (0.5 + Math.random() * 0.5);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.05);
    n.connect(bp).connect(g).connect(dest);
    n.stop(t + 0.12);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140 + Math.random() * 80, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const og = this.gain(0.0001);
    og.gain.exponentialRampToValueAtTime(peak * 0.6, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.08);
  }

  // щелчок клавиши — для текста, который «печатается» при наведении
  typeTick() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - (this.lastTick ?? 0) < 0.028) return;
    this.lastTick = t;
    const n = this.noise(false);
    const bp = this.filter("bandpass", 2600 + Math.random() * 2600, 2.2);
    const g = this.gain(0.0001);
    g.gain.exponentialRampToValueAtTime(0.16 + Math.random() * 0.08, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(bp).connect(g).connect(this.master);
    n.stop(t + 0.05);
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 170 + Math.random() * 90;
    const og = this.gain(0.0001);
    og.gain.exponentialRampToValueAtTime(0.025, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.03);
  }

  // ---------- сцена 2: хранилище артефактов ----------
  vaultLayer() {
    const L = this.layer(0.9, 0.45);
    const air = this.noise(true);
    const alp = this.filter("lowpass", 260);
    air.connect(alp).connect(this.gain(0.55)).connect(L.out);

    const plp = this.filter("lowpass", 800);
    this.lfo(0.06, 350, plp.frequency);
    plp.connect(this.gain(0.05)).connect(L.out);
    [146.8, 220, 261.6, 329.6].forEach((f) => {
      this.osc("triangle", f, -7).connect(plp);
      this.osc("triangle", f, 7).connect(plp);
    });

    // «скрежет камня», когда артефакт крутят рукой
    const grind = this.noise(true);
    const gbp = this.filter("bandpass", 170, 1.3);
    const gg = this.gain(0);
    grind.connect(gbp).connect(gg).connect(L.out);

    let nextPing = 0;
    L.update = (s, w, now) => {
      if (now > nextPing) {
        nextPing = now + 2 + Math.random() * 3;
        this.pluck(HI_PENTA[(Math.random() * HI_PENTA.length) | 0] / 2, L.out, { peak: 0.05, decay: 2.8 });
      }
      const spin = Math.min(Math.abs(s.artifacts?.spin ?? 0), 6);
      this.set(gg.gain, spin * 0.12, 0.08);
      this.set(gbp.frequency, 140 + spin * 40, 0.1);
    };
    L.blip = () => {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(2400, t);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
      const g = this.gain(0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(L.out);
      o.start(t);
      o.stop(t + 0.08);
    };
    return L;
  }

  // ---------- сцена 3: врата ----------
  gateLayer() {
    const L = this.layer(0.85, 0.35);
    const hlp = this.filter("lowpass", 200, 4);
    const hg = this.gain(0.06);
    hlp.connect(hg).connect(L.out);
    this.osc("sawtooth", 55).connect(hlp);
    this.osc("sawtooth", 55, 9).connect(hlp);

    const sub = this.osc("sine", 41);
    const sg = this.gain(0.14);
    this.lfo(1.1, 0.1, sg.gain);
    sub.connect(sg).connect(L.out);

    const riser = this.noise(false);
    const rbp = this.filter("bandpass", 300, 1.5);
    const rg = this.gain(0);
    riser.connect(rbp).connect(rg).connect(L.out);

    const choir = this.gain(0);
    choir.connect(L.out);
    [220, 277.2, 329.6, 440].forEach((f) => this.osc("sine", f, (Math.random() - 0.5) * 8).connect(choir));

    L.update = (s) => {
      const u = s.squares?.u ?? 0;
      const light = smoothstep(0.2, 0.9, u);
      this.set(hlp.frequency, 180 + light * 2400, 0.15);
      this.set(rbp.frequency, 300 + clamp(u, 0, 1) * 3800, 0.15);
      this.set(rg.gain, light * 0.12, 0.2);
      this.set(choir.gain, light * 0.045, 0.3);
    };
    return L;
  }

  // ---------- сцена 4: подиум с частицами ----------
  podiumLayer() {
    const L = this.layer(0.85, 0.5);
    const fizz = this.noise(false);
    fizz.connect(this.filter("highpass", 7000)).connect(this.gain(0.02)).connect(L.out);

    const plp = this.filter("lowpass", 420);
    plp.connect(this.gain(0.08)).connect(L.out);
    [65.4, 98, 130.8].forEach((f) => this.osc("sine", f, 4).connect(plp));

    const scat = this.noise(false);
    const sbp = this.filter("bandpass", 2600, 1.8);
    const sg = this.gain(0);
    scat.connect(sbp).connect(sg).connect(L.out);

    let nextBell = 0;
    L.update = (s, w, now) => {
      if (now > nextBell) {
        nextBell = now + 0.7 + Math.random() * 1.1;
        this.pluck(HI_PENTA[(Math.random() * HI_PENTA.length) | 0], L.out, { type: "triangle", peak: 0.025, decay: 1.6 });
      }
      const a = clamp(s.podium?.agitation ?? 0, 0, 1);
      this.set(sg.gain, a * 0.22, 0.05);
      this.set(sbp.frequency, 1800 + a * 2600, 0.1);
    };
    L.morph = () => {
      const t = this.ctx.currentTime;
      const n = this.noise(false);
      const bp = this.filter("bandpass", 400, 2);
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 0.7);
      const g = this.gain(0.0001);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      n.connect(bp).connect(g).connect(L.out);
      n.stop(t + 1);
      [523.3, 659.3, 784].forEach((f, i) => setTimeout(() => this.pluck(f * 2, L.out, { peak: 0.04, decay: 1.8 }), i * 70));
    };
    return L;
  }

  // ---------- переходы (звук «прокручивается» вместе со скроллом) ----------
  transLayer(level) {
    const out = this.gain(0);
    out.connect(this.master);
    out.connect(this.gain(0.3)).connect(this.verb);
    return { out, level };
  }

  // пирамида → артефакты: погружение в песок
  sandDive() {
    const T = this.transLayer(0.9);
    const n = this.noise(true);
    const lp = this.filter("lowpass", 2400, 0.9);
    n.connect(lp).connect(this.gain(1)).connect(T.out);
    const glide = this.osc("sine", 260);
    glide.connect(this.gain(0.1)).connect(T.out);
    const cr = this.noise(false);
    const cbp = this.filter("bandpass", 3500, 1);
    const cg = this.gain(0);
    cr.connect(cbp).connect(cg).connect(T.out);
    T.update = (k, peak) => {
      this.set(lp.frequency, 2400 - k * 2200, 0.05);
      this.set(glide.frequency, 260 - k * 205, 0.05);
      this.set(cg.gain, Math.random() > 0.75 ? 0.35 * peak : 0, 0.005);
    };
    return T;
  }

  // артефакты → врата: цифровой глитч
  glitchSweep() {
    const T = this.transLayer(0.7);
    const sq = this.osc("square", 400);
    const sbp = this.filter("bandpass", 900, 4);
    const sg = this.gain(0.05);
    sq.connect(sbp).connect(sg).connect(T.out);
    const n = this.noise(false);
    const nbp = this.filter("bandpass", 500, 1.2);
    n.connect(nbp).connect(this.gain(0.5)).connect(T.out);
    const stutter = this.gain(1);
    T.out.disconnect();
    T.out.connect(stutter).connect(this.master);
    const lfo = this.osc("square", 13);
    lfo.connect(this.gain(0.45)).connect(stutter.gain);
    T.update = (k) => {
      if (Math.random() < 0.3) sq.frequency.setValueAtTime(180 + Math.random() * 2200, this.ctx.currentTime);
      this.set(nbp.frequency, 500 + k * 6500, 0.05);
      this.set(sbp.frequency, 600 + k * 2400, 0.05);
    };
    return T;
  }

  // врата → подиум: вспышка света и удар
  lightFlash() {
    const T = this.transLayer(0.8);
    const n = this.noise(false);
    const hp = this.filter("highpass", 800, 0.8);
    n.connect(hp).connect(this.gain(0.45)).connect(T.out);
    const shim = this.gain(0.05);
    shim.connect(T.out);
    [1760, 2217.5, 2637].forEach((f) => this.osc("sine", f, (Math.random() - 0.5) * 12).connect(shim));
    let lastK = 0;
    T.update = (k) => {
      this.set(hp.frequency, 800 + k * 8200, 0.05);
      if ((lastK - 0.5) * (k - 0.5) < 0 && Math.abs(k - lastK) < 0.4) this.boom();
      lastK = k;
    };
    return T;
  }

  boom() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g = this.gain(0.0001);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.4);
    const n = this.noise(false);
    const lp = this.filter("lowpass", 1200);
    const ng = this.gain(0.3);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(lp).connect(ng).connect(this.master);
    n.stop(t + 0.6);
  }

  // подиум → пирамида: порыв ветра с песком
  windRush() {
    const T = this.transLayer(1);
    const n = this.noise(true);
    const bp = this.filter("bandpass", 900, 0.7);
    n.connect(bp).connect(this.gain(1.2)).connect(T.out);
    const sub = this.osc("sine", 45);
    sub.connect(this.gain(0.14)).connect(T.out);
    const hiss = this.noise(false);
    const hp = this.filter("highpass", 4200);
    const hg = this.gain(0);
    hiss.connect(hp).connect(hg).connect(T.out);
    T.update = (k) => {
      this.set(bp.frequency, 900 - k * 720, 0.05);
      this.set(sub.frequency, 45 - k * 12, 0.1);
      this.set(hg.gain, k * 0.12, 0.05);
    };
    return T;
  }

  // ---------- управление ----------
  toggle() {
    this.ensure();
    this.on = !this.on;
    clearTimeout(this.sleepTimer);
    this.ctx.resume();
    this.set(this.master.gain, this.on ? 0.8 : 0, 0.4);
    if (!this.on) this.sleepTimer = setTimeout(() => !this.on && this.ctx.suspend(), 2000);
    return this.on;
  }

  blip() { if (this.on) this.layers.artifacts.blip(); }
  morph() { if (this.on) this.layers.podium.morph(); }

  // вызывается каждый кадр: веса сцен и текущий переход
  update(state) {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [name, L] of Object.entries(this.layers)) {
      const w = state.weights[name] ?? 0;
      this.set(L.out.gain, w * L.level, 0.12);
      if (w > 0.02) L.update?.(state, w, now);
    }
    const motion = 0.65 + Math.min(Math.abs(state.velocity), 2) * 0.2;
    this.trans.forEach((T, i) => {
      const active = state.trans && state.trans.index === i;
      const k = active ? state.trans.k : 0;
      const peak = active ? Math.sin(Math.PI * k) : 0;
      this.set(T.out.gain, peak * T.level * motion, 0.05);
      if (active) T.update(k, peak, now);
    });
  }
}
