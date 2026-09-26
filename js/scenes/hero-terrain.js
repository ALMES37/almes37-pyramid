// Пустыня: плато под пирамидой, гребни дюн, дальние барханы.
// Песок блестит на солнце и продавливается под курсором: остаётся тёмный след,
// который сам исчезает через несколько секунд.
import * as THREE from "../vendor/three/three.module.js";
import { FullScreenQuad } from "../vendor/three/addons/postprocessing/Pass.js";
import { makeNoise2D, fbm2, smoothstep } from "../lib/noise.js";
import { GLSL_NOISE } from "../lib/noise.js";

const noise = makeNoise2D(1337);
const TRAIL_SIZE = 140; // сколько метров пустыни покрывает карта следов
const TRAIL_RES = 512;

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const plateau = smoothstep(13, 38, d);
  // гребни дюн: «хребет» шума, слегка изогнутый
  const warp = fbm2(noise, x * 0.012, z * 0.012, 3) * 2.2;
  const ridge = 1 - Math.abs(noise(x * 0.018 + warp, z * 0.03 - warp * 0.4));
  const dunes = Math.pow(ridge, 1.8) * 5.5 + fbm2(noise, x * 0.012 + 3.1, z * 0.012, 4) * 4;
  const far = Math.max(0, fbm2(noise, x * 0.004 - 9, z * 0.004 + 4, 3) + 0.25) * 15 * smoothstep(70, 150, d);
  const micro = noise(x * 0.3, z * 0.3) * 0.08;
  return (dunes + far) * plateau + micro - 0.05;
}

// ---------- карта следов (рисуем «кистью» в текстуру и медленно стираем) ----------
function createTrail(renderer) {
  const isFloat = renderer.capabilities.isWebGL2;
  const opts = {
    type: isFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  };
  let read = new THREE.WebGLRenderTarget(TRAIL_RES, TRAIL_RES, opts);
  let write = new THREE.WebGLRenderTarget(TRAIL_RES, TRAIL_RES, opts);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tPrev: { value: read.texture },
      uFrom: { value: new THREE.Vector2() },
      uTo: { value: new THREE.Vector2() },
      uRadius: { value: 2.0 / TRAIL_SIZE },
      uAmt: { value: 0 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tPrev; uniform vec2 uFrom, uTo; uniform float uRadius, uAmt, uFade; varying vec2 vUv;
      float segDist(vec2 p, vec2 a, vec2 b){
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        return length(pa - ba * h);
      }
      void main(){
        float v = max(texture2D(tPrev, vUv).r - uFade, 0.0);
        float b = smoothstep(uRadius, uRadius * 0.3, segDist(vUv, uFrom, uTo)) * uAmt;
        gl_FragColor = vec4(max(v, b), 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  const minFade = isFloat ? 0 : 1.05 / 255;
  let idle = Infinity;

  const toUv = (x, z, out) => out.set(x / TRAIL_SIZE + 0.5, z / TRAIL_SIZE + 0.5);

  return {
    get texture() { return read.texture; },
    // brush: { fromX, fromZ, toX, toZ } или null, если курсор не на песке
    step(dt, brush) {
      if (brush) idle = 0;
      else idle += dt;
      if (idle > 6) return false; // след исчез — видеокарту не нагружаем
      const u = material.uniforms;
      u.tPrev.value = read.texture;
      u.uFade.value = Math.max(dt * 0.2, minFade);
      u.uAmt.value = brush ? 1 : 0;
      if (brush) {
        toUv(brush.fromX, brush.fromZ, u.uFrom.value);
        toUv(brush.toX, brush.toZ, u.uTo.value);
      }
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(write);
      quad.render(renderer);
      renderer.setRenderTarget(prevTarget);
      [read, write] = [write, read];
      return true;
    },
  };
}

const VERT = /* glsl */ `
uniform sampler2D uTrail;
uniform float uTrailSize;
varying vec3 vWorld;
varying vec3 vNormal;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #if USE_TRAIL_VTX == 1
    wp.y -= texture2D(uTrail, wp.xz / uTrailSize + 0.5).r * 0.3;
  #endif
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSandLight;
uniform vec3 uSandDark;
uniform vec3 uHaze;
uniform vec3 uGold;
uniform float uFogDensity;
uniform float uGlow;
uniform float uTime;
uniform sampler2D uTrail;
uniform float uTrailSize;
uniform vec3 uCoreW;
uniform float uReveal; // заставка: пустыня проявляется кругом от пирамиды
varying vec3 vWorld;
varying vec3 vNormal;
${GLSL_NOISE}

void main(){
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // мелкая рябь, которую ветер рисует на песке
  float warp = fbm2(vWorld.xz * 0.08);
  float ripple = sin((vWorld.x * 0.8 + vWorld.z * 0.25 + warp * 6.0) * 5.0) * 0.5 + 0.5;
  float fade = 1.0 - smoothstep(20.0, 70.0, dist);
  vec3 rn = normalize(n + vec3(ripple - 0.5, 0.0, 0.0) * 0.18 * fade);

  // след курсора: наклон стенок ямки и потемнение утрамбованного песка
  vec2 tuv = vWorld.xz / uTrailSize + 0.5;
  float e = 1.0 / ${TRAIL_RES.toFixed(1)};
  float h0 = texture2D(uTrail, tuv).r;
  float hx = texture2D(uTrail, tuv + vec2(e, 0.0)).r;
  float hz = texture2D(uTrail, tuv + vec2(0.0, e)).r;
  rn = normalize(rn + vec3(hx - h0, 0.0, hz - h0) * 10.0);
  float rim = smoothstep(0.05, 0.3, h0) * (1.0 - smoothstep(0.35, 0.8, h0));

  float tone = fbm2(vWorld.xz * 0.03);
  vec3 albedo = mix(uSandDark, uSandLight, smoothstep(0.25, 0.75, tone));
  albedo *= 0.93 + 0.07 * ripple * fade;
  albedo *= (1.0 - h0 * 0.42) * (1.0 + rim * 0.12);

  float diff = max(dot(rn, uSunDir), 0.0);
  float wrap = max((dot(rn, uSunDir) + 0.35) / 1.35, 0.0);
  vec3 sky = uHaze * 1.05;
  vec3 ground = uSandDark * 0.55;
  vec3 amb = mix(ground, sky, rn.y * 0.5 + 0.5) * 0.55;
  vec3 col = albedo * (amb + uSunColor * (0.35 * wrap + 0.65 * diff));

  // искры на гребнях песчинок (в следе их нет)
  vec2 cell = floor(vWorld.xz * 26.0);
  float sparkle = step(0.985, hash21(cell)) * (1.0 - h0);
  float glint = pow(max(dot(reflect(-uSunDir, rn), V), 0.0), 6.0);
  float tw = 0.5 + 0.5 * sin(uTime * 3.0 + hash21(cell + 7.0) * 40.0);
  col += uSunColor * sparkle * glint * tw * 1.6 * fade;

  // золотой отсвет от раскрытой части пирамиды
  vec3 toCore = vWorld - uCoreW;
  float spill = uGlow / (1.0 + dot(toCore, toCore) * 0.03);
  col += uGold * spill * 0.9;

  float front = uReveal * 260.0;
  float rd = length(vWorld.xz) + (fbm2(vWorld.xz * 0.04) - 0.5) * 28.0;
  float shown = smoothstep(front, front - 26.0, rd);
  col = mix(uHaze, col, shown);
  col += uSunColor * 0.12 * (1.0 - abs(shown * 2.0 - 1.0)) * step(0.001, uReveal) * step(uReveal, 0.999);

  // дымка: по расстоянию и у самой земли
  float fog = 1.0 - exp(-dist * uFogDensity);
  fog = max(fog, smoothstep(2.0, -6.0, vWorld.y) * 0.3);
  col = mix(col, uHaze, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrain({ palette, mobile, renderer }) {
  const size = 320;
  const seg = mobile ? 170 : 360;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const trail = createTrail(renderer);

  const material = new THREE.ShaderMaterial({
    defines: { USE_TRAIL_VTX: renderer.capabilities.vertexTextures ? 1 : 0 },
    uniforms: {
      uSunDir: { value: palette.sunDir.clone() },
      uSunColor: { value: palette.sun.clone() },
      uSandLight: { value: palette.sandLight.clone() },
      uSandDark: { value: palette.sandDark.clone() },
      uHaze: { value: palette.haze.clone() },
      uGold: { value: palette.gold.clone() },
      uFogDensity: { value: 0.012 },
      uGlow: { value: 0 },
      uTime: { value: 0 },
      uTrail: { value: trail.texture },
      uTrailSize: { value: TRAIL_SIZE },
      uCoreW: { value: new THREE.Vector3(0, 2.5, 0) },
      uReveal: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    trail,
    trailSize: TRAIL_SIZE,
    stepTrail(dt, brush) {
      trail.step(dt, brush);
      material.uniforms.uTrail.value = trail.texture;
    },
  };
}

// Точка, где луч из камеры касается песка (шагаем вдоль луча по высоте рельефа)
export function rayHitSand(ray, out, maxDist = 150) {
  const o = ray.origin, d = ray.direction;
  if (d.y > -0.005) return false;
  let t = 0.5, prevT = 0;
  for (let i = 0; i < 90 && t < maxDist; i++) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const above = y - heightAt(x, z);
    if (above < 0) {
      let a = prevT, b = t;
      for (let k = 0; k < 7; k++) {
        const mid = (a + b) / 2;
        const my = o.y + d.y * mid;
        if (my - heightAt(o.x + d.x * mid, o.z + d.z * mid) < 0) b = mid; else a = mid;
      }
      out.set(o.x + d.x * b, 0, o.z + d.z * b);
      out.y = heightAt(out.x, out.z);
      return true;
    }
    prevT = t;
    t += Math.max(0.35, above * 0.7);
  }
  return false;
}
