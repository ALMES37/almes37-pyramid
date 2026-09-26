// Три артефакта: самородок золота, блок пирамиды, алмаз.
import * as THREE from "../vendor/three/three.module.js";
import { makeNoise2D, mulberry32 } from "../lib/noise.js";

const n2 = makeNoise2D(99);
const noise3 = (x, y, z) => (n2(x, y) + n2(y + 5.2, z) + n2(z - 3.1, x)) / 3;

export function makeGoldNugget() {
  const geo = new THREE.IcosahedronGeometry(2.1, 24);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    const big = noise3(d.x * 1.2, d.y * 1.2, d.z * 1.2);
    const mid = noise3(d.x * 3.5 + 2, d.y * 3.5, d.z * 3.5);
    const fine = noise3(d.x * 11, d.y * 11, d.z * 11);
    const r = 2.1 * (1 + big * 0.55 + Math.abs(mid) * 0.18 - Math.abs(fine) * 0.05);
    v.copy(d).multiplyScalar(r);
    v.y *= 0.78;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffb54a"),
    metalness: 1,
    roughness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.0,
  });
  return new THREE.Mesh(geo, mat);
}

// текстура известняка и золотых «резных» знаков (абстрактные, не настоящие иероглифы)
function stoneTextures() {
  const S = 512;
  const rand = mulberry32(7);
  const base = document.createElement("canvas");
  base.width = base.height = S;
  const g = base.getContext("2d");
  g.fillStyle = "#cdb48c";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const l = 150 + rand() * 90;
    g.fillStyle = `rgba(${l},${l * 0.86},${l * 0.66},${0.08 + rand() * 0.2})`;
    const r = rand() * 2.4;
    g.fillRect(rand() * S, rand() * S, r, r);
  }
  const glyph = document.createElement("canvas");
  glyph.width = glyph.height = S;
  const e = glyph.getContext("2d");
  e.fillStyle = "#000";
  e.fillRect(0, 0, S, S);
  e.strokeStyle = "#fff";
  e.lineWidth = 3;
  e.lineCap = "round";
  const cols = 5, rows = 6, cw = S / cols, rh = S / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = c * cw + cw / 2, y = r * rh + rh / 2, s = Math.min(cw, rh) * 0.28;
      const kind = Math.floor(rand() * 6);
      e.beginPath();
      if (kind === 0) { e.arc(x, y, s, 0, Math.PI * 2); e.moveTo(x, y + s); e.lineTo(x, y + s * 1.6); }
      else if (kind === 1) { e.moveTo(x - s, y + s); e.lineTo(x, y - s); e.lineTo(x + s, y + s); e.closePath(); }
      else if (kind === 2) { e.moveTo(x - s, y); e.lineTo(x + s, y); e.moveTo(x, y - s); e.lineTo(x, y + s); e.moveTo(x - s * 0.6, y - s); e.lineTo(x + s * 0.6, y - s); }
      else if (kind === 3) { e.moveTo(x - s, y - s * 0.4); e.quadraticCurveTo(x, y - s * 1.6, x + s, y - s * 0.4); e.moveTo(x - s, y + s * 0.5); e.lineTo(x + s, y + s * 0.5); }
      else if (kind === 4) { e.rect(x - s * 0.7, y - s, s * 1.4, s * 2); e.moveTo(x - s * 0.7, y); e.lineTo(x + s * 0.7, y); }
      else { e.moveTo(x - s, y + s); e.lineTo(x - s, y - s); e.lineTo(x + s * 0.4, y - s); e.moveTo(x - s, y); e.lineTo(x + s, y); }
      e.stroke();
    }
    e.beginPath();
    e.moveTo(c * cw + 3, 6); e.lineTo(c * cw + 3, S - 6);
    e.stroke();
  }
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(glyph);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

export function makePyramidBlock() {
  const geo = new THREE.BoxGeometry(4.4, 2.9, 2.9, 40, 28, 28);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const edge = Math.max(Math.abs(v.x) / 2.2, Math.abs(v.y) / 1.45, Math.abs(v.z) / 1.45);
    const chip = noise3(v.x * 0.9, v.y * 0.9, v.z * 0.9);
    const k = Math.pow(edge, 8) * (0.18 + Math.max(0, chip) * 0.5) + noise3(v.x * 3, v.y * 3, v.z * 3) * 0.035;
    v.multiplyScalar(1 - k * 0.35);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const { map, emissiveMap } = stoneTextures();
  const mat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: new THREE.Color(1.0, 0.62, 0.22),
    emissiveIntensity: 2.2,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  return new THREE.Mesh(geo, mat);
}

export function sandstoneMap() {
  return stoneTextures().map;
}

export function makeDiamond() {
  const pts = [
    new THREE.Vector2(0.001, -2.2),
    new THREE.Vector2(2.3, 0.1),
    new THREE.Vector2(2.35, 0.35),
    new THREE.Vector2(1.45, 1.05),
    new THREE.Vector2(0.001, 1.05),
  ];
  const flat = new THREE.LatheGeometry(pts, 10).toNonIndexed();
  flat.computeVertexNormals();
  // Собственный шейдер «огранки»: отражения + радужная игра света внутри.
  // Работает на любом устройстве и дешевле физического стекла.
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      vec3 env(vec3 d){
        float h = d.y * 0.5 + 0.5;
        vec3 c = mix(vec3(0.16, 0.13, 0.1), vec3(1.2, 1.1, 0.95), smoothstep(0.25, 0.85, h));
        float s1 = smoothstep(0.9, 1.0, sin(d.x * 13.0 + d.z * 9.0) * 0.5 + 0.5);
        float s2 = smoothstep(0.94, 1.0, sin(d.y * 21.0 - d.z * 7.0) * 0.5 + 0.5);
        return c + vec3(2.0, 1.85, 1.6) * (s1 + s2);
      }
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        vec3 V = normalize(cameraPosition - vW);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.1 + 0.9 * pow(1.0 - ndv, 3.0);
        vec3 refl = env(reflect(-V, N));
        vec3 bounce = -N.yzx;
        vec3 fire = vec3(
          env(reflect(refract(-V, N, 1.0 / 2.36), bounce)).r,
          env(reflect(refract(-V, N, 1.0 / 2.42), bounce)).g,
          env(reflect(refract(-V, N, 1.0 / 2.5), bounce)).b);
        float facet = hash(floor(N * 8.0));
        vec3 tint = 0.6 + 0.4 * cos(6.2831 * (hash(floor(N * 8.0) + 3.1) + vec3(0.0, 0.33, 0.67)));
        fire *= (0.55 + 1.1 * facet) * tint * 1.25;
        vec3 col = mix(fire, refl, fres);
        col += vec3(1.8, 1.6, 1.3) * pow(max(dot(reflect(-V, N), normalize(vec3(0.4, 0.9, 0.3))), 0.0), 60.0) * 2.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(flat, mat);
}

// «Скобки» по углам вокруг объекта + лучи — техническая разметка в 3D
export function makeBrackets(size, seed = 1) {
  const rand = mulberry32(seed);
  const { x: sx, y: sy, z: sz } = size;
  const arm = 0.5;
  const pts = [];
  for (const cx of [-1, 1]) for (const cy of [-1, 1]) for (const cz of [-1, 1]) {
    const x = cx * sx, y = cy * sy, z = cz * sz;
    pts.push(x, y, z, x - cx * arm, y, z);
    pts.push(x, y, z, x, y - cy * arm, z);
    pts.push(x, y, z, x, y, z - cz * arm);
  }
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const a = d.clone().multiplyScalar(2.6 + rand());
    const b = d.clone().multiplyScalar(4.5 + rand() * 3.5);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.1, 1.05, 0.98), transparent: true, opacity: 0.55, depthWrite: false });
  return new THREE.LineSegments(geo, mat);
}
