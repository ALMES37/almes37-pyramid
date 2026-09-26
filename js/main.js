// Главный файл: рендер, бесконечная прокрутка по сценам, переходы, интерфейс, звук.
import * as THREE from "./vendor/three/three.module.js";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "./vendor/three/addons/postprocessing/ShaderPass.js";
import { SceneMixPass, FinalShader } from "./post.js";
import { createHeroScene } from "./scenes/hero.js";
import { createArtifactsScene } from "./scenes/artifacts.js";
import { createSquaresScene } from "./scenes/squares.js";
import { createPodiumScene } from "./scenes/podium.js";
import { damp, clamp, lerp } from "./lib/noise.js";
import { scramble } from "./lib/scramble.js";
import { SoundEngine } from "./sound.js";

const $ = (s) => document.querySelector(s);
const mobile = matchMedia("(max-width: 720px), (pointer: coarse)").matches;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
// ждём кадр, но не дольше 60 мс — чтобы загрузка не зависала в фоновой вкладке
const nextFrame = () => new Promise((r) => {
  let done = false;
  const finish = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 60);
});

// заставка загрузки: строка из ячеек — заполненные блоки, мигающие символы и штрихи
const loader = $("#loader");
const CELLS = 12;
const cellsEl = $("#loaderCells");
cellsEl.innerHTML = "<i></i>".repeat(CELLS);
const cellEls = [...cellsEl.children];
let loadP = 0;
function drawCells() {
  const filled = Math.floor(loadP * CELLS);
  cellEls.forEach((c, i) => {
    const glitch = i >= filled && i < filled + 2 && Math.random() < 0.55;
    c.className = i < filled ? "" : glitch ? "is-glitch" : "is-dash";
  });
}
const cellsTimer = setInterval(drawCells, 90);
function setLoad(p) {
  loadP = p;
  drawCells();
  $("#loaderPct").textContent = `Загрузка ${Math.round(p * 100)}%`;
}
function fail(msg) {
  clearInterval(cellsTimer);
  cellsEl.textContent = msg;
}
const inIntro = () => document.body.classList.contains("is-intro");

const palette = {
  haze: new THREE.Color("#c2b196"),
  hazeDeep: new THREE.Color("#ab9d86"),
  hazeLight: new THREE.Color("#d6cab4"),
  podium: new THREE.Color("#85775f"),
  podiumFloor: new THREE.Color("#a39178"),
  sandLight: new THREE.Color("#ead6ae"),
  sandDark: new THREE.Color("#ab8b62"),
  stoneLight: new THREE.Color("#e0c9a0"),
  stoneDark: new THREE.Color("#8d7253"),
  dust: new THREE.Color("#f3e5c8"),
  bone: new THREE.Color("#f6efe1"),
  umber: new THREE.Color("#3a2d21"),
  gold: new THREE.Color(1.0, 0.58, 0.18).multiplyScalar(2.4),
  sun: new THREE.Color(1.0, 0.9, 0.76).multiplyScalar(1.75),
  sunDir: new THREE.Vector3(-0.85, 0.42, 0.3).normalize(),
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $("#gl"), antialias: false, powerPreference: "high-performance" });
} catch (e) {
  fail("Браузер не поддерживает WebGL");
  throw e;
}
const PR = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const composer = new EffectComposer(renderer);
composer.setPixelRatio(PR);
composer.setSize(innerWidth, innerHeight);
const mixPass = new SceneMixPass(innerWidth * PR, innerHeight * PR, { samples: mobile ? 0 : 4, haze: palette.hazeLight });
mixPass.material.uniforms.uGlitch.value = reduced ? 0.15 : 1;
composer.addPass(mixPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass(FinalShader);
finalPass.uniforms.uRes.value.set(innerWidth * PR, innerHeight * PR);
composer.addPass(finalPass);

// ---------- ввод ----------
// down — кнопка зажата, pressed — нажали в этом кадре, dragX — сдвиг мыши по X за кадр
const input = { ndc: new THREE.Vector2(), active: false, weight: 1, down: false, pressed: false, dragX: 0 };
let dragDist = 0;
const sound = new SoundEngine();
let target = 0;
let current = 0;
let velocity = 0;

const SEQ = [];
let TOTAL = 0;
let scenes = {};

function buildTimeline(list) {
  let acc = 0;
  for (const item of list) {
    item.start = acc;
    acc += item.len + item.trans;
    SEQ.push(item);
  }
  TOTAL = acc;
}

function resolve(p) {
  const w = ((p % TOTAL) + TOTAL) % TOTAL;
  for (let i = 0; i < SEQ.length; i++) {
    const seg = SEQ[i];
    const local = w - seg.start;
    if (local < seg.len + seg.trans) {
      if (local < seg.len) return { a: seg, ua: local / seg.len, b: null, ub: 0, k: 0, w };
      const next = SEQ[(i + 1) % SEQ.length];
      const k = (local - seg.len) / seg.trans;
      return { a: seg, ua: local / seg.len, b: next, ub: -(seg.trans - (local - seg.len)) / next.len, k, w };
    }
  }
  return { a: SEQ[0], ua: 0, b: null, ub: 0, k: 0, w };
}

function goTo(name) {
  const seg = SEQ.find((s) => s.s.name === name);
  if (!seg) return;
  const base = Math.floor(current / TOTAL) * TOTAL + seg.start + (name === "hero" ? 0 : seg.len * 0.15);
  const options = [base - TOTAL, base, base + TOTAL];
  target = options.reduce((best, v) => (Math.abs(v - current) < Math.abs(best - current) ? v : best));
}

addEventListener("wheel", (e) => {
  e.preventDefault();
  if (inIntro()) return; // во время заставки прокрутка ждёт
  let dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
  dy = clamp(dy, -140, 140);
  target += (dy / innerHeight) * 0.85;
}, { passive: false });

let touchY = null;
addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener("touchmove", (e) => {
  if (touchY === null || inIntro()) return;
  if (activeCapture()) { touchY = e.touches[0].clientY; return; } // крутим артефакт — страницу не листаем
  const y = e.touches[0].clientY;
  target += ((touchY - y) / innerHeight) * 1.7;
  touchY = y;
}, { passive: true });
addEventListener("touchend", () => { touchY = null; setTimeout(() => { input.active = false; }, 400); });

addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea") || inIntro()) return;
  const map = { ArrowDown: 0.45, ArrowUp: -0.45, PageDown: 1, PageUp: -1, " ": 1 };
  if (e.key in map) { e.preventDefault(); target += e.shiftKey && e.key === " " ? -1 : map[e.key]; }
  if (e.key === "Home") goTo("hero");
});

const canvas = $("#gl");
let lastPX = 0;
const setPointer = (e) => {
  input.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  input.active = true;
};
canvas.addEventListener("pointermove", (e) => {
  setPointer(e);
  if (input.down) {
    input.dragX += e.clientX - lastPX;
    dragDist += Math.abs(e.clientX - lastPX);
  }
  lastPX = e.clientX;
});
canvas.addEventListener("pointerdown", (e) => {
  setPointer(e);
  input.down = true;
  input.pressed = true;
  dragDist = 0;
  lastPX = e.clientX;
  canvas.setPointerCapture?.(e.pointerId);
});
const release = () => { input.down = false; };
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", () => { if (!input.down) input.active = false; });

function activeCapture() {
  return Object.values(scenes).some((s) => s.capturing);
}

document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => goTo(b.dataset.go)));
$("#brand").addEventListener("click", (e) => { e.preventDefault(); goTo("hero"); });

// ---------- звук: у каждой сцены и перехода свой (см. sound.js) ----------
$("#sound").addEventListener("click", () => {
  const on = sound.toggle();
  $("#sound").setAttribute("aria-pressed", String(on));
  scramble($("#soundLabel"), on ? "Звук: вкл" : "Звук: выкл", 500, () => sound.typeTick());
});

// при наведении текст «печатается» заново — со звуком клавиш
const typeTargets = ".brand, #soundLabel, .rail button, .models button, .credit a, .contact__text a, .kicker";
document.querySelectorAll(typeTargets).forEach((el) => {
  el.addEventListener("pointerenter", () => scramble(el, el.dataset.text ?? el.textContent, 550, () => sound.typeTick()));
});

// ---------- интерфейс по сценам ----------
const uiRules = {
  hero: (n, u) => n === "hero" && u > -0.15 && u < 0.5,
  artifacts: (n) => n === "artifacts",
  squares: (n, u) => n === "squares" && u > 0.08 && u < 0.7,
  podium: (n, u) => n === "podium" && u > -0.05 && u < 0.7,
};
const fadeEls = [...document.querySelectorAll("[data-show]")];
const railBtns = [...document.querySelectorAll("[data-go]")];
let lastDominant = "";

function updateUI(r) {
  const dom = r.b && r.k > 0.5 ? r.b : r.a;
  const du = r.b && r.k > 0.5 ? r.ub : r.ua;
  const name = dom.s.name;
  for (const el of fadeEls) {
    const on = uiRules[el.dataset.show]?.(name, du) ?? false;
    if (on && !el.classList.contains("is-on")) {
      const toScramble = el.querySelectorAll("[data-scramble]");
      toScramble.forEach((n) => scramble(n, n.dataset.text ?? n.textContent, 1100, () => sound.typeTick()));
    }
    el.classList.toggle("is-on", on);
  }
  if (name !== lastDominant) {
    document.body.dataset.scene = name;
    railBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.go === name));
    lastDominant = name;
  }
  $("#railFill").style.width = `${((r.w / TOTAL) * 100).toFixed(2)}%`;
  document.body.classList.toggle("is-hovering", !!dom.s.hovering);
  document.body.classList.toggle("is-grab", dom.s.cursor === "grab");
  document.body.classList.toggle("is-grabbing", dom.s.cursor === "grabbing");
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  finalPass.uniforms.uRes.value.set(w * PR, h * PR);
  for (const s of Object.values(scenes)) {
    s.camera.userData.baseFov ??= s.camera.fov;
    s.camera.aspect = w / h;
    s.camera.fov = s.camera.userData.baseFov * (w / h < 1 ? 1.45 : 1);
    s.camera.updateProjectionMatrix();
  }
  scenes.artifacts?.measure();
}
addEventListener("resize", onResize);

// ---------- запуск ----------
async function boot() {
  setLoad(0.08);
  await nextFrame();
  const ctx = { renderer, palette, mobile, reduced };
  scenes.hero = createHeroScene({ ...ctx, hudRoot: $("#pyrHud"), hudSvg: $("#pyrSvg") });
  setLoad(0.35);
  await nextFrame();
  scenes.artifacts = createArtifactsScene({ ...ctx, hudRoot: $("#hud"), hudSvg: $("#hudSvg"), onReveal: () => sound.blip() });
  setLoad(0.55);
  await nextFrame();
  scenes.squares = createSquaresScene(ctx);
  setLoad(0.7);
  await nextFrame();
  const modelBtns = [...document.querySelectorAll("[data-model]")];
  scenes.podium = createPodiumScene({
    ...ctx,
    onModelChange: (i) => {
      modelBtns.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.model === i)));
      sound.morph();
    },
  });
  modelBtns.forEach((b) => b.addEventListener("click", () => scenes.podium.setModel(+b.dataset.model)));
  setLoad(0.88);
  await nextFrame();

  buildTimeline([
    { s: scenes.hero, len: 2.2, trans: 0.9, bloom: 0.45 },
    { s: scenes.artifacts, len: 4.2, trans: 0.8, bloom: 0.26 },
    { s: scenes.squares, len: 2.4, trans: 0.7, bloom: 0.7 },
    { s: scenes.podium, len: 2.4, trans: 1.0, bloom: 0.55 },
  ]);
  for (const s of Object.values(scenes)) {
    s.setPixelRatio?.(PR);
    renderer.compile(s.scene, s.camera);
  }
  onResize();

  // «прогрев»: один кадр каждой сцены и перехода, пока виден экран загрузки,
  // чтобы шейдеры не компилировались посреди прокрутки
  for (let i = 0; i < SEQ.length; i++) {
    const a = SEQ[i].s, b = SEQ[(i + 1) % SEQ.length].s;
    input.weight = 1;
    a.update(0.3, 1 / 60, 0, input);
    b.update(-0.1, 1 / 60, 0, input);
    mixPass.a = a;
    mixPass.b = b;
    mixPass.mix = 0.5;
    composer.render(1 / 60);
    setLoad(0.88 + ((i + 1) / SEQ.length) * 0.1);
    await nextFrame();
  }
  scenes.artifacts.hideHud();
  scenes.hero.hideHud();
  canvas.addEventListener("click", () => {
    if (dragDist > 6) return; // это было вращение, а не клик
    const r = resolve(current);
    const dom = r.b && r.k > 0.5 ? r.b : r.a;
    dom.s.click?.();
  });

  // для проверки: откройте сайт с ?debug и вызовите almes.go(число экранов)
  if (new URLSearchParams(location.search).has("debug")) {
    window.almes = {
      go: (v) => { target = current = v; },
      // прокрутить время вручную (для проверки без живой анимации)
      advance: (seconds = 1, step = 1 / 30) => { for (let s = 0; s < seconds; s += step) frame(step); },
      pause: (v = true) => { paused = v; },
      replayIntro: () => {
        target = current = 0;
        scenes.hero.restartIntro();
        introPending = true;
        document.body.classList.add("is-intro");
      },
      get progress() { return current; },
      total: TOTAL,
      scenes,
    };
  }

  setLoad(1);
  await new Promise((res) => setTimeout(res, 350)); // полная строка ячеек держится мгновение
  clearInterval(cellsTimer);
  tick();
  await nextFrame();
  loader.classList.add("is-done");
  scenes.hero.start();
}

const clock = new THREE.Clock();
let time = 0;
let hudHidden = true;
let introPending = true;
let paused = false; // только для проверки через ?debug
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (!paused) frame(dt);
}

function frame(dt) {
  time += dt;
  const prev = current;
  current = damp(current, target, reduced ? 6 : 3.2, dt);
  velocity = damp(velocity, (current - prev) / Math.max(dt, 1e-4), 6, dt);

  const r = resolve(current);
  input.weight = r.b ? 1 - r.k : 1;
  r.a.s.update(r.ua, dt, time, input);
  if (r.b) {
    input.weight = r.k;
    r.b.s.update(r.ub, dt, time, input);
  }

  input.pressed = false;
  input.dragX = 0;

  const artifactsActive = r.a.s === scenes.artifacts || r.b?.s === scenes.artifacts;
  if (!artifactsActive && !hudHidden) scenes.artifacts.hideHud();
  hudHidden = !artifactsActive;
  if (r.a.s !== scenes.hero && r.b?.s !== scenes.hero) scenes.hero.hideHud();

  mixPass.a = r.a.s;
  mixPass.b = r.b ? r.b.s : null;
  mixPass.mix = r.k;
  mixPass.material.uniforms.uTime.value = time;
  bloom.strength = r.b ? lerp(r.a.bloom, r.b.bloom, r.k) : r.a.bloom;
  const peak = r.b ? Math.sin(Math.PI * r.k) : 0;
  finalPass.uniforms.uTime.value = time;
  finalPass.uniforms.uCA.value = 0.0015 + peak * (reduced ? 0.001 : 0.006) + Math.min(Math.abs(velocity), 3) * 0.0008;

  if (sound.on) {
    const weights = { hero: 0, artifacts: 0, squares: 0, podium: 0 };
    weights[r.a.s.name] = r.b ? 1 - r.k : 1;
    if (r.b) weights[r.b.s.name] = r.k;
    const uOf = (name) => (r.a.s.name === name ? r.ua : r.b?.s.name === name ? r.ub : 0);
    sound.update({
      weights,
      trans: r.b ? { index: SEQ.indexOf(r.a), k: r.k } : null,
      velocity,
      hero: { open: scenes.hero.open, trail: scenes.hero.trailActivity, move: scenes.hero.move },
      artifacts: { spin: scenes.artifacts.spinSpeed },
      squares: { u: uOf("squares") },
      podium: { agitation: scenes.podium.agitation },
    });
  }

  // конец заставки: интерфейс проявляется, текст «печатается»
  if (introPending && scenes.hero.introProgress >= 0.8) {
    introPending = false;
    document.body.classList.remove("is-intro");
    document.querySelectorAll(".brand, .ui .kicker, .ui [data-scramble], .credit a, #soundLabel").forEach((n, i) => {
      setTimeout(() => scramble(n, n.dataset.text ?? n.textContent, 900, () => sound.typeTick()), i * 90);
    });
  }

  updateUI(r);
  composer.render(dt);
}

boot().catch((e) => {
  console.error(e);
  fail("Не удалось запустить сцену");
});
