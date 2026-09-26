// Сцена 1: пирамида Хеопса в пустыне.
// Заставка: сверху виден светящийся каркас пирамиды в сетке линий с числами,
// камера опускается, каркас превращается в камень, проявляется пустыня.
// Курсор на пирамиде — блоки расходятся только вокруг него, проступают линии и числа.
// Курсор на песке — песок продавливается, след сам исчезает.
import * as THREE from "../vendor/three/three.module.js";
import { createTerrain, rayHitSand } from "./hero-terrain.js";
import { createPyramid } from "./hero-pyramid.js";
import { createSand, createStreaks, createVortex, createDustVeil, createConstructionLines } from "./hero-atmos.js";
import { damp, smoothstep, clamp, lerp } from "../lib/noise.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HOVER_NUMS = 14;
const INTRO_NUMS = 24;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createHeroScene({ palette, mobile, reduced, renderer, hudRoot, hudSvg }) {
  const INTRO = reduced ? 2.2 : 6.2; // длительность заставки, секунды
  const scene = new THREE.Scene();
  scene.background = palette.haze.clone();
  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 700);

  const terrain = createTerrain({ palette, mobile, renderer });
  scene.add(terrain.mesh);

  const pyr = createPyramid({ palette });
  pyr.group.rotation.y = 0.62;
  scene.add(pyr.group);
  pyr.group.updateMatrixWorld(true);

  // небо: светлый горизонт в дымке, солнце за пеленой
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: palette.haze.clone() },
        uZenith: { value: palette.haze.clone().multiplyScalar(0.72) },
        uSun: { value: palette.sun.clone() },
        uSunDir: { value: palette.sunDir.clone() },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon, uZenith, uSun, uSunDir; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, d.y));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(s, 6.0) * 0.12 + pow(s, 60.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  scene.add(sky);

  const windK = reduced ? 0.25 : 1;
  const box = new THREE.Box3(new THREE.Vector3(-48, -1, -48), new THREE.Vector3(48, 22, 42));
  const sand = createSand({ palette, count: mobile ? 2600 : 7000, box, size: 1.6, wind: 3.5 * windK });
  const nearBox = new THREE.Box3(new THREE.Vector3(-16, 1, 8), new THREE.Vector3(16, 16, 38));
  const sandNear = createSand({ palette, count: mobile ? 350 : 900, box: nearBox, size: 3.2, wind: 6 * windK });
  const streaks = createStreaks({ palette, count: mobile ? 220 : 560, box, wind: 22 * windK });
  const vortex = createVortex({ palette, count: mobile ? 1600 : 4200 });
  const veilA = createDustVeil({ palette, radius: 14, height: 6, speed: 0.22 * windK, opacity: 0.32 });
  const veilB = createDustVeil({ palette, radius: 30, height: 11, speed: -0.09 * windK, opacity: 0.26 });
  const construct = createConstructionLines({ count: mobile ? 26 : 44 });
  scene.add(sand.points, sandNear.points, streaks.lines, vortex.points, veilA.mesh, veilB.mesh, construct.lines);
  // базовая прозрачность атмосферы — во время заставки она проявляется из нуля
  const atmos = [sand.mat, sandNear.mat, vortex.mat, veilA.mat, veilB.mat].map((m) => [m, m.uniforms.uOpacity.value]);

  // ---------- HUD: числа у вершин сетки и подпись у курсора ----------
  const nums = Array.from({ length: INTRO_NUMS }, () => {
    const el = document.createElement("span");
    el.className = "phud__num";
    hudRoot.appendChild(el);
    return el;
  });
  const mainLabel = document.createElement("span");
  mainLabel.className = "phud__num is-main";
  hudRoot.appendChild(mainLabel);
  const leader = document.createElementNS(SVG_NS, "polyline");
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("r", "4");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "#f6efe1");
  hudSvg.append(leader, ring);
  const verts = pyr.lattice.verts;
  const vertTags = verts.map((_, i) => String((i * 37 + 11) % 97).padStart(2, "0"));
  const introVerts = Array.from({ length: INTRO_NUMS }, (_, k) => Math.floor(((k + 0.5) / INTRO_NUMS) * verts.length));
  let hudShown = false;

  const raycaster = new THREE.Raycaster();
  const look = new THREE.Vector3();
  const finalPos = new THREE.Vector3();
  const par = new THREE.Vector2();
  const hitTarget = new THREE.Vector3();
  const prevTarget = new THREE.Vector3();
  const hitLocal = new THREE.Vector3(0, -100, 0);
  const hitWorld = new THREE.Vector3();
  const latticeCenter = new THREE.Vector3(0, pyr.height * 0.45, 0);
  const sandPt = new THREE.Vector3();
  const lastSand = new THREE.Vector3();
  const v = new THREE.Vector3();
  const state = {
    introT: 0, started: false, hitAmt: 0, onPyramid: false, wasOnPyramid: false,
    hasLastSand: false, trailAct: 0, move: 0, lastJitter: 0,
  };

  function cameraAt(u, out, target) {
    const k = clamp(u, -0.7, 1.7);
    const before = Math.max(-k, 0);
    out.set(
      Math.sin(k * 0.8) * 5,
      6.6 + k * 11 + before * before * 60,
      32 + k * 26 + before * 30
    );
    target.set(0, 4.3 + k * 2.2 - before * 4, 0);
  }

  // заставка: камера спускается по спирали сверху на обычный ракурс
  function introCamera(c) {
    const off = v.copy(finalPos).sub(look);
    const R0 = off.length();
    const P0 = Math.acos(clamp(off.y / R0, -1, 1));
    const A0 = Math.atan2(off.x, off.z);
    const R = lerp(64, R0, c);
    const P = lerp(0.16, P0, c);
    const A = lerp(A0 + 1.5, A0, c);
    const ty = lerp(pyr.height * 0.35, look.y, c);
    look.y = ty;
    camera.position.set(Math.sin(P) * Math.sin(A) * R, ty + Math.cos(P) * R, Math.sin(P) * Math.cos(A) * R);
  }

  function hideHud() {
    if (!hudShown) return;
    for (const el of nums) el.style.opacity = "0";
    mainLabel.style.opacity = "0";
    leader.style.opacity = "0";
    ring.style.opacity = "0";
    hudShown = false;
  }

  function placeNum(el, vertIndex, opacity, t) {
    v.copy(verts[vertIndex]).applyMatrix4(pyr.group.matrixWorld).project(camera);
    if (v.z > 1) { el.style.opacity = "0"; return; }
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const flick = Math.floor(t * 8);
    el.textContent = (flick + vertIndex) % 23 === 0 ? String((vertIndex * 13 + flick) % 97).padStart(2, "0") : vertTags[vertIndex];
    el.style.transform = `translate3d(${(x + 4).toFixed(1)}px, ${(y - 12).toFixed(1)}px, 0)`;
    el.style.opacity = opacity.toFixed(3);
  }

  function updateHud(t, weight, introNums) {
    const amt = state.hitAmt * weight;
    if (amt < 0.02 && introNums < 0.02) { hideHud(); return; }
    hudShown = true;

    // во время заставки — числа разбросаны по всей сетке
    if (introNums >= 0.02) {
      introVerts.forEach((vi, k) => placeNum(nums[k], vi, introNums * (0.55 + 0.45 * ((k * 7) % 3) / 2), t));
      mainLabel.style.opacity = "0";
      leader.style.opacity = "0";
      ring.style.opacity = "0";
      return;
    }

    const R = 4.6;
    const near = [];
    for (let i = 0; i < verts.length; i++) {
      const d = verts[i].distanceTo(hitLocal);
      if (d < R) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < INTRO_NUMS; k++) {
      if (k >= HOVER_NUMS || k >= near.length) { nums[k].style.opacity = "0"; continue; }
      placeNum(nums[k], near[k][1], (1 - near[k][0] / R) * amt, t);
    }

    // подпись у курсора с выноской
    hitWorld.copy(hitLocal).applyMatrix4(pyr.group.matrixWorld);
    v.copy(hitWorld).project(camera);
    const hx = (v.x * 0.5 + 0.5) * innerWidth, hy = (-v.y * 0.5 + 0.5) * innerHeight;
    const lx = hx + 70, ly = hy - 64;
    if (t - state.lastJitter > 0.12) {
      state.lastJitter = t;
      const lvl = String(clamp(Math.round(hitLocal.y / 0.72) + 1, 1, 13)).padStart(2, "0");
      const blk = String(Math.abs(Math.round(hitLocal.x * 11 + hitLocal.z * 7)) % 300).padStart(3, "0");
      mainLabel.innerHTML = `LVL ${lvl} / BLK ${blk}<br>H ${(hitLocal.y + (Math.random() - 0.5) * 0.02).toFixed(2)} M`;
    }
    mainLabel.style.transform = `translate3d(${lx.toFixed(1)}px, ${(ly - 26).toFixed(1)}px, 0)`;
    mainLabel.style.opacity = amt.toFixed(3);
    leader.setAttribute("points", `${hx.toFixed(1)},${hy.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${(lx + 118).toFixed(1)},${ly.toFixed(1)}`);
    leader.style.opacity = (amt * 0.9).toFixed(3);
    ring.setAttribute("cx", hx.toFixed(1));
    ring.setAttribute("cy", hy.toFixed(1));
    ring.style.opacity = amt.toFixed(3);
  }

  function update(u, dt, t, input) {
    if (state.started) state.introT += dt;
    const k = clamp(state.introT / INTRO, 0, 1);
    const introDone = k >= 1;
    // сборка при возвращении по кругу после последнего слайда
    const assemble = smoothstep(-0.5, 0.05, u);

    // камера
    cameraAt(u, finalPos, look);
    const c = easeInOut(smoothstep(0.06, 0.9, k));
    par.x = damp(par.x, input.ndc.x * c, 2.5, dt);
    par.y = damp(par.y, input.ndc.y * c, 2.5, dt);
    finalPos.x += par.x * 1.6;
    finalPos.y += par.y * 0.8;
    if (introDone) camera.position.copy(finalPos);
    else introCamera(c);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // этапы заставки
    const solid = smoothstep(0.5, 0.86, k);
    const introOpen = smoothstep(0.38, 0.62, k) * (1 - smoothstep(0.8, 1.0, k)) * 0.6;
    const gridAmt = smoothstep(0.04, 0.22, k) * (1 - smoothstep(0.58, 0.84, k));
    const reveal = smoothstep(0.45, 0.95, k);
    const air = smoothstep(0.5, 1.0, k);

    // что под курсором: пирамида или песок
    let onPyramid = false;
    let brush = null;
    let moved = 0;
    const canInteract = introDone && input.active && Math.abs(u) < 0.45 && input.weight > 0.6;
    if (canInteract) {
      raycaster.setFromCamera(input.ndc, camera);
      const hit = assemble > 0.9 ? raycaster.intersectObject(pyr.hitMesh, false)[0] : null;
      if (hit) {
        onPyramid = true;
        hitTarget.copy(hit.point);
        pyr.group.worldToLocal(hitTarget);
        if (state.hitAmt < 0.05) hitLocal.copy(hitTarget);
      } else if (rayHitSand(raycaster.ray, sandPt) && Math.abs(sandPt.x) < 66 && Math.abs(sandPt.z) < 66) {
        if (state.hasLastSand && lastSand.distanceTo(sandPt) < 8) {
          moved = lastSand.distanceTo(sandPt);
          brush = { fromX: lastSand.x, fromZ: lastSand.z, toX: sandPt.x, toZ: sandPt.z };
        } else {
          brush = { fromX: sandPt.x, fromZ: sandPt.z, toX: sandPt.x, toZ: sandPt.z };
        }
        lastSand.copy(sandPt);
        state.hasLastSand = true;
      }
    }
    if (!brush) state.hasLastSand = false;
    // скорость курсора по пирамиде — для звука стука блоков
    const hitMove = onPyramid && state.wasOnPyramid ? hitTarget.distanceTo(prevTarget) / Math.max(dt, 1e-3) : 0;
    prevTarget.copy(hitTarget);
    state.wasOnPyramid = onPyramid;
    state.move = damp(state.move, hitMove, 10, dt);
    state.onPyramid = onPyramid;
    state.trailAct = damp(state.trailAct, clamp((moved / Math.max(dt, 1e-3)) * 0.06, 0, 1), 8, dt);
    terrain.stepTrail(dt, brush);

    // блоки расходятся вокруг курсора, остальные собираются обратно
    if (onPyramid) hitLocal.lerp(hitTarget, 1 - Math.exp(-11 * dt));
    state.hitAmt = damp(state.hitAmt, onPyramid ? 1 : 0, onPyramid ? 5 : 2.6, dt);
    const open = state.hitAmt;

    const fog = 0.011 + Math.max(0, u - 0.55) * 0.035 + Math.max(0, -u) * 0.04;

    const bu = pyr.blockMat.uniforms;
    bu.uTime.value = t;
    bu.uAssemble.value = assemble;
    bu.uHit.value.copy(hitLocal);
    bu.uHitAmt.value = open;
    bu.uFogDensity.value = fog;
    bu.uSolid.value = solid;
    bu.uIntroOpen.value = introOpen;
    hitWorld.copy(hitLocal).multiplyScalar(0.55).applyMatrix4(pyr.group.matrixWorld);
    bu.uCoreW.value.copy(open > 0.01 ? hitWorld : latticeCenter);

    // сетка линий: во время заставки видна целиком, потом — только у курсора
    const lu = pyr.lattice.mat.uniforms;
    if (gridAmt > 0.001) {
      lu.uHit.value.copy(latticeCenter);
      lu.uRadius.value = 40;
      lu.uAmt.value = gridAmt * 0.8;
    } else {
      lu.uHit.value.copy(hitLocal);
      lu.uRadius.value = 4.5;
      lu.uAmt.value = open * 0.95;
    }
    lu.uTime.value = t;

    pyr.coreMat.uniforms.uTime.value = t;
    pyr.coreMat.uniforms.uGlow.value = 0.2 + open * 0.9 + (1 - solid) * smoothstep(0.05, 0.3, k) * 0.35;
    pyr.halo.position.copy(hitLocal).multiplyScalar(0.6);
    pyr.halo.material.opacity = open * 0.35;
    pyr.halo.scale.setScalar(7 + Math.sin(t * 2) * 0.3);

    pyr.lineMat.uniforms.uDraw.value = smoothstep(0.0, 0.3, k);
    pyr.lineMat.uniforms.uAlpha.value = Math.max(
      0.85 * (1 - smoothstep(0.55, 0.85, k)) * smoothstep(0.0, 0.05, k),
      0.75 * (1 - smoothstep(0.55, 1, assemble))
    ) + 0.12 * open;

    const tu = terrain.material.uniforms;
    tu.uTime.value = t;
    tu.uGlow.value = open * 0.3;
    tu.uCoreW.value.copy(hitWorld);
    tu.uFogDensity.value = fog;
    tu.uReveal.value = reveal;

    for (const [m, base] of atmos) m.uniforms.uOpacity.value = base * air;
    const storm = 1 + open * 1.0 + (1 - assemble) * 1.5 + (1 - air) * 1.2;
    sand.mat.uniforms.uTime.value = t;
    sandNear.mat.uniforms.uTime.value = t;
    streaks.mat.uniforms.uTime.value = t;
    streaks.mat.uniforms.uOpacity.value = (0.3 + (1 - assemble) * 0.4) * air;
    vortex.mat.uniforms.uTime.value = t;
    vortex.mat.uniforms.uStorm.value = storm;
    veilA.mat.uniforms.uTime.value = t;
    veilA.mat.uniforms.uStorm.value = storm;
    veilB.mat.uniforms.uTime.value = t;
    construct.mat.uniforms.uTime.value = t;
    construct.mat.uniforms.uAmount.value = 0.12 + (1 - assemble) * 0.55 + open * 0.15 + gridAmt * 0.7;
    construct.lines.scale.setScalar(0.55 + 0.45 * smoothstep(0.0, 0.7, k));
    construct.lines.rotation.y = t * 0.02 + (1 - c) * 0.8;

    updateHud(t, input.weight, gridAmt * input.weight);
  }

  function setPixelRatio(pr) {
    sand.mat.uniforms.uPR.value = pr;
    sandNear.mat.uniforms.uPR.value = pr;
    vortex.mat.uniforms.uPR.value = pr;
  }

  return {
    name: "hero",
    scene,
    camera,
    update,
    setPixelRatio,
    hideHud,
    start() { state.started = true; },
    restartIntro() { state.introT = 0; },
    get introProgress() { return clamp(state.introT / INTRO, 0, 1); },
    get hovering() { return state.onPyramid; },
    get open() { return state.hitAmt; },
    get move() { return state.move; },
    get trailActivity() { return state.trailAct; },
  };
}
