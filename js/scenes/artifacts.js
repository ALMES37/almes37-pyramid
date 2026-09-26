// Сцена 2: артефакты-проекты с HUD-разметкой (линии, подписи, «живые» числа).
import * as THREE from "../vendor/three/three.module.js";
import { RoomEnvironment } from "../vendor/three/addons/environments/RoomEnvironment.js";
import { makeGoldNugget, makePyramidBlock, makeDiamond, makeBrackets } from "./artifacts-models.js";
import { createSand } from "./hero-atmos.js";
import { damp, smoothstep, clamp } from "../lib/noise.js";
import { scramble, jitterNumber } from "../lib/scramble.js";

// Замените на свои проекты: название, описание, год и ссылка
export const PROJECTS = [
  { code: "ARTEFACT_01", name: "Золото Нубии", about: "Лендинг ювелирного бренда", year: "2025", href: "#", temp: 41.3 },
  { code: "ARTEFACT_02", name: "Блок 2 300 001", about: "Сайт строительной компании", year: "2025", href: "#", temp: 38.6 },
  { code: "ARTEFACT_03", name: "Сердце Хеопса", about: "3D-промо для дизайн-студии", year: "2026", href: "#", temp: 12.4 },
];

const GAP = 15;
const SVG_NS = "http://www.w3.org/2000/svg";

export function createArtifactsScene({ renderer, palette, mobile, hudRoot, hudSvg, onReveal }) {
  const scene = new THREE.Scene();
  scene.background = palette.hazeDeep.clone();
  scene.fog = new THREE.Fog(palette.hazeDeep.clone(), 16, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 300);

  scene.add(new THREE.HemisphereLight(palette.bone, palette.umber, 0.5));
  const sun = new THREE.DirectionalLight(new THREE.Color("#ffe2b8"), 2.0);
  sun.position.set(6, 10, 8);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(new THREE.Color("#ffd28a"), 1.4);
  rim.position.set(-8, -2, -6);
  scene.add(rim);

  // обелиски в дымке — для глубины
  const obeliskMat = new THREE.MeshStandardMaterial({ color: palette.stoneDark, roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const h = 16 + (i % 3) * 5;
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, h, 4), obeliskMat);
    shaft.rotation.y = Math.PI / 4;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.2, 4), obeliskMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = h / 2 + 0.6;
    g.add(shaft, cap);
    g.position.set((i % 2 ? 1 : -1) * (12 + i * 3), -i * 6 - 4, -26 - (i % 3) * 8);
    scene.add(g);
  }

  const dustBox = new THREE.Box3(new THREE.Vector3(-22, -44, -18), new THREE.Vector3(22, 14, 12));
  const dust = createSand({ palette, count: mobile ? 1200 : 3200, box: dustBox, size: 1.3, wind: 1.1 });
  scene.add(dust.points);

  const makers = [makeGoldNugget, makePyramidBlock, makeDiamond];
  const anchorsDef = [
    { key: "title", at: [-3.9, 2.9, 0], surf: [-1.3, 1.1, 0.8], dir: -1 },
    { key: "data", at: [3.9, 1.6, 0], surf: [1.6, 0.5, 0.6], dir: 1 },
    { key: "link", at: [3.1, -2.8, 0], surf: [1.1, -1.4, 0.7], dir: 1 },
  ];

  const items = PROJECTS.map((p, i) => {
    const holder = new THREE.Group();
    holder.position.set(mobile ? 0 : i % 2 === 0 ? -2.4 : 2.4, -i * GAP, 0);
    const mesh = makers[i]();
    holder.add(mesh);
    const brackets = makeBrackets(new THREE.Vector3(3.2, 2.7, 2.7), i + 3);
    holder.add(brackets);
    const lamp = new THREE.PointLight(new THREE.Color("#ffc36e"), 0, 12, 1.6);
    lamp.position.set(0, 0, 3.5);
    holder.add(lamp);
    scene.add(holder);

    const labels = anchorsDef.map((a) => {
      const el = document.createElement(a.key === "link" ? "a" : "div");
      el.className = "hud__label" + (a.key === "link" ? " is-link" : "");
      if (a.key === "title") {
        el.innerHTML = `<span data-s>${p.code}</span><br><span data-s>${p.name}</span><small>${p.about}</small>`;
      } else if (a.key === "data") {
        el.innerHTML = `<span data-temp>T ${p.temp}°</span><br><span data-coord>N 29.9792 E 31.1342</span>`;
      } else {
        el.href = p.href;
        el.innerHTML = `<span data-s>${p.year} // Открыть проект</span>`;
        el.setAttribute("aria-label", `Открыть проект: ${p.name}`);
      }
      el.style.opacity = "0";
      hudRoot.appendChild(el);
      const line = document.createElementNS(SVG_NS, "polyline");
      line.style.opacity = "0";
      hudSvg.appendChild(line);
      return { ...a, el, line, width: 0, at: new THREE.Vector3(...a.at), surf: new THREE.Vector3(...a.surf) };
    });

    return { p, holder, mesh, brackets, lamp, labels, shown: false, hover: 0, spin: i * 1.3, spinVel: 0 };
  });

  const srList = document.getElementById("srProjects");
  if (srList) srList.innerHTML = PROJECTS.map((p) => `<li>${p.name} — ${p.about}, ${p.year}</li>`).join("");

  const raycaster = new THREE.Raycaster();
  const v = new THREE.Vector3();
  const par = new THREE.Vector2();
  let hoveredItem = null;
  let grabbed = null; // артефакт, который сейчас крутят зажатой кнопкой
  let spinSpeed = 0;
  let lastJitter = 0;

  function measure() {
    for (const it of items) for (const l of it.labels) l.width = l.el.offsetWidth;
  }
  requestAnimationFrame(measure);
  document.fonts?.ready.then(measure);

  function project(vec, W, H) {
    vec.project(camera);
    return [(vec.x * 0.5 + 0.5) * W, (-vec.y * 0.5 + 0.5) * H, vec.z];
  }

  function update(u, dt, t, input) {
    const span = (PROJECTS.length - 1) * GAP + 8;
    const camY = 4 - u * span;
    par.x = damp(par.x, input.ndc.x, 2, dt);
    par.y = damp(par.y, input.ndc.y, 2, dt);
    camera.position.set(par.x * 1.4, camY + par.y * 0.6, mobile ? 27 : 21);
    camera.lookAt(par.x * 0.3, camY - 0.8, 0);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    // наведение на артефакт; зажатие кнопки мыши — захват для вращения
    hoveredItem = null;
    if (input.active && input.weight > 0.9) {
      raycaster.setFromCamera(input.ndc, camera);
      const hit = raycaster.intersectObjects(items.map((it) => it.mesh), false)[0];
      if (hit) hoveredItem = items.find((it) => it.mesh === hit.object) ?? null;
    }
    if (input.pressed && hoveredItem) grabbed = hoveredItem;
    if (!input.down || input.weight < 0.5) grabbed = null;
    if (grabbed) hoveredItem = grabbed;
    spinSpeed = 0;

    const W = innerWidth, H = innerHeight;
    const jitterNow = t - lastJitter > 0.14;
    if (jitterNow) lastJitter = t;

    for (const it of items) {
      const isHover = it === hoveredItem;
      it.hover = damp(it.hover, isHover ? 1 : 0, 6, dt);
      if (it === grabbed) {
        // крутим вокруг той же оси, вокруг которой артефакт вращается сам
        const turn = input.dragX * 0.011;
        it.spin += turn;
        it.spinVel = damp(it.spinVel, turn / Math.max(dt, 1 / 120), 14, dt);
      } else {
        // после отпускания вращение по инерции плавно затухает
        it.spinVel *= Math.exp(-2.4 * dt);
        it.spin += it.spinVel * dt;
      }
      it.spin += dt * (0.22 + (it === grabbed ? 0 : it.hover * 0.5));
      spinSpeed = Math.max(spinSpeed, Math.abs(it.spinVel));
      it.mesh.rotation.set(0.25 + Math.sin(t * 0.4 + it.spin) * 0.12, it.spin, Math.sin(t * 0.3) * 0.08);
      it.holder.rotation.x = damp(it.holder.rotation.x, -par.y * 0.25, 3, dt);
      it.holder.rotation.y = damp(it.holder.rotation.y, par.x * 0.35, 3, dt);
      const s = 1 + it.hover * 0.06;
      it.mesh.scale.setScalar(s);
      it.brackets.material.opacity = 0.35 + it.hover * 0.5;
      it.brackets.rotation.y = -t * 0.05;
      it.lamp.intensity = 6 + it.hover * 22;

      const [, sy] = project(v.copy(it.holder.position), W, H);
      const ndcY = (sy / H) * 2 - 1;
      const vis = (1 - smoothstep(0.25, 0.62, Math.abs(ndcY))) * input.weight;
      if (vis > 0.6 && !it.shown) {
        it.shown = true;
        for (const l of it.labels) l.el.querySelectorAll("[data-s]").forEach((n) => scramble(n, n.dataset.text ?? n.textContent, 800));
        onReveal?.();
      } else if (vis < 0.15) it.shown = false;

      for (const l of it.labels) {
        const [ax, ay, az] = project(v.copy(l.at).applyMatrix4(it.holder.matrixWorld), W, H);
        const [sx2, sy2] = project(v.copy(l.surf).applyMatrix4(it.holder.matrixWorld), W, H);
        const behind = az > 1;
        const o = behind ? 0 : vis;
        const w = l.width || 140;
        const left = l.dir < 0 ? ax - w : ax;
        l.el.style.transform = `translate3d(${left.toFixed(1)}px, ${(ay - l.el.offsetHeight).toFixed(1)}px, 0)`;
        l.el.style.opacity = o.toFixed(3);
        l.el.style.visibility = o < 0.02 ? "hidden" : "";
        const endX = l.dir < 0 ? ax - w : ax + w;
        l.line.setAttribute("points", `${sx2.toFixed(1)},${sy2.toFixed(1)} ${ax.toFixed(1)},${(ay + 6).toFixed(1)} ${endX.toFixed(1)},${(ay + 6).toFixed(1)}`);
        l.line.style.opacity = (o * 0.85).toFixed(3);

        if (jitterNow && l.key === "data" && o > 0.1) {
          l.el.querySelector("[data-temp]").textContent = `T ${jitterNumber(it.p.temp, 0.6, 1)}°`;
          l.el.querySelector("[data-coord]").textContent = `N ${jitterNumber(29.9792, 0.0008, 4)} E ${jitterNumber(31.1342, 0.0008, 4)}`;
        }
      }
    }

    dust.mat.uniforms.uTime.value = t;
    scene.fog.near = 16 + clamp(-u, 0, 1) * -10;
  }

  function hideHud() {
    for (const it of items) {
      it.shown = false;
      for (const l of it.labels) {
        l.el.style.opacity = "0";
        l.el.style.visibility = "hidden";
        l.line.style.opacity = "0";
      }
    }
  }

  function click() {
    if (hoveredItem && hoveredItem.p.href && hoveredItem.p.href !== "#") {
      window.open(hoveredItem.p.href, "_blank", "noopener");
    }
  }

  return {
    name: "artifacts",
    scene,
    camera,
    update,
    click,
    measure,
    hideHud,
    setPixelRatio(pr) { dust.mat.uniforms.uPR.value = pr; },
    get hovering() { return false; },
    get cursor() { return grabbed ? "grabbing" : hoveredItem ? "grab" : ""; },
    get capturing() { return !!grabbed; },
    get spinSpeed() { return spinSpeed; },
  };
}
