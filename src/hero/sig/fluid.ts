// Small stable-fluids sim (advect / divergence / pressure / gradient), the
// shape of haoqi.design's FluidPushPass: the pointer splats velocity (and a
// trail "dye"), nothing else feeds it, and the field decays back to still.
// Velocity is in sim texels per second.
import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const ADVECT = /* glsl */ `
  uniform sampler2D uVel; uniform sampler2D uSource; uniform vec2 uTexel; uniform float uDt; uniform float uDissipation;
  varying vec2 vUv;
  void main() {
    vec2 coord = vUv - uDt * texture2D(uVel, vUv).xy * uTexel;
    gl_FragColor = vec4(texture2D(uSource, coord).xy / (1.0 + uDissipation * uDt), 0.0, 1.0);
  }
`;

const SPLAT = /* glsl */ `
  uniform sampler2D uVel; uniform vec2 uPoint; uniform vec2 uForce; uniform float uRadius; uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - uPoint) * vec2(uAspect, 1.0);
    vec2 v = texture2D(uVel, vUv).xy + uForce * exp(-dot(p, p) / uRadius);
    gl_FragColor = vec4(v, 0.0, 1.0);
  }
`;

const DIVERGENCE = /* glsl */ `
  uniform sampler2D uVel; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float L = texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uVel, vUv - vec2(0.0, uTexel.y)).y;
    float T = texture2D(uVel, vUv + vec2(0.0, uTexel.y)).y;
    vec2 c = texture2D(uVel, vUv).xy;
    if (vUv.x - uTexel.x < 0.0) L = -c.x;
    if (vUv.x + uTexel.x > 1.0) R = -c.x;
    if (vUv.y - uTexel.y < 0.0) B = -c.y;
    if (vUv.y + uTexel.y > 1.0) T = -c.y;
    gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
  }
`;

const PRESSURE = /* glsl */ `
  uniform sampler2D uPressure; uniform sampler2D uDiv; uniform vec2 uTexel; uniform float uKeep;
  varying vec2 vUv;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float d = texture2D(uDiv, vUv).x;
    gl_FragColor = vec4(((L + R + B + T) * uKeep - d) * 0.25, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT = /* glsl */ `
  uniform sampler2D uPressure; uniform sampler2D uVel; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 v = texture2D(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
    gl_FragColor = vec4(v, 0.0, 1.0);
  }
`;

type Uniforms = Record<string, THREE.IUniform>;

function makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

export interface FluidOptions {
  res?: number;
  iterations?: number;
  dissipation?: number;
  dyeDissipation?: number;
}

export class Fluid {
  readonly res: number;
  readonly texel = new THREE.Vector2();
  private readonly iterations: number;
  private readonly dissipation: number;
  private readonly dyeDissipation: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly advect: THREE.ShaderMaterial;
  private readonly splatM: THREE.ShaderMaterial;
  private readonly divM: THREE.ShaderMaterial;
  private readonly presM: THREE.ShaderMaterial;
  private readonly gradM: THREE.ShaderMaterial;
  private velA!: THREE.WebGLRenderTarget;
  private velB!: THREE.WebGLRenderTarget;
  private div!: THREE.WebGLRenderTarget;
  private presA!: THREE.WebGLRenderTarget;
  private presB!: THREE.WebGLRenderTarget;
  private dyeA!: THREE.WebGLRenderTarget;
  private dyeB!: THREE.WebGLRenderTarget;
  private energy = 0;
  private still = false;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, opts: FluidOptions = {}) {
    this.renderer = renderer;
    this.res = opts.res ?? 128;
    this.iterations = opts.iterations ?? 6;
    this.dissipation = opts.dissipation ?? 2.2;
    this.dyeDissipation = opts.dyeDissipation ?? 0.8;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mat = (frag: string, uniforms: Uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.advect = mat(ADVECT, { uVel: { value: null }, uSource: { value: null }, uTexel: { value: this.texel }, uDt: { value: 0 }, uDissipation: { value: this.dissipation } });
    this.splatM = mat(SPLAT, { uVel: { value: null }, uPoint: { value: new THREE.Vector2() }, uForce: { value: new THREE.Vector2() }, uRadius: { value: 0.002 }, uAspect: { value: 1 } });
    this.divM = mat(DIVERGENCE, { uVel: { value: null }, uTexel: { value: this.texel } });
    this.presM = mat(PRESSURE, { uPressure: { value: null }, uDiv: { value: null }, uTexel: { value: this.texel }, uKeep: { value: 0.8 } });
    this.gradM = mat(GRADIENT, { uPressure: { value: null }, uVel: { value: null }, uTexel: { value: this.texel } });
    this.resize(1);
  }

  resize(aspect: number): void {
    const h = this.res;
    const w = Math.max(8, Math.round(h * aspect));
    this.disposeTargets();
    this.velA = makeTarget(w, h);
    this.velB = makeTarget(w, h);
    this.div = makeTarget(w, h);
    this.presA = makeTarget(w, h);
    this.presB = makeTarget(w, h);
    this.dyeA = makeTarget(w, h);
    this.dyeB = makeTarget(w, h);
    this.texel.set(1 / w, 1 / h);
    this.splatM.uniforms.uAspect!.value = aspect;
  }

  get velocity(): THREE.Texture {
    return this.velA.texture;
  }

  /** The pointer's trail "dye" (x channel): carried by the flow, thins out slowly. */
  get dye(): THREE.Texture {
    return this.dyeA.texture;
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  private swapVel(): void {
    const t = this.velA;
    this.velA = this.velB;
    this.velB = t;
  }

  private swapDye(): void {
    const t = this.dyeA;
    this.dyeA = this.dyeB;
    this.dyeB = t;
  }

  /** uv in 0..1 (y up), force in texels/second, optional trail dye. */
  splat(u: number, v: number, fx: number, fy: number, radius = 0.0018, ink = 0): void {
    const m = this.splatM.uniforms;
    m.uVel!.value = this.velA.texture;
    (m.uPoint!.value as THREE.Vector2).set(u, v);
    (m.uForce!.value as THREE.Vector2).set(fx, fy);
    m.uRadius!.value = radius;
    this.pass(this.splatM, this.velB);
    this.swapVel();
    if (ink > 0) {
      m.uVel!.value = this.dyeA.texture;
      (m.uForce!.value as THREE.Vector2).set(ink, 0);
      m.uRadius!.value = radius * 0.7;
      this.pass(this.splatM, this.dyeB);
      this.swapDye();
    }
    this.energy = 1;
  }

  step(dt: number): void {
    // Fully still: skip the whole sim once the field has decayed to nothing.
    this.energy *= Math.exp(-Math.min(this.dissipation, this.dyeDissipation) * dt * 0.6);
    if (this.energy < 0.002) {
      if (!this.still) {
        this.still = true;
        this.renderer.setClearColor(0x000000, 0);
        for (const t of [this.velA, this.dyeA]) {
          this.renderer.setRenderTarget(t);
          this.renderer.clear();
        }
      }
      return;
    }
    this.still = false;

    this.divM.uniforms.uVel!.value = this.velA.texture;
    this.pass(this.divM, this.div);

    this.presM.uniforms.uDiv!.value = this.div.texture;
    for (let i = 0; i < this.iterations; i++) {
      this.presM.uniforms.uPressure!.value = this.presA.texture;
      this.pass(this.presM, this.presB);
      const t = this.presA;
      this.presA = this.presB;
      this.presB = t;
    }

    this.gradM.uniforms.uPressure!.value = this.presA.texture;
    this.gradM.uniforms.uVel!.value = this.velA.texture;
    this.pass(this.gradM, this.velB);
    this.swapVel();

    const a = this.advect.uniforms;
    a.uVel!.value = this.velA.texture;
    a.uDt!.value = dt;
    a.uSource!.value = this.dyeA.texture;
    a.uDissipation!.value = this.dyeDissipation;
    this.pass(this.advect, this.dyeB);
    this.swapDye();

    a.uSource!.value = this.velA.texture;
    a.uDissipation!.value = this.dissipation;
    this.pass(this.advect, this.velB);
    this.swapVel();
  }

  private disposeTargets(): void {
    for (const t of [this.velA, this.velB, this.div, this.presA, this.presB, this.dyeA, this.dyeB]) t?.dispose();
  }

  dispose(): void {
    this.disposeTargets();
    for (const m of [this.advect, this.splatM, this.divM, this.presM, this.gradM]) m.dispose();
    this.quad.geometry.dispose();
  }
}
