// Сцена 3: вложенные квадратные «врата» из каменных сегментов.
// Сегменты собираются, рамки выравниваются, загорается свет, камера ныряет в центр.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mulberry32, damp, smoothstep, clamp, lerp } from "../lib/noise.js";
import { sandstoneMap } from "./artifacts-models.js";

const rand = mulberry32(555);

function glowFrameMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uAmt: { value: 0 }, uInner: { value: 0.72 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmt, uInner, uTime; varying vec2 vUv;
      float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float d = abs(sdBox(p, vec2(uInner)));
        float core = exp(-d * 60.0);
        float halo = exp(-d * 9.0) * 0.45;
        float fil = fract(sin(dot(floor(p * 60.0), vec2(12.9, 78.2)) + floor(uTime * 12.0)) * 43758.5);
        float a = (core + halo * (0.8 + 0.2 * fil)) * uAmt;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createSquaresScene({ renderer, palette, mobile }) {
  const scene = new THREE.Scene();
  scene.background = palette.hazeLight.clone();
  scene.fog = new THREE.Fog(palette.hazeLight.clone(), 30, 90);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
  scene.add(new THREE.HemisphereLight(palette.bone, palette.stoneDark, 0.6));
  const key = new THREE.DirectionalLight(new THREE.Color("#fff0da"), 1.5);
  key.position.set(-6, 9, 12);
  scene.add(key);
  const inner = new THREE.PointLight(new THREE.Color("#ffcf88"), 0, 60, 1.4);
  inner.position.set(0, 0, -6);
  scene.add(inner);

  const stoneMat = new THREE.MeshStandardMaterial({
    map: sandstoneMap(),
    color: new THREE.Color("#f2e8d8"),
    roughness: 0.78,
    metalness: 0.02,
    envMapIntensity: 0.4,
  });

  const K = 6;
  const frames = [];
  for (let k = 0; k < K; k++) {
    const S = 1.35 * Math.pow(1.56, k);
    const T = S * 0.2;
    const D = S * 0.24;
    const frame = new THREE.Group();
    frame.position.z = -(K - 1 - k) * 2.4;
    frame.userData = { S, tiltX: (rand() - 0.5) * 1.0, tiltY: (rand() - 0.5) * 1.0, spin: (k % 2 ? 1 : -1) * (0.025 + rand() * 0.03) };
    const segs = [];
    const perSide = k < 2 ? 2 : 3;
    const gap = S * 0.05;
    for (let side = 0; side < 4; side++) {
      const horizontal = side % 2 === 0;
      const len = horizontal ? 2 * S : 2 * S - 2 * T;
      const segLen = (len - gap * (perSide - 1)) / perSide;
      for (let j = 0; j < perSide; j++) {
        const off = -len / 2 + segLen / 2 + j * (segLen + gap);
        const w = horizontal ? segLen : T;
        const h = horizontal ? T : segLen;
        const geo = new RoundedBoxGeometry(w, h, D, 2, Math.min(w, h, D) * 0.18);
        const mesh = new THREE.Mesh(geo, stoneMat);
        const sign = side < 2 ? 1 : -1;
        const home = horizontal
          ? new THREE.Vector3(off, sign * (S - T / 2), 0)
          : new THREE.Vector3(sign * (S - T / 2), off, 0);
        const outDir = home.clone().normalize();
        mesh.position.copy(home);
        mesh.userData = {
          home,
          out: outDir.multiplyScalar(S * (0.5 + rand() * 0.9)).add(new THREE.Vector3(0, 0, (rand() - 0.5) * S * 1.5)),
          rot: new THREE.Euler((rand() - 0.5) * 2.4, (rand() - 0.5) * 2.4, (rand() - 0.5) * 2.4),
          delay: rand() * 0.25,
        };
        frame.add(mesh);
        segs.push(mesh);
      }
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2 * S * 1.25, 2 * S * 1.25), glowFrameMaterial(palette.gold.clone().multiplyScalar(0.9)));
    glow.material.uniforms.uInner.value = (S - T * 1.05) / (S * 1.25);
    glow.position.z = -D * 0.55;
    frame.add(glow);
    frame.userData.segs = segs;
    frame.userData.glow = glow;
    scene.add(frame);
    frames.push(frame);
  }

  // светящееся ядро в центре
  const coreCount = mobile ? 900 : 2200;
  const cp = new Float32Array(coreCount * 3);
  for (let i = 0; i < coreCount; i++) {
    const r = Math.pow(rand(), 2.2) * 1.6;
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
    cp.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
  }
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute("position", new THREE.BufferAttribute(cp, 3));
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uPR: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uAmt, uPR; varying float vA;
      void main(){
        vec3 p = position * (1.0 + 0.15 * sin(uTime * 3.0 + position.x * 4.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.2 * uPR * (20.0 / max(-mv.z, 0.5));
        vA = uAmt;
      }`,
    fragmentShader: /* glsl */ `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(vec3(1.6, 1.45, 1.2) * a, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Points(coreGeo, coreMat);
  core.position.z = -(K - 1) * 2.4 - 0.5;
  scene.add(core);

  const par = new THREE.Vector2();
  const tmpE = new THREE.Euler();
  const tmpQ = new THREE.Quaternion();
  const homeQ = new THREE.Quaternion();

  function update(u, dt, t, input) {
    const assemble = smoothstep(-0.25, 0.42, u);
    const align = smoothstep(0.15, 0.6, u);
    const light = smoothstep(0.35, 0.85, u);

    const zFar = 46, zMid = 20, zEnd = core.position.z + 1.2;
    const cz = u < 0.55 ? lerp(zFar, zMid, smoothstep(-0.4, 0.55, u)) : lerp(zMid, zEnd, smoothstep(0.55, 1.08, u));
    par.x = damp(par.x, input.ndc.x, 2, dt);
    par.y = damp(par.y, input.ndc.y, 2, dt);
    const sway = 1 - smoothstep(0.6, 1, u);
    camera.position.set(par.x * 2.2 * sway, par.y * 1.2 * sway, cz);
    camera.lookAt(0, 0, core.position.z);

    frames.forEach((f, k) => {
      const d = f.userData;
      // рамки поворачиваются медленно и с плавным «догоном», без рывков при прокрутке
      f.rotation.x = damp(f.rotation.x, d.tiltX * (1 - align) - par.y * 0.06, 1.8, dt);
      f.rotation.y = damp(f.rotation.y, d.tiltY * (1 - align) + par.x * 0.06, 1.8, dt);
      f.rotation.z = damp(f.rotation.z, t * d.spin + (1 - align) * d.spin * 3, 1.5, dt);
      for (const m of d.segs) {
        const md = m.userData;
        const a = clamp((assemble - md.delay) / (1 - md.delay), 0, 1);
        const e = a * a * (3 - 2 * a);
        m.position.copy(md.home).addScaledVector(md.out, 1 - e);
        tmpE.set(md.rot.x * (1 - e), md.rot.y * (1 - e), md.rot.z * (1 - e));
        m.quaternion.copy(homeQ).multiply(tmpQ.setFromEuler(tmpE));
      }
      const g = d.glow.material.uniforms;
      g.uTime.value = t;
      g.uAmt.value = light * (0.6 + 0.4 * Math.sin(t * 2 + k)) * (0.5 + k * 0.12);
    });

    inner.intensity = light * 90;
    coreMat.uniforms.uTime.value = t;
    coreMat.uniforms.uAmt.value = 0.25 + light * 1.2;
    core.rotation.y = t * 0.3;
    stoneMat.emissive.copy(palette.gold).multiplyScalar(light * 0.06);
  }

  return {
    name: "squares",
    scene,
    camera,
    update,
    setPixelRatio(pr) { coreMat.uniforms.uPR.value = pr; },
    hovering: false,
  };
}
