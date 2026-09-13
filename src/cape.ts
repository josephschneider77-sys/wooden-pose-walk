import {
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import type { WoodenMannequin } from "./mannequin";
import { BodyShell } from "./bodyShell";
import { projectUnderPack, satisfyConstraint, VerletCloth } from "./verletCloth";

const WIDTH_SEGS = 18;
const HEIGHT_SEGS = 22;
const CAPE_LENGTH = 0.98;
const MASS = 1.4;
const GRAVITY = new Vector3(0, -30, 0);
const TIMESTEP = 1 / 60;
const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
const ITERATIONS = 8;
const FRICTION = 0.72;
const SPIKE = 0.055;
const FLOOR_Y = 0.03;
const COLLAR_A0 = Math.PI * 0.4;
const COLLAR_A1 = Math.PI * 1.6;

const _force = new Vector3();
const _normal = new Vector3();
const _wind = new Vector3();
const _forward = new Vector3();
const _neck = new Vector3();
const _chest = new Vector3();
const _hit = new Vector3();
const _yoke = new Vector3();
const _side = new Vector3();
const _back = new Vector3();
const _avg = new Vector3();
const _packCenter = new Vector3();
const _packRot = new Quaternion();

/** Chest-local seat of the worn jetpack — cloth tucks under this box. */
const PACK_LOCAL = new Vector3(0, 0.14, -0.26);
const PACK_HX = 0.16;
const PACK_HY = 0.18;
const PACK_HZ = 0.1;

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
 * Shoulder-wrapped cape: three.js Verlet cloth plus Drape bending
 * springs and frictional body contact. Collar is a neck horseshoe.
 */
export class ClothCape {
  readonly mesh: Mesh;
  private readonly figure: WoodenMannequin;
  private readonly cloth: VerletCloth;
  private readonly geometry: PlaneGeometry;
  private readonly shell = new BodyShell();
  private packOn = false;

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
    this.mesh.renderOrder = 4;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -4;
    material.polygonOffsetUnits = -4;
    material.depthWrite = true;
    this.loadFabric(material);

    this.pinCollar();
    for (let i = 0; i < 48; i++) this.step(1 / 60, 0, 0, 0);
    this.writeGeometry();
  }

  setPack(on: boolean): void {
    this.packOn = on;
  }

  update(dt: number, time: number, walkSpeed: number, yaw: number): void {
    const steps = Math.max(1, Math.min(3, Math.round(dt / TIMESTEP)));
    for (let i = 0; i < steps; i++) this.step(dt / steps, time, walkSpeed, yaw);
    this.writeGeometry();
  }

  /** Re-drape on the figure after a teleport so Verlet springs do not explode. */
  snap(): void {
    this.figure.refreshWorld();
    for (let v = 0; v <= this.cloth.h; v++) {
      for (let u = 0; u <= this.cloth.w; u++) {
        const p = this.cloth.particles[this.cloth.index(u, v)];
        cloakSurface(this.figure, u / this.cloth.w, v / this.cloth.h, p.position);
        p.previous.copy(p.position);
      }
    }
    this.pinCollar();
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

    _wind.set(Math.sin(time * 1.4), 0.05, Math.cos(time * 0.9)).multiplyScalar(0.035);
    _wind.x += Math.sin(yaw) * walkSpeed * 0.12;
    _wind.z += Math.cos(yaw) * walkSpeed * 0.12;

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

    this.shell.refresh(this.figure);
    const facing = this.figure.bone("root").rotation.y;
    _back.set(-Math.sin(facing), 0, -Math.cos(facing));
    const free = (this.cloth.w + 1) * 2;

    for (let n = 0; n < ITERATIONS; n++) {
      for (const c of this.cloth.constraints) {
        satisfyConstraint(c.a, c.b, c.rest);
      }
      this.pinCollar();
      if (n % 2 === 1) {
        this.shell.resolve(particles, free, false, _back);
        this.tuckUnderPack(particles, free, false);
      }
    }

    this.keepOnBack();
    for (const p of particles) {
      if (p.position.y < FLOOR_Y) {
        p.position.y = FLOOR_Y;
        p.previous.x += (p.position.x - p.previous.x) * FRICTION;
        p.previous.z += (p.position.z - p.previous.z) * FRICTION;
      }
    }

    this.pinCollar();
    this.softYoke();
    this.keepOnBack();
    this.shell.resolve(particles, free, true, _back);
    this.tuckUnderPack(particles, free, true);
    this.flattenSpikes();
    for (let n = 0; n < 3; n++) {
      for (const c of this.cloth.constraints) {
        satisfyConstraint(c.a, c.b, c.rest);
      }
      this.pinCollar();
    }
    this.shell.resolve(particles, free, true, _back);
    this.tuckUnderPack(particles, free, true);
    this.flattenSpikes();
    this.pinCollar();
  }

  private tuckUnderPack(particles: typeof this.cloth.particles, skip: number, settle: boolean): void {
    if (!this.packOn) return;
    const chest = this.figure.bone("chest");
    _packCenter.copy(PACK_LOCAL);
    chest.localToWorld(_packCenter);
    chest.getWorldQuaternion(_packRot);
    for (let i = skip; i < particles.length; i++) {
      projectUnderPack(particles[i], _packCenter, _packRot, PACK_HX, PACK_HY, PACK_HZ, settle);
    }
  }

  private keepOnBack(): void {
    const yaw = this.figure.bone("root").rotation.y;
    _forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    _side.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.figure.worldPos("chest", _chest);
    for (let i = this.cloth.w + 1; i < this.cloth.particles.length; i++) {
      const p = this.cloth.particles[i];
      _hit.subVectors(p.position, _chest);
      const lateral = Math.abs(_hit.dot(_side));
      if (lateral > 0.14) continue;
      const intoBody = _hit.dot(_forward) + 0.02;
      if (intoBody > 0.015) {
        p.position.addScaledVector(_forward, -intoBody * 0.45);
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

  /** Pull isolated vertices back toward their neighbors. */
  private flattenSpikes(): void {
    const { w, h, particles } = this.cloth;
    for (let v = 1; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        const p = particles[this.cloth.index(u, v)];
        _avg.set(0, 0, 0);
        let n = 0;
        if (u > 0) {
          _avg.add(particles[this.cloth.index(u - 1, v)].position);
          n++;
        }
        if (u < w) {
          _avg.add(particles[this.cloth.index(u + 1, v)].position);
          n++;
        }
        if (v > 0) {
          _avg.add(particles[this.cloth.index(u, v - 1)].position);
          n++;
        }
        if (v < h) {
          _avg.add(particles[this.cloth.index(u, v + 1)].position);
          n++;
        }
        if (n < 3) continue;
        _avg.multiplyScalar(1 / n);
        if (p.position.distanceTo(_avg) > SPIKE) {
          p.position.lerp(_avg, 0.7);
          p.previous.lerp(p.position, 0.25);
        }
      }
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
