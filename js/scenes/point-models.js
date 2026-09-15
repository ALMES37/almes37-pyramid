// Модели из частиц, собранные из простых фигур (SDF): сфинкс, искра, резиновая уточка.
// Точки берутся из тонкой «оболочки» каждой фигуры.
// Все векторы создаются один раз заранее — так выборка точек идёт быстро.
import * as THREE from "three";
import { mulberry32 } from "../lib/noise.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function sdEllipsoid(p, c, r) {
  const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
  const k0 = Math.hypot(x / r.x, y / r.y, z / r.z);
  const k1 = Math.hypot(x / (r.x * r.x), y / (r.y * r.y), z / (r.z * r.z));
  return (k0 * (k0 - 1)) / (k1 || 1e-6);
}
function sdCapsule(p, a, b, ra, rb) {
  tmp.subVectors(p, a);
  tmp2.subVectors(b, a);
  const h = Math.min(1, Math.max(0, tmp.dot(tmp2) / tmp2.lengthSq()));
  return tmp.addScaledVector(tmp2, -h).length() - (ra + (rb - ra) * h);
}
function sdBox(p, c, bx, by, bz, round) {
  const qx = Math.abs(p.x - c.x) - bx + round;
  const qy = Math.abs(p.y - c.y) - by + round;
  const qz = Math.abs(p.z - c.z) - bz + round;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, qy, qz), 0) - round;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Примитив = { f(p) -> расстояние, k: мягкость склейки (0 = жёсткое объединение) }
const ell = (c, r, k = 0) => ({ f: (p) => sdEllipsoid(p, c, r), k });
const cap = (a, b, ra, rb = ra, k = 0) => ({ f: (p) => sdCapsule(p, a, b, ra, rb), k });
const box = (c, b, round = 0, k = 0) => ({ f: (p) => sdBox(p, c, b.x, b.y, b.z, round), k });

function union(list) {
  return (p) => {
    let d = list[0].f(p);
    for (let i = 1; i < list.length; i++) {
      const di = list[i].f(p);
      d = list[i].k > 0 ? smin(d, di, list[i].k) : Math.min(d, di);
    }
    return d;
  };
}

// ---- сфинкс ----
const nemesC = V(1.1, 1.95, 0);
const sphinx = union([
  ell(V(-0.35, 0.72, 0), V(1.65, 0.62, 0.66)),
  ell(V(-1.55, 0.72, 0), V(0.66, 0.7, 0.74), 0.35),
  ell(V(0.9, 1.02, 0), V(0.62, 0.78, 0.6), 0.35),
  cap(V(0.9, 0.2, -0.4), V(2.45, 0.17, -0.4), 0.21, 0.17, 0.2),
  cap(V(0.9, 0.2, 0.4), V(2.45, 0.17, 0.4), 0.21, 0.17, 0.2),
  cap(V(-1.6, 0.22, -0.56), V(-0.55, 0.18, -0.6), 0.24, 0.16, 0.2),
  cap(V(-1.6, 0.22, 0.56), V(-0.55, 0.18, 0.6), 0.24, 0.16, 0.2),
  cap(V(-2.1, 0.3, 0.72), V(-0.4, 0.12, 0.85), 0.07, 0.07, 0.1),
  cap(V(1.0, 1.45, 0), V(1.2, 1.95, 0), 0.34, 0.34, 0.25),
  ell(V(1.3, 2.18, 0), V(0.34, 0.43, 0.32), 0.12),
  // немес — платок: расширяется книзу
  { f: (p) => sdBox(p, nemesC, 0.3, 0.55, Math.max(0.2, 0.42 + (2.35 - p.y) * 0.28), 0.08), k: 0.12 },
  box(V(1.38, 1.5, -0.42), V(0.1, 0.42, 0.1), 0.04),
  box(V(1.38, 1.5, 0.42), V(0.1, 0.42, 0.1), 0.04),
  ell(V(1.62, 2.12, 0), V(0.08, 0.1, 0.12)),
]);

// ---- искра: стилизованная звёздочка с неровными лучами ----
const sparkList = (() => {
  const r = mulberry32(12);
  const c = V(0, 1.85, 0);
  const list = [ell(c, V(0.2, 0.2, 0.12))];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.2;
    const len = 1.3 + r() * 0.6;
    list.push(cap(c, V(Math.cos(a) * len, c.y + Math.sin(a) * len, 0), 0.13 + r() * 0.04, 0.045, 0.05));
  }
  return list;
})();
const sparkBase = union(sparkList);
const spark = (p) => Math.max(sparkBase(p), Math.abs(p.z) - 0.14);

// ---- резиновая уточка для ванны: тело, хвостик, голова, клюв, крылья ----
const duckBase = union([
  ell(V(0, 0.85, 0), V(1.25, 0.78, 0.95)),
  ell(V(-1.0, 1.2, 0), V(0.5, 0.36, 0.42), 0.3),
  ell(V(-0.1, 1.05, -0.82), V(0.62, 0.34, 0.2), 0.12),
  ell(V(-0.1, 1.05, 0.82), V(0.62, 0.34, 0.2), 0.12),
  ell(V(0.62, 1.55, 0), V(0.42, 0.34, 0.42), 0.35),
  ell(V(0.65, 2.05, 0), V(0.6, 0.58, 0.58), 0.3),
  ell(V(1.28, 1.95, 0), V(0.42, 0.13, 0.3), 0.08),
  ell(V(1.02, 2.28, -0.3), V(0.09, 0.1, 0.07)),
  ell(V(1.02, 2.28, 0.3), V(0.09, 0.1, 0.07)),
]);
// плоское дно, чтобы уточка стояла
const duck = (p) => Math.max(duckBase(p), 0.12 - p.y);

function sample(sdf, count, bmin, bmax, shell, seed) {
  const r = mulberry32(seed);
  const out = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  const sx = bmax.x - bmin.x, sy = bmax.y - bmin.y, sz = bmax.z - bmin.z;
  let n = 0, tries = 0;
  const maxTries = count * 300;
  while (n < count && tries < maxTries) {
    tries++;
    p.set(bmin.x + r() * sx, bmin.y + r() * sy, bmin.z + r() * sz);
    const d = sdf(p);
    if (d < 0 && d > -shell) {
      out[n * 3] = p.x; out[n * 3 + 1] = p.y; out[n * 3 + 2] = p.z;
      n++;
    }
  }
  // если попыток не хватило — повторяем уже найденные точки
  for (let i = n; i < count; i++) {
    const j = Math.floor(r() * Math.max(n, 1));
    out[i * 3] = out[j * 3]; out[i * 3 + 1] = out[j * 3 + 1]; out[i * 3 + 2] = out[j * 3 + 2];
  }
  return out;
}

export function buildModels(count) {
  const sph = sample(sphinx, count, V(-2.4, -0.1, -1.0), V(2.8, 2.9, 1.0), 0.09, 1);
  for (let i = 0; i < count; i++) {
    sph[i * 3] = (sph[i * 3] - 0.2) * 0.66;
    sph[i * 3 + 1] = sph[i * 3 + 1] * 0.66 + 0.33;
    sph[i * 3 + 2] *= 0.66;
  }
  const spk = sample(spark, count, V(-2.0, -0.2, -0.16), V(2.0, 3.9, 0.16), 0.1, 2);
  for (let i = 0; i < count; i++) {
    spk[i * 3] *= 0.92;
    spk[i * 3 + 1] = (spk[i * 3 + 1] - 1.85) * 0.92 + 1.85;
  }
  const dck = sample(duck, count, V(-1.6, 0.1, -1.1), V(1.8, 2.8, 1.1), 0.1, 3);
  for (let i = 0; i < count; i++) {
    dck[i * 3] = (dck[i * 3] - 0.1) * 1.05;
    dck[i * 3 + 1] = dck[i * 3 + 1] * 1.05 - 0.05;
    dck[i * 3 + 2] *= 1.05;
  }
  return [
    { name: "Сфинкс", points: sph },
    { name: "Искра", points: spk },
    { name: "Уточка", points: dck },
  ];
}
