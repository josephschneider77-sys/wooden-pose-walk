import {
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import type { WoodenMannequin } from "./mannequin";
import { BodyShell } from "./bodyShell";
import { debugMode, graphicsTier } from "./quality";
import { createCloakWeave } from "./weaveFabric";
import { WovenSheet } from "./wovenCloth";

/**
 * Shoulder cloak driven by the simulated-cloth skill's woven sheet:
 * yarn stretch, shear locking, bending, air drag, and frictional contact
 * with the wooden torso. The 96×96 WebGPU hash is replaced by this
 * cape-sized CPU tier (see README).
 */
const CAPE_LENGTH = 1.05;
const CAPE_WIDTH = 0.96;
const DENSITY = 0.42;
const GRAVITY = -9.81;
const COLLAR_A0 = Math.PI * 0.4;
const COLLAR_A1 = Math.PI * 1.6;
const SPIKE = 0.05;
const GROUND_MU = 0.32;
const BODY_MU = 0.22;

const _force = new Vector3();
const _normal = new Vector3();
const _wind = new Vector3();
const _yoke = new Vector3();
const _neck = new Vector3();
const _tang = new Vector3();

function bodyFrame(
  figure: WoodenMannequin,
  localX: number,
  localY: number,
  localZ: number,
  out: Vector3,
): void {
  figure.worldPos("neck", _neck);
  const yaw = figure.bone("root").rotation.y;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  out.set(
    _neck.x + localX * cos + localZ * sin,
    _neck.y + localY,
    _neck.z - localX * sin + localZ * cos,
  );
}

/** Horseshoe collar: left shoulder → nape → right shoulder, then down the back. */
function cloakSurface(
  figure: WoodenMannequin,
  u: number,
  v: number,
  out: Vector3,
): void {
  const a = COLLAR_A0 + u * (COLLAR_A1 - COLLAR_A0);
  const side = Math.abs(Math.sin(a));
  const radius = 0.145 + v * 0.26 + side * 0.03;
  const localX = Math.sin(a) * radius;
  const localZ = Math.cos(a) * radius - v * 0.02;
  const shoulderLift = side * 0.05 * (1 - v);
  bodyFrame(figure, localX, -0.02 - v * CAPE_LENGTH + shoulderLift, localZ, out);
}

function applyFriction(velocity: Vector3, normal: Vector3, mu: number, dt: number): void {
  const vn = velocity.dot(normal);
  if (vn < 0) velocity.addScaledVector(normal, -vn);
  _tang.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
  const ts = _tang.length();
  const dv = mu * 9.81 * Math.max(normal.y, 0) * dt;
  if (ts > 1e-8 && dv > 0) {
    if (ts <= dv) velocity.addScaledVector(_tang, -1);
    else velocity.addScaledVector(_tang, -dv / ts);
  }
}

export class ClothCape {
  readonly mesh: Mesh;
  private readonly figure: WoodenMannequin;
  private readonly sheet: WovenSheet;
  private readonly geometry: PlaneGeometry;
  private readonly shell = new BodyShell();
  private readonly substeps: number;
  private readonly strain: number;
  private readonly groundScratch = new Vector3();

  constructor(figure: WoodenMannequin) {
    this.figure = figure;
    const tier = graphicsTier();
    const w = tier === "mobile" ? 16 : 26;
    const h = tier === "mobile" ? 20 : 32;
    this.substeps = tier === "mobile" ? 2 : 3;
    this.strain = tier === "mobile" ? 2 : 3;
    this.figure.refreshWorld();
    this.sheet = new WovenSheet(w, h, CAPE_WIDTH, CAPE_LENGTH, DENSITY, (u, v, out) => {
      cloakSurface(this.figure, u, v, out);
    });

    this.geometry = new PlaneGeometry(1, 1, w, h);
    const uv = this.geometry.attributes.uv;
    if (uv) {
      for (let v = 0; v <= h; v++) {
        for (let u = 0; u <= w; u++) {
          uv.setXY(u + v * (w + 1), u / w, 1 - v / h);
        }
      }
      this.geometry.setAttribute("uv2", uv.clone());
    }
    const weave = createCloakWeave(tier === "mobile" ? 384 : 512);
    const material = new MeshPhysicalMaterial({
      name: "cloak-weave",
      map: weave.albedo,
      normalMap: weave.normal,
      normalScale: weave.normalScale,
      roughnessMap: weave.rough,
      aoMap: weave.ao,
      aoMapIntensity: 0.75,
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      sheen: 0.62,
      sheenRoughness: 0.48,
      sheenColor: "#4a4038",
      anisotropy: 0.42,
      side: DoubleSide,
      envMapIntensity: 0.4,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "cloak";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    if (debugMode("cloth") === "wire") material.wireframe = true;

    this.pinCollar();
    for (let i = 0; i < 36; i++) this.substep(1 / 60, 0, 0, 0, () => 0);
    this.writeGeometry();
  }

  update(
    dt: number,
    time: number,
    walkSpeed: number,
    yaw = 0,
    floorAt: (x: number, z: number) => number = () => 0,
  ): void {
    const steps = this.substeps;
    const h = Math.min(dt, 0.05) / steps || 1 / 180;
    for (let i = 0; i < steps; i++) this.substep(h, time, walkSpeed, yaw, floorAt);
    this.writeGeometry();
  }

  private substep(
    dt: number,
    time: number,
    walkSpeed: number,
    yaw: number,
    floorAt: (x: number, z: number) => number,
  ): void {
    this.figure.refreshWorld();
    this.pinCollar();
    const facing = this.figure.bone("root").rotation.y;
    _wind.set(-Math.sin(yaw), 0.04, -Math.cos(yaw)).multiplyScalar(0.55 + walkSpeed * 1.15);
    _wind.x += Math.sin(time * 0.8) * 0.28;
    _wind.z += Math.cos(time * 0.55) * 0.18;

    this.sheet.integrate(dt, _wind, GRAVITY);
    for (let n = 0; n < this.strain; n++) {
      this.sheet.structural();
      this.sheet.shear(dt);
      this.sheet.bend(dt);
      this.pinCollar();
    }
    this.softYoke();
    this.sheet.separateFolds();
    this.sheet.flattenSpikes(SPIKE);
    this.pinCollar();

    this.shell.refresh(this.figure);
    const back = _force.set(-Math.sin(facing), 0, -Math.cos(facing));
    this.shell.resolve(this.sheet.points, this.sheet.w + 1, false, back);

    for (let i = this.sheet.w + 1; i < this.sheet.points.length; i++) {
      const p = this.sheet.points[i]!;
      const gy = floorAt(p.position.x, p.position.z) + 0.008;
      if (p.position.y < gy) {
        const lift = gy - p.position.y;
        p.position.y = gy;
        p.previous.y += lift;
      }
    }

    this.sheet.finishVelocity(dt);
    for (let i = this.sheet.w + 1; i < this.sheet.points.length; i++) {
      const p = this.sheet.points[i]!;
      const gy = floorAt(p.position.x, p.position.z) + 0.008;
      if (p.position.y <= gy + 0.0015) {
        applyFriction(p.velocity, this.groundScratch.set(0, 1, 0), GROUND_MU, dt);
      }
      if (this.shell.contactNormal(p.position, _normal)) {
        applyFriction(p.velocity, _normal, BODY_MU, dt);
      }
    }
    this.pinCollar();
  }

  private pinCollar(): void {
    for (let u = 0; u <= this.sheet.w; u++) {
      const p = this.sheet.points[this.sheet.index(u, 0)]!;
      cloakSurface(this.figure, u / this.sheet.w, 0, p.position);
      p.previous.copy(p.position);
      p.velocity.set(0, 0, 0);
      p.invMass = 0;
    }
  }

  private softYoke(): void {
    for (let u = 0; u <= this.sheet.w; u++) {
      cloakSurface(this.figure, u / this.sheet.w, 0.08, _yoke);
      const p = this.sheet.points[this.sheet.index(u, 1)]!;
      p.position.lerp(_yoke, 0.18);
    }
  }

  private writeGeometry(): void {
    const pos = this.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < this.sheet.points.length; i++) {
      const p = this.sheet.points[i]!;
      pos.setXYZ(i, p.position.x, p.position.y, p.position.z);
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
