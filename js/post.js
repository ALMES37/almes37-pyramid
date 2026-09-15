// Постобработка: смешивание двух сцен (переход с песчаным растворением,
// глитчем и радужным сдвигом) + финальный слой (аберрация, виньетка, зерно).
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { GLSL_NOISE } from "./lib/noise.js";

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MIX_FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uMix;
uniform float uHasB;
uniform float uTime;
uniform float uGlitch;
uniform vec3 uHaze;
uniform vec2 uRes;
varying vec2 vUv;
${GLSL_NOISE}

vec3 splitSample(sampler2D t, vec2 uv, float ca){
  return vec3(texture2D(t, uv + vec2(ca, 0.0)).r, texture2D(t, uv).g, texture2D(t, uv - vec2(ca, 0.0)).b);
}

void main(){
  float k = uMix;
  float peak = sin(3.14159265 * k) * uHasB;
  vec2 c = vUv - 0.5;

  // горизонтальные «рваные» полосы, как при сбое сигнала
  float row = floor(vUv.y * 42.0);
  float gn = hash21(vec2(row, floor(uTime * 16.0)));
  float shift = (gn - 0.5) * step(0.7, gn) * 0.12 * peak * uGlitch;
  float blockRow = floor(vUv.y * 9.0);
  shift += (hash21(vec2(blockRow, floor(uTime * 7.0))) - 0.5) * 0.03 * peak * uGlitch;

  float ca = (0.002 + 0.016 * peak) * uGlitch;
  vec2 uvA = 0.5 + c * (1.0 - 0.08 * k * uHasB) + vec2(shift, 0.0);
  vec3 colA = splitSample(tA, uvA, ca);
  vec3 col = colA;

  if (uHasB > 0.5) {
    vec2 uvB = 0.5 + c * (1.0 + 0.1 * (1.0 - k)) + vec2(shift, 0.0);
    vec3 colB = splitSample(tB, uvB, ca);
    vec2 np = vUv * vec2(uRes.x / uRes.y, 1.0) * 3.0;
    float n = fbm2(np + vec2(uTime * 0.08, 0.0));
    float thr = k * 1.5 - 0.25;
    float m = smoothstep(n - 0.12, n + 0.12, thr);
    col = mix(colA, colB, m);
    float edge = 1.0 - abs(m * 2.0 - 1.0);
    // туман/песчаная пелена в середине перехода
    float haze = peak * (0.55 + 0.35 * n);
    col = mix(col, uHaze * 1.08, clamp(haze, 0.0, 0.92));
    col += uHaze * edge * 0.35 * peak;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class SceneMixPass extends Pass {
  constructor(width, height, { samples = 4, haze }) {
    super();
    const opts = { type: THREE.HalfFloatType, samples };
    this.rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this.rtB = new THREE.WebGLRenderTarget(width, height, opts);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: this.rtA.texture },
        tB: { value: this.rtB.texture },
        uMix: { value: 0 },
        uHasB: { value: 0 },
        uTime: { value: 0 },
        uGlitch: { value: 1 },
        uHaze: { value: haze.clone() },
        uRes: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: VERT,
      fragmentShader: MIX_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.a = null; // { scene, camera }
    this.b = null;
    this.mix = 0;
  }

  setSize(w, h) {
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.material.uniforms.uRes.value.set(w, h);
  }

  render(renderer, writeBuffer) {
    if (!this.a) return;
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.render(this.a.scene, this.a.camera);
    const u = this.material.uniforms;
    if (this.b) {
      renderer.setRenderTarget(this.rtB);
      renderer.clear();
      renderer.render(this.b.scene, this.b.camera);
    }
    u.uHasB.value = this.b ? 1 : 0;
    u.uMix.value = this.mix;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.material.dispose(); this.quad.dispose();
  }
}

export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uCA: { value: 0.0015 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.35 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uCA, uGrain, uVignette;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uCA * 8.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 1.6);
      float g = h(vUv * uRes + fract(uTime * 13.7)) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
