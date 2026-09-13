import {
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import type { WoodenMannequin } from "./mannequin";
import { satisfyConstraint, VerletCloth } from "./verletCloth";

const WIDTH_SEGS = 14;
const HEIGHT_SEGS = 18;
const CAPE_LENGTH = 0.98;
const MASS = 0.1;
const GRAVITY = new Vector3(0, -22, 0);
const TIMESTEP = 1 / 60;
const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
const ITERATIONS = 6;
const FLOOR_Y = 0.03;
const COLLAR_A0 = Math.PI * 0.4;
const COLLAR_A1 = Math.PI * 1.6;

const _force = new Vector3();
const _normal = new Vector3();
const _wind = new Vector3();
const _back = new Vector3();
const _forward = new Vector3();
const _left = new Vector3();
const _right = new Vector3();
const _neck = new Vector3();
const _chest = new Vector3();
const _pelvis = new Vector3();
const _hit = new Vector3();
const _yoke = new Vector3();

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

/** Horseshoe collar: left shoulder → nape → right shoulder. */
function cloakSurface(
  figure: WoodenMannequin,
  u: number,
  v: number,
  out: Vector3,
): void {
  const a = COLLAR_A0 + u * (COLLAR_A1 - COLLAR_A0);
  const side = Math.abs(Math.sin(a));
  const radius = 0.13 + v * 0.22 + side * 0.02;
  const localX = Math.sin(a) * radius;
  const localZ = Math.cos(a) * radius - v * 0.03;
  const shoulderLift = side * 0.045 * (1 - v);
  bodyFrame(figure, localX, -0.03 - v * CAPE_LENGTH + shoulderLift, localZ, out);
}

/**
 * Shoulder-wrapped cape using three.js Verlet cloth + ambientCG Fabric008 (CC0).
 * Collar sits on a neck horseshoe instead of a straight back-rod.
 */
export class ClothCape {
  readonly mesh: Mesh;
  private readonly figure: WoodenMannequin;
  private readonly cloth: VerletCloth;
  private readonly geometry: PlaneGeometry;

  constructor(figure: WoodenMannequin) {
    this.figure = figure;
    this.figure.refreshWorld();
    this.cloth = new VerletCloth(WIDTH_SEGS, HEIGHT_SEGS, (u, v, out) => {
      cloakSurface(this.figure, u, v, out);
    });
    for (const p of this.cloth.particles) p.invMass = 1 / MASS;

    this.geometry = new PlaneGeometry(1, 1, WIDTH_SEGS, HEIGHT_SEGS);
    const material = new MeshPhysicalMaterial({
      color: "#111111",
      roughness: 0.94,
      metalness: 0,
      clearcoat: 0,
      sheen: 0.22,
      sheenRoughness: 0.72,
      sheenColor: "#141414",
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "cloak";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.loadFabric(material);

    this.pinCollar();
    for (let i = 0; i < 70; i++) this.step(1 / 60, 0, 0, 0);
    this.writeGeometry();
  }

  update(dt: number, time: number, walkSpeed: number, yaw: number): void {
    const steps = Math.max(1, Math.min(3, Math.round(dt / TIMESTEP)));
    for (let i = 0; i < steps; i++) this.step(dt / steps, time, walkSpeed, yaw);
    this.writeGeometry();
  }

  private loadFabric(material: MeshPhysicalMaterial): void {
    const base = import.meta.env.BASE_URL;
    const loader = new TextureLoader();
    const color = loader.load(`${base}textures/cloak/color.jpg`);
    color.colorSpace = SRGBColorSpace;
    color.wrapS = color.wrapT = RepeatWrapping;
    color.repeat.set(2.4, 3.2);
    color.anisotropy = 8;
    const normal = loader.load(`${base}textures/cloak/normal.jpg`);
    normal.wrapS = normal.wrapT = RepeatWrapping;
    normal.repeat.copy(color.repeat);
    normal.anisotropy = 8;
    const roughness = loader.load(`${base}textures/cloak/roughness.jpg`);
    roughness.wrapS = roughness.wrapT = RepeatWrapping;
    roughness.repeat.copy(color.repeat);
    material.map = color;
    material.normalMap = normal;
    material.roughnessMap = roughness;
    material.color.set("#0a0a0a");
    material.needsUpdate = true;
  }

  private step(dt: number, time: number, walkSpeed: number, yaw = 0): void {
    this.figure.refreshWorld();
    this.pinCollar();

    const timesq = Math.min(dt, 0.028) ** 2 || TIMESTEP_SQ;
    const particles = this.cloth.particles;
    const index = this.geometry.index;
    const normals = this.geometry.attributes.normal;

    _wind.set(Math.sin(time * 1.4), 0.08, Math.cos(time * 0.9)).multiplyScalar(0.12);
    _wind.x += Math.sin(yaw) * walkSpeed * 0.45;
    _wind.z += Math.cos(yaw) * walkSpeed * 0.45;

    if (index) {
      for (let i = 0, il = index.count; i < il; i += 3) {
        for (let j = 0; j < 3; j++) {
          const id = index.getX(i + j);
          _normal.fromBufferAttribute(normals, id);
          _force.copy(_normal).multiplyScalar(_normal.dot(_wind));
          particles[id].addForce(_force);
        }
      }
    }

    _force.copy(GRAVITY).multiplyScalar(MASS);
    for (const p of particles) {
      p.addForce(_force);
      p.integrate(timesq);
    }

    for (let n = 0; n < ITERATIONS; n++) {
      for (const c of this.cloth.constraints) {
        satisfyConstraint(c.a, c.b, c.rest);
      }
      this.pinCollar();
    }

    this.keepOnBack();
    this.figure.worldPos("leftShoulder", _left);
    this.figure.worldPos("rightShoulder", _right);
    this.figure.worldPos("neck", _neck);
    this.figure.worldPos("chest", _chest);
    this.figure.worldPos("pelvis", _pelvis);
    this.collideSphere(_left, 0.072);
    this.collideSphere(_right, 0.072);
    this.collideSphere(_neck, 0.05);
    this.collideSphere(_chest, 0.125);
    this.collideSphere(_pelvis, 0.11, _pelvis.y - 0.12);

    for (const p of particles) {
      if (p.position.y < FLOOR_Y) p.position.y = FLOOR_Y;
    }

    this.pinCollar();
    this.softYoke();
  }

  private collideSphere(center: Vector3, radius: number, minY = -Infinity): void {
    for (const p of this.cloth.particles) {
      if (p.position.y < minY) continue;
      _hit.subVectors(p.position, center);
      const d = _hit.length();
      if (d > 0 && d < radius) {
        _hit.multiplyScalar(radius / d);
        p.position.copy(center).add(_hit);
      }
    }
  }

  private keepOnBack(): void {
    const yaw = this.figure.bone("root").rotation.y;
    _forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    _back.copy(_forward).multiplyScalar(-1);
    this.figure.worldPos("chest", _chest);
    const plane = _chest.clone().addScaledVector(_back, 0.02);
    for (const p of this.cloth.particles) {
      _hit.subVectors(p.position, plane);
      const intoBody = _hit.dot(_forward);
      if (intoBody > -0.05) {
        p.position.addScaledVector(_forward, -0.05 - intoBody);
      }
    }
  }

  private pinCollar(): void {
    for (let u = 0; u <= this.cloth.w; u++) {
      const p = this.cloth.particles[this.cloth.index(u, 0)];
      cloakSurface(this.figure, u / this.cloth.w, 0, p.position);
      p.previous.copy(p.position);
    }
  }

  private softYoke(): void {
    for (let u = 0; u <= this.cloth.w; u++) {
      cloakSurface(this.figure, u / this.cloth.w, 0.07, _yoke);
      const p = this.cloth.particles[this.cloth.index(u, 1)];
      p.position.lerp(_yoke, 0.28);
      p.previous.lerp(_yoke, 0.12);
    }
  }

  private writeGeometry(): void {
    const pos = this.geometry.attributes.position;
    for (let i = 0; i < this.cloth.particles.length; i++) {
      const p = this.cloth.particles[i];
      pos.setXYZ(i, p.position.x, p.position.y, p.position.z);
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
