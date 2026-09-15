// Атмосфера пустыни: летящий песок (вместо снега), штрихи ветра,
// пылевой вихрь вокруг пирамиды и «строительные» линии.
import * as THREE from "three";
import { GLSL_NOISE, mulberry32 } from "../lib/noise.js";

const rand = mulberry32(2024);

// ---------- песчинки ----------
export function createSand({ palette, count, box, size = 2.2, wind = 3.5 }) {
  const pos = new Float32Array(count * 3);
  const r4 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos.set([rand(), rand(), rand()], i * 3);
    r4.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aRand", new THREE.BufferAttribute(r4, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uWind: { value: wind },
      uPR: { value: 1 },
      uOpacity: { value: 0.9 },
      uBoxMin: { value: box.min.clone() },
      uBoxSize: { value: box.getSize(new THREE.Vector3()) },
      uColor: { value: palette.dust.clone() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uSize, uWind, uPR;
      uniform vec3 uBoxMin, uBoxSize;
      attribute vec4 aRand;
      varying float vAlpha;
      void main(){
        vec3 drift = vec3(uTime * uWind * (0.5 + aRand.x),
                          -uTime * 0.12 * aRand.z + sin(uTime * 0.6 + aRand.y * 6.28) * 0.6,
                          uTime * 0.6 * (aRand.w - 0.5));
        vec3 p = fract(position + drift / uBoxSize);
        vec3 wp = uBoxMin + p * uBoxSize;
        wp.y += sin(wp.x * 0.25 + uTime * 1.6 + aRand.z * 6.0) * 0.5;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.1);
        gl_PointSize = uSize * (0.35 + aRand.y) * uPR * (28.0 / dist);
        float ef = smoothstep(0.0, 0.08, p.x) * smoothstep(1.0, 0.92, p.x)
                 * smoothstep(0.0, 0.08, p.y) * smoothstep(1.0, 0.92, p.y)
                 * smoothstep(0.0, 0.08, p.z) * smoothstep(1.0, 0.92, p.z);
        vAlpha = ef * smoothstep(0.6, 3.0, dist) * (1.0 - smoothstep(35.0, 95.0, dist));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

// ---------- штрихи ветра ----------
export function createStreaks({ palette, count, box, wind = 22 }) {
  const pos = new Float32Array(count * 6);
  const tail = new Float32Array(count * 2);
  const r4 = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const p = [rand(), rand(), rand()];
    const r = [rand(), rand(), rand(), rand()];
    pos.set(p, i * 6); pos.set(p, i * 6 + 3);
    tail[i * 2] = 0; tail[i * 2 + 1] = 1;
    r4.set(r, i * 8); r4.set(r, i * 8 + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aTail", new THREE.BufferAttribute(tail, 1));
  geo.setAttribute("aRand", new THREE.BufferAttribute(r4, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: wind },
      uOpacity: { value: 0.35 },
      uBoxMin: { value: box.min.clone() },
      uBoxSize: { value: box.getSize(new THREE.Vector3()) },
      uColor: { value: palette.dust.clone() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uWind;
      uniform vec3 uBoxMin, uBoxSize;
      attribute float aTail;
      attribute vec4 aRand;
      varying float vAlpha;
      void main(){
        float sp = uWind * (0.6 + aRand.x * 0.8);
        vec3 p = fract(position + vec3(uTime * sp, sin(uTime * 0.4 + aRand.z * 6.0) * 0.5, 0.0) / uBoxSize);
        vec3 wp = uBoxMin + p * uBoxSize;
        wp.y += sin(wp.x * 0.15 + aRand.y * 6.0) * 0.8;
        wp.x -= aTail * (1.5 + aRand.w * 4.0);
        wp.y -= aTail * 0.15;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float ef = smoothstep(0.0, 0.1, p.x) * smoothstep(1.0, 0.85, p.x) * smoothstep(0.0, 0.1, p.z) * smoothstep(1.0, 0.9, p.z);
        float dist = -mv.z;
        vAlpha = (1.0 - aTail) * ef * smoothstep(1.0, 6.0, dist) * (1.0 - smoothstep(40.0, 80.0, dist)) * (0.3 + aRand.y * 0.7);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
      void main(){ gl_FragColor = vec4(uColor, vAlpha * uOpacity); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, mat };
}

// ---------- пылевой вихрь ----------
export function createVortex({ palette, count }) {
  const orbit = new Float32Array(count * 4);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 9 + Math.pow(rand(), 0.7) * 16;
    const h = Math.pow(rand(), 2.2) * 7;
    orbit.set([r, rand() * Math.PI * 2, h, 0.9 + rand() * 1.6], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aOrbit", new THREE.BufferAttribute(orbit, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStorm: { value: 1 },
      uPR: { value: 1 },
      uOpacity: { value: 0.55 },
      uColor: { value: palette.dust.clone() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uStorm, uPR;
      attribute vec4 aOrbit;
      varying float vAlpha;
      void main(){
        float r = aOrbit.x + sin(uTime * 0.5 + aOrbit.y * 3.0) * 1.3;
        float ang = aOrbit.y + uTime * aOrbit.w * uStorm * 3.2 / r;
        float y = aOrbit.z + sin(ang * 2.0 + uTime * 0.8) * 0.7 + (r - 10.0) * 0.08;
        vec3 wp = vec3(cos(ang) * r, y, sin(ang) * r);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.1);
        gl_PointSize = (1.2 + aOrbit.w) * uPR * (30.0 / dist);
        vAlpha = smoothstep(0.0, 1.0, y + 0.5) * (1.0 - smoothstep(4.0, 9.0, y)) * smoothstep(2.0, 8.0, dist);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

// ---------- пылевые завесы (кольцо бури у земли) ----------
export function createDustVeil({ palette, radius, height, speed, opacity }) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 96, 1, true);
  geo.translate(0, height / 2 - 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStorm: { value: 1 },
      uOpacity: { value: opacity },
      uColor: { value: palette.dust.clone() },
      uH: { value: height },
      uSpeed: { value: speed },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vObj;
      void main(){ vObj = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStorm, uOpacity, uH, uSpeed;
      uniform vec3 uColor;
      varying vec3 vWorld; varying vec3 vObj;
      ${GLSL_NOISE}
      void main(){
        float th = atan(vObj.z, vObj.x) + uTime * uSpeed * uStorm;
        float yy = vObj.y / uH;
        vec3 p = vec3(cos(th) * 2.2, sin(th) * 2.2, yy * 2.0 - uTime * 0.05);
        float n = fbm3(p * 1.4 + vec3(0.0, 0.0, uTime * 0.03));
        float a = smoothstep(0.42, 0.8, n);
        a *= smoothstep(0.0, 0.18, yy + 0.02) * (1.0 - smoothstep(0.25, 1.0, yy));
        float dist = length(cameraPosition - vWorld);
        a *= smoothstep(3.0, 14.0, dist);
        gl_FragColor = vec4(uColor, a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, mat };
}

// ---------- строительные линии ----------
export function createConstructionLines({ count = 42 }) {
  const pts = [];
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 5 + rand() * 16;
    const c = new THREE.Vector3(Math.cos(ang) * r, 0.5 + rand() * 13, Math.sin(ang) * r);
    const sz = 1.2 + rand() * 3.2;
    const tri = [0, 1, 2].map(() => c.clone().add(new THREE.Vector3((rand() - 0.5) * sz * 2, (rand() - 0.5) * sz * 2, (rand() - 0.5) * sz * 2)));
    const apex = c.clone().add(new THREE.Vector3(0, sz, 0));
    const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]], [tri[0], apex], [tri[1], apex]];
    const s = rand();
    for (const [a, b] of edges) { pts.push(a.x, a.y, a.z, b.x, b.y, b.z); seeds.push(s, s); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime; attribute float aSeed; varying float vA;
      void main(){
        float f = step(0.35, fract(sin(aSeed * 91.7 + floor(uTime * 5.0 + aSeed * 3.0)) * 437.58));
        vA = 0.35 + 0.65 * f;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount; varying float vA;
      void main(){ gl_FragColor = vec4(1.15, 1.1, 1.0, vA * uAmount); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  return { lines, mat };
}
