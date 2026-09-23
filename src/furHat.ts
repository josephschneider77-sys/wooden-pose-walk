import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import type { Camera } from "three";
import type { WoodenMannequin } from "./mannequin";
import { debugMode, graphicsTier } from "./quality";

/**
 * Cozy fur hat. Shell layers carry the dense coat; a reduced strand field
 * follows the simulated-fur skill's groom, Verlet step, and Kajiya-Kay lobes
 * (examples/simulated-fur, MIT, © 2026 Scott Sun).
 *
 * The gallery dispatches 420032 GPU strands. This WebGL2 tier uses a few
 * thousand head-local strands plus shell slices so the hat stays attached
 * through the walk and still reads as fur, not a photoreal pelt.
 */
const POINTS = 5;
const COAT = {
  main: new Color("#c4894a"),
  cream: new Color("#f6ead2"),
  stripe: new Color("#6b3e24"),
};

const SHELL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vNormal;
varying vec2 vUv;
uniform float uLayer;
uniform float uLength;
uniform vec3 uWind;
uniform float uTime;
void main() {
  vUv = uv;
  vec3 n = normalize(normal);
  float gust = sin(uTime * 1.3 + position.x * 11.0 + position.z * 7.0) * 0.5 + 0.5;
  vec3 displaced = position + n * (uLength * uLayer);
  displaced += vec3(0.0, -0.42, 0.02) * uLength * uLayer * uLayer;
  displaced += uWind * (uLength * uLayer * gust);
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vNormal = normalize(mat3(modelMatrix) * n);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHELL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vNormal;
varying vec2 vUv;
uniform float uLayer;
uniform vec3 uKey;
uniform vec3 uKeyColor;
uniform vec3 uFill;
uniform vec3 uFillColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 cell = floor(vUv * vec2(78.0, 42.0));
  float n = hash(cell);
  float cream = smoothstep(0.62, 0.9, hash(cell + 19.2));
  float stripe = smoothstep(0.58, 0.86, hash(cell * 0.37 + 4.0));
  vec3 albedo = mix(vec3(0.769, 0.537, 0.290), vec3(0.420, 0.243, 0.141), stripe * 0.9);
  albedo = mix(albedo, vec3(0.965, 0.918, 0.824), cream * 0.62);
  float cutoff = mix(0.05, 0.72, pow(uLayer, 0.9));
  if (n < cutoff) discard;
  float along = clamp(uLayer, 0.0, 1.0);
  albedo *= mix(0.5, 1.05, pow(along, 0.55));
  vec3 N = normalize(vNormal);
  float key = smoothstep(-0.15, 0.65, dot(N, normalize(uKey)));
  float fill = smoothstep(-0.2, 0.7, dot(N, normalize(uFill))) * 0.45;
  float hemi = N.y * 0.5 + 0.5;
  vec3 color = albedo * (vec3(0.93, 0.86, 0.74) * (0.22 + 0.38 * hemi) + uKeyColor * key + uFillColor * fill);
  color *= mix(0.55, 1.0, pow(along, 0.8));
  float alpha = mix(0.94, 0.42, along) * (1.0 - smoothstep(0.0, 0.12, cutoff - n + 0.08));
  gl_FragColor = vec4(color, alpha);
  #include <fog_fragment>
}
`;

const RIBBON_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aNormal;
attribute vec3 aTangent;
attribute vec3 aColor;
attribute float aAlong;
attribute float aSide;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vColor;
varying vec3 vPos;
varying float vAlong;
varying float vSide;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * aNormal);
  vTangent = normalize(mat3(modelMatrix) * aTangent);
  vColor = aColor;
  vAlong = aAlong;
  vSide = aSide;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const RIBBON_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vColor;
varying vec3 vPos;
varying float vAlong;
varying float vSide;
uniform vec3 uKey;
uniform vec3 uKeyColor;
uniform vec3 uFill;
uniform vec3 uFillColor;
uniform vec3 uRim;
uniform vec3 uRimColor;
uniform vec3 uSky;
uniform vec3 uGround;

void main() {
  vec3 T = normalize(vTangent);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vPos);
  float t = clamp(vAlong, 0.0, 1.0);
  vec3 albedo = vColor * mix(0.48, 1.02, pow(t, 0.6));
  float ao = mix(0.18, 1.0, pow(t, 1.05));
  vec3 col = albedo * mix(uGround, uSky, N.y * 0.5 + 0.5) * ao;
  vec3 lights[3];
  vec3 colors[3];
  lights[0] = normalize(uKey);
  lights[1] = normalize(uFill);
  lights[2] = normalize(uRim);
  colors[0] = uKeyColor;
  colors[1] = uFillColor;
  colors[2] = uRimColor;
  for (int i = 0; i < 3; i++) {
    vec3 Ld = lights[i];
    float TL = dot(T, Ld);
    float sinTL = sqrt(clamp(1.0 - TL * TL, 0.0, 1.0));
    float vis = smoothstep(-0.4, 0.55, dot(N, Ld)) * mix(0.22, 1.0, t);
    vec3 H = normalize(Ld + V);
    float th1 = dot(normalize(T + N * -0.1), H);
    float th2 = dot(normalize(T + N * 0.15), H);
    float specR = pow(clamp(1.0 - th1 * th1, 0.0, 1.0), 70.0) * 0.16;
    float specTRT = pow(clamp(1.0 - th2 * th2, 0.0, 1.0), 18.0) * 0.5;
    float diff = mix(0.45, 1.0, sinTL) * 0.85;
    col += albedo * colors[i] * diff * vis;
    col += colors[i] * (specR + specTRT) * vis;
  }
  float edge = 1.0 - abs(dot(N, V));
  col += albedo * edge * 0.12;
  float sideFade = 1.0 - pow(abs(vSide), 4.0);
  float tipFade = 1.0 - smoothstep(0.8, 1.0, t);
  if (sideFade * tipFade < 0.22) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

function hash01(i: number): number {
  let h = Math.imul(i, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shellMaterial(layer: number, length: number): ShaderMaterial {
  const uniforms = UniformsUtils.clone(
    UniformsUtils.merge([
      UniformsLib.fog,
      {
        uLayer: { value: layer },
        uLength: { value: length },
        uWind: { value: new Vector3() },
        uTime: { value: 0 },
        uKey: { value: new Vector3(5.1, 7.4, 3.2).normalize() },
        uKeyColor: { value: new Vector3(1.55, 1.32, 0.95) },
        uFill: { value: new Vector3(-5.4, 3.4, -2.2).normalize() },
        uFillColor: { value: new Vector3(0.35, 0.42, 0.55) },
      },
    ]),
  );
  const material = new ShaderMaterial({
    name: "fur-shell",
    uniforms,
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: layer < 0.34,
    side: DoubleSide,
    fog: true,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1 - layer;
  material.polygonOffsetUnits = -1 - layer;
  return material;
}

export class FurHat {
  readonly group = new Group();
  private readonly shells: ShaderMaterial[] = [];
  private readonly ribbonMat: ShaderMaterial;
  private readonly ribbonGeo: BufferGeometry;
  private readonly count: number;
  private readonly root: Float32Array;
  private readonly nrm: Float32Array;
  private readonly flow: Float32Array;
  private readonly segLen: Float32Array;
  private readonly bendA: Float32Array;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly tanAttr: BufferAttribute;
  private readonly camLocal = new Vector3();
  private readonly windWorld = new Vector3();
  private readonly windLocal = new Vector3();
  private readonly gravity = new Vector3();
  private readonly quat = new Quaternion();
  private readonly shellWind = new Vector3();

  constructor(figure: WoodenMannequin) {
    const tier = graphicsTier();
    const shellCount = tier === "mobile" ? 5 : 8;
    this.count = tier === "mobile" ? 720 : 1500;
    this.group.name = "fur-hat";
    this.group.position.set(0, 0.118, -0.02);
    figure.bone("head").add(this.group);

    const leather = new MeshPhysicalMaterial({
      name: "hat-leather",
      color: "#6d4a32",
      roughness: 0.64,
      metalness: 0.02,
      sheen: 0.16,
      sheenColor: "#d7be9a",
      sheenRoughness: 0.58,
      clearcoat: 0.06,
      clearcoatRoughness: 0.42,
    });
    const domeGeo = new SphereGeometry(0.116, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const dome = new Mesh(domeGeo, leather);
    dome.castShadow = true;
    dome.receiveShadow = true;
    dome.name = "hat-dome";
    this.group.add(dome);

    const band = new Mesh(new TorusGeometry(0.108, 0.011, 8, 28), leather);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.012;
    band.castShadow = true;
    this.group.add(band);

    const flapGeo = new SphereGeometry(0.058, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.78);
    flapGeo.scale(0.85, 1.7, 0.38);
    flapGeo.translate(0, -0.07, 0);
    const flaps: Mesh[] = [];
    for (const sign of [-1, 1]) {
      const flap = new Mesh(flapGeo, leather);
      flap.position.set(sign * 0.095, -0.02, -0.02);
      flap.rotation.z = sign * -0.18;
      flap.castShadow = true;
      flap.name = sign < 0 ? "hat-flap-left" : "hat-flap-right";
      this.group.add(flap);
      flaps.push(flap);
    }

    const pomGeo = new SphereGeometry(0.038, 12, 10);
    const pom = new Mesh(pomGeo, leather);
    pom.position.set(0, 0.112, 0);
    pom.castShadow = true;
    pom.name = "hat-pom";
    this.group.add(pom);

    const furMode = debugMode("fur");
    if (furMode !== "strands") {
      this.addShells(dome, shellCount, 0.036, 2);
      for (const flap of flaps) this.addShells(flap, Math.max(3, shellCount - 3), 0.028, 3);
      this.addShells(pom, Math.max(4, shellCount - 2), 0.03, 4);
    }

    this.root = new Float32Array(this.count * 3);
    this.nrm = new Float32Array(this.count * 3);
    this.flow = new Float32Array(this.count * 3);
    this.segLen = new Float32Array(this.count);
    this.bendA = new Float32Array(this.count);
    this.pos = new Float32Array(this.count * POINTS * 3);
    this.prev = new Float32Array(this.count * POINTS * 3);
    this.placeStrands();

    const vertCount = this.count * POINTS * 2;
    this.ribbonGeo = new BufferGeometry();
    this.posAttr = new BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.tanAttr = new BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.tanAttr.setUsage(DynamicDrawUsage);
    const normals = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const along = new Float32Array(vertCount);
    const side = new Float32Array(vertCount);
    for (let s = 0; s < this.count; s++) {
      for (let i = 0; i < POINTS; i++) {
        for (const k of [0, 1]) {
          const v = (s * POINTS + i) * 2 + k;
          normals[v * 3] = this.nrm[s * 3]!;
          normals[v * 3 + 1] = this.nrm[s * 3 + 1]!;
          normals[v * 3 + 2] = this.nrm[s * 3 + 2]!;
          along[v] = i / (POINTS - 1);
          side[v] = k === 0 ? -1 : 1;
        }
      }
    }
    this.ribbonGeo.setAttribute("position", this.posAttr);
    this.ribbonGeo.setAttribute("aTangent", this.tanAttr);
    this.ribbonGeo.setAttribute("aNormal", new BufferAttribute(normals, 3));
    this.ribbonGeo.setAttribute("aColor", new BufferAttribute(colors, 3));
    this.ribbonGeo.setAttribute("aAlong", new BufferAttribute(along, 1));
    this.ribbonGeo.setAttribute("aSide", new BufferAttribute(side, 1));
    const indices: number[] = [];
    for (let s = 0; s < this.count; s++) {
      const base = s * POINTS * 2;
      for (let i = 0; i < POINTS - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.ribbonGeo.setIndex(indices);
    this.ribbonGeo.boundingSphere = new Sphere(new Vector3(0, 0.02, 0), 0.4);
    this.paintRibbonColors();

    this.ribbonMat = new ShaderMaterial({
      name: "fur-ribbon",
      uniforms: UniformsUtils.clone(
        UniformsUtils.merge([
          UniformsLib.fog,
          {
            uKey: { value: new Vector3(5.1, 7.4, 3.2).normalize() },
            uKeyColor: { value: new Vector3(1.55, 1.32, 0.95) },
            uFill: { value: new Vector3(-5.4, 3.4, -2.2).normalize() },
            uFillColor: { value: new Vector3(0.32, 0.4, 0.52) },
            uRim: { value: new Vector3(-2.2, 4.6, -5.4).normalize() },
            uRimColor: { value: new Vector3(0.7, 0.58, 0.42) },
            uSky: { value: new Color("#f4efe4") },
            uGround: { value: new Color("#8d704c") },
          },
        ]),
      ),
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      side: DoubleSide,
      fog: true,
    });
    const ribbons = new Mesh(this.ribbonGeo, this.ribbonMat);
    ribbons.name = "fur-strands";
    ribbons.frustumCulled = false;
    ribbons.renderOrder = 6;
    ribbons.visible = furMode !== "base";
    this.group.add(ribbons);
    this.writeRibbons();
  }

  update(dt: number, time: number, camera: Camera, walkSpeed: number, yaw: number): void {
    void dt;
    this.group.updateWorldMatrix(true, false);
    this.camLocal.copy(camera.position);
    this.group.worldToLocal(this.camLocal);
    this.group.getWorldQuaternion(this.quat);
    this.quat.invert();
    this.windWorld.set(-Math.sin(yaw), 0.12, -Math.cos(yaw));
    this.windWorld.multiplyScalar(0.45 + walkSpeed);
    this.windWorld.x += Math.sin(time * 1.15) * 0.35;
    this.windWorld.z += Math.cos(time * 0.7) * 0.2;
    this.windLocal.copy(this.windWorld).applyQuaternion(this.quat);
    this.gravity.set(0, -1.6 / 3600, 0).applyQuaternion(this.quat);
    this.shellWind.copy(this.windLocal);
    if (this.shellWind.lengthSq() > 1e-8) this.shellWind.normalize().multiplyScalar(0.9);
    for (const material of this.shells) {
      const wind = material.uniforms.uWind?.value as Vector3;
      wind.copy(this.shellWind);
      material.uniforms.uTime!.value = time;
    }
    this.stepStrands(time);
    this.writeRibbons();
  }

  private addShells(host: Mesh, layers: number, length: number, order: number): void {
    for (let i = 1; i <= layers; i++) {
      const layer = i / layers;
      const material = shellMaterial(layer, length);
      const mesh = new Mesh(host.geometry, material);
      mesh.position.copy(host.position);
      mesh.quaternion.copy(host.quaternion);
      mesh.scale.copy(host.scale);
      mesh.renderOrder = order + i;
      mesh.frustumCulled = false;
      mesh.visible = debugMode("fur") !== "base";
      this.group.add(mesh);
      this.shells.push(material);
    }
  }

  private placeStrands(): void {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let s = 0; s < this.count; s++) {
      const y = 0.22 + (1 - s / (this.count - 1)) * 0.78;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = s * golden;
      const dx = Math.cos(theta) * ring;
      const dy = y;
      const dz = Math.sin(theta) * ring;
      const radius = 0.118;
      const ox = dx * radius;
      const oy = dy * radius - 0.01;
      const oz = dz * radius + 0.008;
      this.root[s * 3] = ox;
      this.root[s * 3 + 1] = oy;
      this.root[s * 3 + 2] = oz;
      this.nrm[s * 3] = dx;
      this.nrm[s * 3 + 1] = dy;
      this.nrm[s * 3 + 2] = dz;
      let fx = dx * 0.25;
      let fy = -0.55;
      let fz = dz * 0.25 - 0.15;
      const gn = fx * dx + fy * dy + fz * dz;
      fx -= dx * gn;
      fy -= dy * gn;
      fz -= dz * gn;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const spin = (hash01(s * 3 + 1) - 0.5) * 0.5;
      const bx = dy * fz - dz * fy;
      const by = dz * fx - dx * fz;
      const bz = dx * fy - dy * fx;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      this.flow[s * 3] = (fx / fl) * cs + bx * sn;
      this.flow[s * 3 + 1] = (fy / fl) * cs + by * sn;
      this.flow[s * 3 + 2] = (fz / fl) * cs + bz * sn;
      const clump = hash01(s * 5 + 9);
      const len = 0.034 * (0.78 + 0.48 * hash01(s + 2)) * (0.82 + 0.36 * clump);
      this.segLen[s] = len / (POINTS - 1);
      this.bendA[s] = 0.72 * (0.85 + 0.3 * hash01(s + 4));
      this.growRest(s);
    }
  }

  private growRest(s: number): void {
    const seg = this.segLen[s]!;
    const bend = this.bendA[s]!;
    let x = this.root[s * 3]!;
    let y = this.root[s * 3 + 1]!;
    let z = this.root[s * 3 + 2]!;
    const nx = this.nrm[s * 3]!;
    const ny = this.nrm[s * 3 + 1]!;
    const nz = this.nrm[s * 3 + 2]!;
    const fx = this.flow[s * 3]!;
    const fy = this.flow[s * 3 + 1]!;
    const fz = this.flow[s * 3 + 2]!;
    for (let i = 0; i < POINTS; i++) {
      const idx = (s * POINTS + i) * 3;
      this.pos[idx] = x;
      this.pos[idx + 1] = y;
      this.pos[idx + 2] = z;
      this.prev[idx] = x;
      this.prev[idx + 1] = y;
      this.prev[idx + 2] = z;
      if (i === POINTS - 1) break;
      const t = (i + 1) / (POINTS - 1);
      const theta = Math.min(bend * (0.45 + 0.8 * t), 1.45);
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      x += (nx * c + fx * sn) * seg;
      y += (ny * c + fy * sn) * seg;
      z += (nz * c + fz * sn) * seg;
    }
  }

  private paintRibbonColors(): void {
    const colors = this.ribbonGeo.getAttribute("aColor") as BufferAttribute;
    const main = COAT.main;
    const cream = COAT.cream;
    const stripe = COAT.stripe;
    for (let s = 0; s < this.count; s++) {
      const creamW = hash01(s * 11 + 3) > 0.72 ? 0.85 : hash01(s * 13) * 0.18;
      const stripeW = hash01(s * 17 + 8) > 0.78 ? 0.9 : 0;
      const rnd = 0.86 + hash01(s * 19) * 0.28;
      const r = (main.r * (1 - stripeW) + stripe.r * stripeW) * (1 - creamW) + cream.r * creamW;
      const g = (main.g * (1 - stripeW) + stripe.g * stripeW) * (1 - creamW) + cream.g * creamW;
      const b = (main.b * (1 - stripeW) + stripe.b * stripeW) * (1 - creamW) + cream.b * creamW;
      for (let i = 0; i < POINTS; i++) {
        for (const k of [0, 1]) {
          const v = (s * POINTS + i) * 2 + k;
          colors.setXYZ(v, r * rnd, g * rnd, b * rnd);
        }
      }
    }
    colors.needsUpdate = true;
  }

  private stepStrands(time: number): void {
    for (let s = 0; s < this.count; s++) {
      const nx = this.nrm[s * 3]!;
      const ny = this.nrm[s * 3 + 1]!;
      const nz = this.nrm[s * 3 + 2]!;
      const fx = this.flow[s * 3]!;
      const fy = this.flow[s * 3 + 1]!;
      const fz = this.flow[s * 3 + 2]!;
      const rx = this.root[s * 3]!;
      const ry = this.root[s * 3 + 1]!;
      const rz = this.root[s * 3 + 2]!;
      const seg = this.segLen[s]!;
      const bend = this.bendA[s]!;
      const base = s * POINTS;
      this.pos[base * 3] = rx;
      this.pos[base * 3 + 1] = ry;
      this.pos[base * 3 + 2] = rz;
      let px = rx;
      let py = ry;
      let pz = rz;
      const gust =
        (Math.sin(time * 1.3 + rx * 3 + rz * 2) * 0.5 + 0.5) *
        (Math.sin(time * 0.37 + ry * 1.7) * 0.5 + 0.5);
      for (let i = 1; i < POINTS; i++) {
        const idx = (base + i) * 3;
        const x = this.pos[idx]!;
        const y = this.pos[idx + 1]!;
        const z = this.pos[idx + 2]!;
        const ox = this.prev[idx]!;
        const oy = this.prev[idx + 1]!;
        const oz = this.prev[idx + 2]!;
        const t = i / (POINTS - 1);
        let qx = x + (x - ox) * 0.9 + this.gravity.x;
        let qy = y + (y - oy) * 0.9 + this.gravity.y;
        let qz = z + (z - oz) * 0.9 + this.gravity.z;
        const wind = 0.0024 * gust * t;
        qx += this.windLocal.x * wind;
        qy += this.windLocal.y * wind;
        qz += this.windLocal.z * wind;
        const theta = Math.min(bend * (0.45 + 0.8 * t), 1.45);
        const c = Math.cos(theta);
        const sn = Math.sin(theta);
        const jitter = (hash01(s * 31 + i * 17) - 0.5) * 0.16;
        let rdx = nx * c + fx * sn + jitter;
        let rdy = ny * c + fy * sn + jitter * 0.4;
        let rdz = nz * c + fz * sn - jitter * 0.3;
        const rl = Math.hypot(rdx, rdy, rdz) || 1;
        rdx /= rl;
        rdy /= rl;
        rdz /= rl;
        const stiff = 0.36 * (1 - t) + 0.12 * t;
        const tx = px + rdx * seg;
        const ty = py + rdy * seg;
        const tz = pz + rdz * seg;
        qx = qx * (1 - stiff) + tx * stiff;
        qy = qy * (1 - stiff) + ty * stiff;
        qz = qz * (1 - stiff) + tz * stiff;
        const h = (qx - rx) * nx + (qy - ry) * ny + (qz - rz) * nz;
        const minH = seg * i * 0.12;
        if (h < minH) {
          qx += nx * (minH - h);
          qy += ny * (minH - h);
          qz += nz * (minH - h);
        }
        let dx = qx - px;
        let dy = qy - py;
        let dz = qz - pz;
        const dl = Math.hypot(dx, dy, dz) || 1e-6;
        dx /= dl;
        dy /= dl;
        dz /= dl;
        qx = px + dx * seg;
        qy = py + dy * seg;
        qz = pz + dz * seg;
        this.prev[idx] = x;
        this.prev[idx + 1] = y;
        this.prev[idx + 2] = z;
        this.pos[idx] = qx;
        this.pos[idx + 1] = qy;
        this.pos[idx + 2] = qz;
        px = qx;
        py = qy;
        pz = qz;
      }
    }
  }

  private writeRibbons(): void {
    const pos = this.posAttr.array as Float32Array;
    const tan = this.tanAttr.array as Float32Array;
    const camX = this.camLocal.x;
    const camY = this.camLocal.y;
    const camZ = this.camLocal.z;
    for (let s = 0; s < this.count; s++) {
      for (let i = 0; i < POINTS; i++) {
        const idx = (s * POINTS + i) * 3;
        const x = this.pos[idx]!;
        const y = this.pos[idx + 1]!;
        const z = this.pos[idx + 2]!;
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(POINTS - 1, i + 1);
        const a = (s * POINTS + i0) * 3;
        const b = (s * POINTS + i1) * 3;
        let tx = this.pos[b]! - this.pos[a]!;
        let ty = this.pos[b + 1]! - this.pos[a + 1]!;
        let tz = this.pos[b + 2]! - this.pos[a + 2]!;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        let sx = ty * (camZ - z) - tz * (camY - y);
        let sy = tz * (camX - x) - tx * (camZ - z);
        let sz = tx * (camY - y) - ty * (camX - x);
        const sl = Math.hypot(sx, sy, sz);
        if (sl < 1e-5) {
          sx = 1;
          sy = 0;
          sz = 0;
        } else {
          sx /= sl;
          sy /= sl;
          sz /= sl;
        }
        const along = i / (POINTS - 1);
        const width = 0.0025 * (1 - along * 0.82);
        const base = (s * POINTS + i) * 2;
        for (const k of [0, 1]) {
          const sign = k === 0 ? -1 : 1;
          const v = (base + k) * 3;
          pos[v] = x + sx * width * sign;
          pos[v + 1] = y + sy * width * sign;
          pos[v + 2] = z + sz * width * sign;
          tan[v] = tx;
          tan[v + 1] = ty;
          tan[v + 2] = tz;
        }
      }
    }
    this.posAttr.needsUpdate = true;
    this.tanAttr.needsUpdate = true;
  }
}
