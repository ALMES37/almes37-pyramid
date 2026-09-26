// Пирамида из каменных блоков. Под курсором блоки расходятся только в небольшой
// области: швы и внутренние грани загораются золотом, вокруг проступает сетка линий.
// Когда курсор уходит, блоки сами встают на место.
import * as THREE from "../vendor/three/three.module.js";
import { GLSL_NOISE, mulberry32 } from "../lib/noise.js";

export const PYR = { layers: 13, bw: 1.0, bh: 0.72 };

const BLOCK_VERT = /* glsl */ `
uniform float uAssemble;
uniform float uTime;
uniform vec3 uHit;      // точка под курсором в координатах пирамиды
uniform float uHitAmt;
uniform float uRadius;
uniform float uIntroOpen; // лёгкое раскрытие всех блоков во время заставки
attribute vec3 aDir;
attribute vec3 aAxis;
attribute vec4 aRand;
attribute float aLayer;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vOpen;
varying vec4 vRand;

mat3 rotAxis(vec3 axis, float a){
  float s = sin(a), c = cos(a), oc = 1.0 - c;
  return mat3(oc*axis.x*axis.x + c,        oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
              oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z + axis.x*s,
              oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
}

void main(){
  // сборка снизу вверх, с небольшим разбросом
  float s = clamp(uAssemble * 1.8 - aLayer * 0.6 - aRand.x * 0.2, 0.0, 1.0);
  s = s * s * (3.0 - 2.0 * s);
  float scatter = 1.0 - s;

  // раскрытие только рядом с курсором
  vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float d = distance(center, uHit);
  float local = uHitAmt * smoothstep(uRadius, uRadius * 0.2, d);
  float localOpen = local * (0.75 + 0.5 * aRand.y);
  float introOpen = uIntroOpen * (0.3 + 0.4 * aRand.y);
  float open = localOpen + introOpen;

  float ang = open * (aRand.z - 0.5) * 1.3 + scatter * (aRand.w - 0.5) * 7.0;
  mat3 R = rotAxis(aAxis, ang);
  vec3 p = R * (position * (1.0 - 0.1 * min(open, 1.0)));
  vec3 n = R * normal;

  vec3 away = normalize(center - uHit + aDir * 0.8 + vec3(0.0, 0.001, 0.0));
  vec3 offs = away * localOpen * (0.5 + 0.9 * aRand.x) + aDir * (localOpen * 0.35 + introOpen * (0.4 + 0.6 * aRand.x));
  offs += vec3(0.0, sin(uTime * 1.6 + aRand.y * 6.2831) * 0.08 * min(open, 1.0), 0.0);
  offs += (aDir * 16.0 + vec3((aRand.x - 0.5) * 34.0, 12.0 + aRand.y * 26.0, (aRand.z - 0.5) * 34.0)) * scatter;

  vec4 inst = instanceMatrix * vec4(p, 1.0);
  inst.xyz += offs;
  vec4 wp = modelMatrix * inst;
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vOpen = open + scatter * 0.6;
  vRand = aRand;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BLOCK_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uStoneLight;
uniform vec3 uStoneDark;
uniform vec3 uHaze;
uniform vec3 uGold;
uniform float uFogDensity;
uniform float uTime;
uniform vec3 uCoreW;
uniform float uSolid; // 0 — прозрачный каркас, 1 — камень
uniform float uH;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vOpen;
varying vec4 vRand;
${GLSL_NOISE}

void main(){
  vec3 n = normalize(vNormalW);
  vec3 d = 0.5 - abs(vLocal);
  float mn = min(d.x, min(d.y, d.z));
  float mx = max(d.x, max(d.y, d.z));
  float mid = d.x + d.y + d.z - mn - mx;
  float edge = 1.0 - smoothstep(0.0, 0.06, mid);

  // заставка: сначала светящийся каркас блоков, камень проявляется снизу вверх
  float wire = 1.0 - smoothstep(0.0, 0.035, mid);
  float nz = fbm3(vWorld * 0.5);
  float th = uSolid * 1.5 - 0.25 - (vWorld.y / uH) * 0.35 + (nz - 0.5) * 0.35;
  float solid = smoothstep(0.0, 0.07, th);
  float fill = step(0.82, hash21(floor(gl_FragCoord.xy)));
  if (solid < 0.01 && wire < 0.2 && fill < 0.5) discard;

  float t = fbm3(vLocal * 3.0 + vRand.xyz * 20.0);
  float pits = smoothstep(0.62, 0.7, fbm3(vLocal * 9.0 + vRand.yzx * 13.0));
  vec3 albedo = mix(uStoneDark, uStoneLight, t * 0.8 + vRand.w * 0.25);
  albedo *= 1.0 - edge * 0.3 - pits * 0.18;

  float diff = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uStoneDark * 0.6, uHaze, n.y * 0.5 + 0.5) * 0.42;
  vec3 col = albedo * (amb + uSunColor * diff);

  // свет изнутри: грани, смотрящие на ядро, швы и бегущие полоски
  float open = clamp(vOpen, 0.0, 1.4);
  vec3 toCore = normalize(uCoreW - vWorld);
  float facing = max(dot(n, toCore), 0.0);
  float stripes = smoothstep(0.9, 1.0, sin(vWorld.y * 7.0 - uTime * 3.0) * 0.5 + 0.5);
  float glow = open * (facing * facing * 0.9 + edge * 1.6 + stripes * facing * 1.1);
  col += uGold * glow;

  vec3 ghost = vec3(1.25, 1.22, 1.15) * max(wire, 0.35 * fill);
  float band = (1.0 - abs(solid * 2.0 - 1.0)) * step(0.001, uSolid) * step(uSolid, 0.999);
  col = mix(ghost, col, solid) + uGold * band * 0.7;

  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uHaze, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const CORE_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uGold;
uniform vec3 uWhite;
varying vec3 vWorld;
void main(){
  float scan = smoothstep(0.82, 1.0, sin(vWorld.y * 9.0 - uTime * 3.2) * 0.5 + 0.5);
  float band = smoothstep(0.95, 1.0, sin(vWorld.y * 1.4 - uTime * 1.3) * 0.5 + 0.5);
  float g1 = abs(fract((vWorld.x + vWorld.y) * 1.1) - 0.5);
  float g2 = abs(fract((vWorld.z - vWorld.y) * 1.1) - 0.5);
  float grid = smoothstep(0.44, 0.5, max(g1, g2));
  vec3 col = mix(uGold, uWhite, band * 0.8) * (0.4 + scan * 1.6 + grid * 1.1 + band * 2.8);
  gl_FragColor = vec4(col * uGlow, 1.0);
}
`;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,235,190,.55)");
  grad.addColorStop(0.6, "rgba(255,200,110,.12)");
  grad.addColorStop(1, "rgba(255,200,110,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Сетка треугольников над гранями пирамиды + «шипы» наружу.
// Видна только рядом с курсором — как разметка на оригинале.
function buildLattice(half, H, rand) {
  const rows = 9;
  const lift = 0.45;
  const pts = [];
  const verts = [];
  const apex = new THREE.Vector3(0, H, 0);
  const corners = [
    new THREE.Vector3(-half, 0, half), new THREE.Vector3(half, 0, half),
    new THREE.Vector3(half, 0, -half), new THREE.Vector3(-half, 0, -half),
  ];
  const push = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);

  for (let f = 0; f < 4; f++) {
    const c0 = corners[f], c1 = corners[(f + 1) % 4];
    const normal = new THREE.Vector3().subVectors(c1, c0).cross(new THREE.Vector3().subVectors(apex, c0)).normalize();
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      const a = c0.clone().lerp(apex, r / rows);
      const b = c1.clone().lerp(apex, r / rows);
      const cnt = rows - r;
      for (let s = 0; s <= cnt; s++) {
        const p = cnt === 0 ? a.clone() : a.clone().lerp(b, s / cnt);
        p.addScaledVector(normal, lift + (rand() - 0.5) * 0.5);
        row.push(p);
        verts.push(p);
      }
      grid.push(row);
    }
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < grid[r].length; s++) {
        if (s + 1 < grid[r].length) push(grid[r][s], grid[r][s + 1]);
        if (s < grid[r + 1].length) push(grid[r][s], grid[r + 1][s]);
        if (s - 1 >= 0 && s - 1 < grid[r + 1].length) push(grid[r][s], grid[r + 1][s - 1]);
        if (rand() < 0.22) {
          const tip = grid[r][s].clone().addScaledVector(normal, 0.6 + rand() * 1.6);
          tip.y += (rand() - 0.2) * 0.8;
          push(grid[r][s], tip);
          verts.push(tip);
        }
      }
    }
  }
  const seeds = new Float32Array(pts.length / 3);
  for (let i = 0; i < seeds.length; i += 2) seeds[i] = seeds[i + 1] = rand();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uHit: { value: new THREE.Vector3(0, -100, 0) }, uAmt: { value: 0 }, uRadius: { value: 4.5 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform vec3 uHit; uniform float uRadius, uTime; attribute float aSeed; varying float vA;
      void main(){
        float d = distance(position, uHit);
        float f = step(0.25, fract(sin(aSeed * 91.7 + floor(uTime * 6.0 + aSeed * 5.0)) * 437.58));
        vA = smoothstep(uRadius, uRadius * 0.25, d) * (0.45 + 0.55 * f);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmt; varying float vA;
      void main(){ gl_FragColor = vec4(1.3, 1.22, 1.08, vA * uAmt); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, mat, verts };
}

export function createPyramid({ palette }) {
  const { layers: N, bw, bh } = PYR;
  const rand = mulberry32(42);
  const group = new THREE.Group();

  const items = [];
  for (let L = 0; L < N; L++) {
    const n = N - L;
    const half = (n * bw) / 2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!(i === 0 || j === 0 || i === n - 1 || j === n - 1)) continue;
        items.push({ x: -half + bw * (i + 0.5), y: bh * (L + 0.5), z: -half + bw * (j + 0.5), L });
      }
    }
  }

  const count = items.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aDir = new Float32Array(count * 3);
  const aAxis = new Float32Array(count * 3);
  const aRand = new Float32Array(count * 4);
  const aLayer = new Float32Array(count);
  const H = N * bh;

  const blockMat = new THREE.ShaderMaterial({
    uniforms: {
      uAssemble: { value: 0 },
      uTime: { value: 0 },
      uHit: { value: new THREE.Vector3(0, -100, 0) },
      uHitAmt: { value: 0 },
      uRadius: { value: 3.3 },
      uSunDir: { value: palette.sunDir.clone() },
      uSunColor: { value: palette.sun.clone() },
      uStoneLight: { value: palette.stoneLight.clone() },
      uStoneDark: { value: palette.stoneDark.clone() },
      uHaze: { value: palette.haze.clone() },
      uGold: { value: palette.gold.clone() },
      uFogDensity: { value: 0.012 },
      uCoreW: { value: new THREE.Vector3(0, H * 0.3, 0) },
      uSolid: { value: 1 },
      uH: { value: H },
      uIntroOpen: { value: 0 },
    },
    vertexShader: BLOCK_VERT,
    fragmentShader: BLOCK_FRAG,
  });

  const blocks = new THREE.InstancedMesh(geo, blockMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  items.forEach((it, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.05);
    s.set(bw * (0.94 + rand() * 0.05), bh * (0.92 + rand() * 0.06), bw * (0.94 + rand() * 0.05));
    m.compose(v.set(it.x, it.y, it.z), q, s);
    blocks.setMatrixAt(k, m);

    const out = new THREE.Vector3(it.x, 0, it.z);
    if (out.lengthSq() < 0.01) out.set(0, 1, 0);
    else out.normalize().setY(0.3 + (it.L / N) * 0.6).normalize();
    aDir.set([out.x, out.y, out.z], k * 3);
    const ax = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    aAxis.set([ax.x, ax.y, ax.z], k * 3);
    aRand.set([rand(), rand(), rand(), rand()], k * 4);
    aLayer[k] = it.L / (N - 1);
  });
  geo.setAttribute("aDir", new THREE.InstancedBufferAttribute(aDir, 3));
  geo.setAttribute("aAxis", new THREE.InstancedBufferAttribute(aAxis, 3));
  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(aRand, 4));
  geo.setAttribute("aLayer", new THREE.InstancedBufferAttribute(aLayer, 1));
  blocks.frustumCulled = false;
  group.add(blocks);

  // светящееся ядро внутри
  const coreH = (N - 1.4) * bh;
  const coreHalf = ((N - 2.2) * bw) / 2;
  const coreGeo = new THREE.ConeGeometry(coreHalf * Math.SQRT2, coreH, 4, 1, true);
  coreGeo.rotateY(Math.PI / 4);
  coreGeo.translate(0, coreH / 2, 0);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlow: { value: 0.3 },
      uGold: { value: palette.gold.clone() },
      uWhite: { value: new THREE.Color(1.6, 1.45, 1.2) },
    },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color: palette.gold.clone().multiplyScalar(1.4),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
  }));
  halo.position.set(0, H * 0.32, 0);
  halo.scale.setScalar(8);
  group.add(halo);

  // чертёж: контур пирамиды и ярусы, «рисуются» при сборке
  const half = (N * bw) / 2;
  const segs = [];
  const A = [0, H + 0.4, 0];
  const corners = [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]];
  for (let i = 0; i < 4; i++) {
    segs.push(corners[i], corners[(i + 1) % 4]);
    segs.push(corners[i], A);
  }
  for (let L = 2; L < N; L += 2) {
    const h2 = ((N - L) * bw) / 2 + 0.02;
    const y = L * bh;
    const c = [[-h2, y, -h2], [h2, y, -h2], [h2, y, h2], [-h2, y, h2]];
    for (let i = 0; i < 4; i++) segs.push(c[i], c[(i + 1) % 4]);
  }
  for (let i = 0; i < 4; i++) {
    const [x, , z] = corners[i];
    segs.push([x * 1.35, 0, z * 1.35], [x * 1.35, H * 0.9, z * 1.35]);
    segs.push([x * 1.35, 0, z * 1.35], [x, 0, z]);
  }
  const linePos = new Float32Array(segs.length * 3);
  const lineT = new Float32Array(segs.length);
  segs.forEach((p, i) => {
    linePos.set(p, i * 3);
    lineT[i] = Math.floor(i / 2) / (segs.length / 2);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("aT", new THREE.BufferAttribute(lineT, 1));
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uDraw: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1.2, 1.15, 1.05) } },
    vertexShader: /* glsl */ `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uDraw, uAlpha; uniform vec3 uColor; varying float vT;
      void main(){ float on = step(vT, uDraw); if (on < 0.5) discard; gl_FragColor = vec4(uColor, uAlpha); }`,
    transparent: true,
    depthWrite: false,
  });
  const blueprint = new THREE.LineSegments(lineGeo, lineMat);
  group.add(blueprint);

  const lattice = buildLattice(half, H, rand);
  group.add(lattice.lines);

  // невидимая форма для наведения мыши
  const hitGeo = new THREE.ConeGeometry(half * Math.SQRT2 * 1.05, H + 0.6, 4);
  hitGeo.rotateY(Math.PI / 4);
  hitGeo.translate(0, (H + 0.6) / 2, 0);
  const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hitMesh);

  return { group, blocks, blockMat, core, coreMat, halo, blueprint, lineMat, lattice, hitMesh, height: H, count };
}
