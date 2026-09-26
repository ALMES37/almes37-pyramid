// Сцена 4: квадратный подиум и фигура из частиц внутри невидимого вертикального
// «стекла». Стенки видны только там, куда ударяются разогнанные частицы.
// Фигуру можно крутить мышкой вокруг вертикальной оси.
import * as THREE from "../vendor/three/three.module.js";
import { buildModels } from "./point-models.js";
import { createSand } from "./hero-atmos.js";
import { GLSL_NOISE, damp, clamp, mulberry32 } from "../lib/noise.js";

const MAX_IMPACTS = 12;

const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uPulse;
varying vec3 vWorld;
${GLSL_NOISE}
void main(){
  float n = fbm2(vWorld.xz * 0.5);
  float grit = vnoise2(vWorld.xz * 14.0);
  vec3 col = uBase * (0.78 + 0.3 * n + 0.08 * grit);
  float d = max(abs(vWorld.x), abs(vWorld.z));
  float lines = 0.0;
  for (int i = 0; i < 6; i++) {
    float r = 4.4 + pow(float(i), 1.45) * 2.6;
    lines += smoothstep(0.03, 0.0, abs(d - r));
  }
  float wave = mod(uTime * 2.6, 26.0);
  float pulse = smoothstep(1.2, 0.0, abs(d - wave)) * (1.0 - wave / 26.0);
  col += uLine * lines * (0.35 + pulse * 1.6 + uPulse * 0.8);
  float dist = length(cameraPosition - vWorld);
  col = mix(col, uFog, clamp(1.0 - exp(-dist * uFogDensity), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

// стекло: полностью прозрачное, светится только вокруг точек удара
const GLASS_FRAG = /* glsl */ `
uniform vec4 uImp[${MAX_IMPACTS}];
uniform vec3 uHalf;
uniform vec3 uColor;
varying vec3 vL;
void main(){
  float glow = 0.0;
  for (int i = 0; i < ${MAX_IMPACTS}; i++) {
    float s = uImp[i].w;
    if (s <= 0.001) continue;
    float d = distance(vL, uImp[i].xyz);
    float r = 0.3 + (1.0 - s) * 1.2; // кольцо расходится, пока удар затухает
    glow += s * (smoothstep(r, 0.0, d) * 0.55 + smoothstep(0.07, 0.0, abs(d - r)) * 0.9);
  }
  if (glow < 0.004) discard;
  vec3 q = abs(vL) / uHalf;
  float mx = max(q.x, max(q.y, q.z));
  float mn = min(q.x, min(q.y, q.z));
  float mid = q.x + q.y + q.z - mx - mn;
  float edge = smoothstep(0.965, 1.0, mid);
  vec3 g = abs(fract(vL * 2.5) - 0.5);
  float grid = smoothstep(0.46, 0.5, max(g.x, max(g.y, g.z)));
  float a = clamp(glow * (0.35 + grid * 0.6 + edge * 1.4), 0.0, 0.95);
  gl_FragColor = vec4(uColor * (1.0 + glow * 0.5), a);
}
`;

export function createPodiumScene({ palette, mobile, reduced, onModelChange }) {
  const scene = new THREE.Scene();
  scene.background = palette.podium.clone();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);

  scene.add(new THREE.HemisphereLight(palette.bone, palette.umber, 1.2));
  const key = new THREE.DirectionalLight(new THREE.Color("#fff1dc"), 1.6);
  key.position.set(-5, 10, 6);
  scene.add(key);

  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: palette.podiumFloor.clone() },
      uLine: { value: new THREE.Color(1.0, 0.92, 0.78) },
      uFog: { value: palette.podium.clone() },
      uFogDensity: { value: 0.03 },
      uPulse: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: FLOOR_FRAG,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ступенчатый подиум
  const stoneMat = new THREE.MeshStandardMaterial({ color: palette.stoneLight.clone().multiplyScalar(0.75), roughness: 0.8 });
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.3, 1.2, 1.0), transparent: true, opacity: 0.7 });
  const tiers = [[7.0, 0.26], [5.9, 0.24], [5.0, 0.18]];
  let y = 0;
  for (const [w, h] of tiers) {
    const g = new THREE.BoxGeometry(w, h, w);
    const m = new THREE.Mesh(g, stoneMat);
    m.position.y = y + h / 2;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    e.position.copy(m.position);
    scene.add(m, e);
    y += h;
  }
  const topY = y;

  const dustBox = new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 10, 16));
  const dust = createSand({ palette, count: mobile ? 700 : 1800, box: dustBox, size: 1.2, wind: 1.4 });
  scene.add(dust.points);

  // ---- частицы ----
  const PS = 1.2; // масштаб фигур
  const BX = 1.95, BZ = 1.95, BY = 5.0; // внутренние границы стекла (в единицах фигуры)
  const FIG_Y = 0.8; // фигура «парит» в середине стекла
  const COUNT = mobile ? 8000 : 16000;
  const models = buildModels(COUNT);
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  const speed = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  const r = mulberry32(77);
  const first = models[0].points;
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = first[i * 3] + (r() - 0.5) * 0.4;
    pos[i * 3 + 1] = first[i * 3 + 1] + FIG_Y + (r() - 0.5) * 0.4;
    pos[i * 3 + 2] = first[i * 3 + 2] + (r() - 0.5) * 0.4;
    seed[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: 1 }, uTime: { value: 0 }, uGold: { value: palette.gold.clone() } },
    vertexShader: /* glsl */ `
      uniform float uPR, uTime; attribute float aSpeed; attribute float aSeed; varying float vS; varying float vTw;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (2.0 + aSeed * 2.0 + aSpeed * 0.5) * uPR * (13.0 / max(-mv.z, 0.5));
        vS = clamp(aSpeed / 5.0, 0.0, 1.0);
        vTw = 0.8 + 0.2 * sin(uTime * 4.0 + aSeed * 60.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; varying float vS; varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        vec3 c = mix(vec3(1.3, 1.24, 1.15), uGold * 1.1, vS);
        gl_FragColor = vec4(c * vTw, smoothstep(0.5, 0.12, d));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const particles = new THREE.Points(geo, pMat);
  particles.position.y = topY;
  particles.scale.setScalar(PS);
  particles.frustumCulled = false;
  scene.add(particles);

  // ---- невидимое стекло: вертикальный параллелепипед ----
  const gHalf = new THREE.Vector3(BX * PS + 0.04, (BY * PS) / 2 + 0.04, BZ * PS + 0.04);
  const impacts = Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4(0, 0, 0, 0));
  let impactCursor = 0;
  const glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uImp: { value: impacts },
      uHalf: { value: gHalf },
      uColor: { value: new THREE.Color(1.15, 1.08, 0.95) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vL;
      void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(gHalf.x * 2, gHalf.y * 2, gHalf.z * 2), glassMat);
  glass.position.y = topY + gHalf.y;
  glass.renderOrder = 3;
  scene.add(glass);

  // запомнить удар частицы о стенку (координаты — относительно центра стекла)
  function addImpact(px, py, pz, strength) {
    const slot = impacts[impactCursor];
    slot.set(px * PS, py * PS - gHalf.y, pz * PS, Math.min(1, strength));
    impactCursor = (impactCursor + 1) % MAX_IMPACTS;
  }

  let current = 0;
  let lastSwitch = 0;
  let userPicked = false;
  function setModel(i, fromUser = false) {
    current = (i + models.length) % models.length;
    if (fromUser) userPicked = true;
    lastSwitch = performance.now();
    for (let k = 0; k < COUNT; k++) {
      vel[k * 3] += (r() - 0.5) * 6;
      vel[k * 3 + 1] += r() * 5;
      vel[k * 3 + 2] += (r() - 0.5) * 6;
    }
    onModelChange?.(current);
  }

  const raycaster = new THREE.Raycaster();
  const inv = new THREE.Matrix4();
  const ro = new THREE.Vector3();
  const rd = new THREE.Vector3();
  const par = new THREE.Vector2();
  let pulse = 0;
  let pointerIn = false;
  let agitation = 0;
  let rotY = 0;
  let spinVel = 0;
  let grabbing = false;
  let overGlass = false;

  function update(u, dt, t, input) {
    const step = Math.min(dt, 1 / 30);
    par.x = damp(par.x, input.ndc.x, 2, dt);
    par.y = damp(par.y, input.ndc.y, 2, dt);

    const before = Math.max(-u, 0);
    const after = Math.max(u - 0.62, 0);
    const orbit = t * 0.04 + par.x * 0.2;
    const dist = 13.5 + before * 18 + after * 36;
    const height = 7.2 + before * 30 + after * 34 - par.y * 0.8;
    camera.position.set(Math.sin(orbit) * dist, height, Math.cos(orbit) * dist);
    camera.lookAt(0, topY + 3.0 - after * 2, 0);
    camera.updateMatrixWorld();
    floorMat.uniforms.uFogDensity.value = 0.026 + before * 0.05 + after * 0.05;

    if (!userPicked && performance.now() - lastSwitch > 9000 && Math.abs(u - 0.3) < 0.5) setModel(current + 1);

    particles.updateMatrixWorld();
    inv.copy(particles.matrixWorld).invert();
    pointerIn = input.active && input.weight > 0.5;
    overGlass = false;
    if (pointerIn) {
      raycaster.setFromCamera(input.ndc, camera);
      overGlass = raycaster.intersectObject(glass, false).length > 0;
      ro.copy(raycaster.ray.origin).applyMatrix4(inv);
      rd.copy(raycaster.ray.direction).transformDirection(inv);
    }

    // вращение мышкой: зажать на стекле и тянуть влево-вправо
    if (input.pressed && overGlass) grabbing = true;
    if (!input.down || input.weight < 0.5) grabbing = false;
    if (grabbing) {
      const turn = input.dragX * 0.01;
      rotY += turn;
      spinVel = damp(spinVel, turn / Math.max(dt, 1 / 120), 14, dt);
    } else {
      spinVel *= Math.exp(-2.2 * dt);
      rotY += spinVel * dt;
    }
    rotY += dt * (grabbing ? 0 : 0.18);

    // фигура вращается: крутим цели, а не объект — стекло остаётся на месте
    const tgt = models[current].points;
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    const R = 0.95, R2 = R * R;
    const push = reduced ? 20 : 60;
    const spring = 9, drag = Math.exp(-4.2 * step);
    const wob = reduced ? 0 : 0.35;
    const bounce = 0.4;
    let speedSum = 0;
    let hitsThisFrame = 0;
    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      const tx = tgt[i3] * ca - tgt[i3 + 2] * sa;
      const tz = tgt[i3] * sa + tgt[i3 + 2] * ca;
      let ax = (tx - px) * spring;
      let ay = (tgt[i3 + 1] + FIG_Y - py) * spring;
      let az = (tz - pz) * spring;
      ax += Math.sin(t * 1.3 + seed[i] * 40) * wob;
      ay += Math.cos(t * 1.1 + seed[i] * 31) * wob;
      if (pointerIn) {
        const vx = px - ro.x, vy = py - ro.y, vz = pz - ro.z;
        const tt = vx * rd.x + vy * rd.y + vz * rd.z;
        const dx = vx - rd.x * tt, dy = vy - rd.y * tt, dz = vz - rd.z * tt;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R2) {
          const d = Math.sqrt(d2) + 1e-4;
          const f = ((1 - d / R) * push) / d;
          ax += dx * f; ay += dy * f; az += dz * f;
        }
      }
      let vx = (vel[i3] + ax * step) * drag;
      let vy = (vel[i3 + 1] + ay * step) * drag;
      let vz = (vel[i3 + 2] + az * step) * drag;
      let nx = px + vx * step, ny = py + vy * step, nz = pz + vz * step;
      // стенки стекла: частица отскакивает, а в месте удара стекло вспыхивает
      let hit = 0;
      if (nx < -BX) { hit = Math.abs(vx); nx = -BX; vx = Math.abs(vx) * bounce; } else if (nx > BX) { hit = Math.abs(vx); nx = BX; vx = -Math.abs(vx) * bounce; }
      if (nz < -BZ) { hit = Math.max(hit, Math.abs(vz)); nz = -BZ; vz = Math.abs(vz) * bounce; } else if (nz > BZ) { hit = Math.max(hit, Math.abs(vz)); nz = BZ; vz = -Math.abs(vz) * bounce; }
      if (ny < 0.02) { hit = Math.max(hit, Math.abs(vy)); ny = 0.02; vy = Math.abs(vy) * bounce; } else if (ny > BY) { hit = Math.max(hit, Math.abs(vy)); ny = BY; vy = -Math.abs(vy) * bounce; }
      if (hit > 0.8 && hitsThisFrame < 3 && r() < 0.25) {
        addImpact(nx, ny, nz, 0.5 + hit * 0.15);
        hitsThisFrame++;
      }
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      pos[i3] = nx; pos[i3 + 1] = ny; pos[i3 + 2] = nz;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      speed[i] = sp;
      speedSum += sp;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSpeed.needsUpdate = true;
    agitation = damp(agitation, clamp((speedSum / COUNT - 0.15) / 1.2, 0, 1), 6, dt);

    // удары затухают сами
    const fade = Math.exp(-2.4 * dt);
    for (const imp of impacts) imp.w = imp.w > 0.002 ? imp.w * fade : 0;

    pulse = damp(pulse, pointerIn ? 1 : 0, 3, dt);
    floorMat.uniforms.uTime.value = t;
    floorMat.uniforms.uPulse.value = pulse;
    pMat.uniforms.uTime.value = t;
    dust.mat.uniforms.uTime.value = t;
    edgeMat.opacity = 0.45 + pulse * 0.4;
  }

  return {
    name: "podium",
    scene,
    camera,
    update,
    setModel: (i) => setModel(i, true),
    click() { setModel(current + 1, true); },
    setPixelRatio(pr) { pMat.uniforms.uPR.value = pr; dust.mat.uniforms.uPR.value = pr; },
    get hovering() { return false; },
    get cursor() { return grabbing ? "grabbing" : overGlass ? "grab" : ""; },
    get capturing() { return grabbing; },
    get agitation() { return agitation; },
  };
}
