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

const WIDTH_SEGS = 12;
const HEIGHT_SEGS = 16;
const CAPE_WIDTH = 0.78;
const CAPE_LENGTH = 1.08;
const MASS = 0.1;
const GRAVITY = new Vector3(0, -28, 0);
const TIMESTEP = 1 / 60;
const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
const ITERATIONS = 4;
const FLOOR_Y = 0.03;

const _force = new Vector3();
const _normal = new Vector3();
const _wind = new Vector3();
const _back = new Vector3();
const _left = new Vector3();
const _right = new Vector3();
const _neck = new Vector3();
const _chest = new Vector3();
const _hit = new Vector3();

/**
 * Shoulder-pinned cape using three.js Verlet cloth + ambientCG Fabric008 (CC0).
 */
export class ClothCape {
  readonly mesh: Mesh;
  private readonly figure: WoodenMannequin;
  private readonly cloth: VerletCloth;
  private readonly geometry: PlaneGeometry;

  constructor(figure: WoodenMannequin) {
    this.figure = figure;
    this.cloth = new VerletCloth(WIDTH_SEGS, HEIGHT_SEGS, (u, v, out) => {
      out.set((u - 0.5) * CAPE_WIDTH, 1.35 - v * CAPE_LENGTH, -0.12 - v * 0.08);
    });
    for (const p of this.cloth.particles) p.invMass = 1 / MASS;

    this.geometry = new PlaneGeometry(CAPE_WIDTH, CAPE_LENGTH, WIDTH_SEGS, HEIGHT_SEGS);
    const material = new MeshPhysicalMaterial({
      color: "#111111",
      roughness: 0.94,
      metalness: 0,
      clearcoat: 0,
      sheen: 0,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "cloak";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.loadFabric(material);

    this.figure.refreshWorld();
    this.pinToShoulders();
    for (let i = 0; i < 48; i++) this.step(1 / 60, 0, 0, 0);
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
    this.pinToShoulders();

    const timesq = Math.min(dt, 0.028) ** 2 || TIMESTEP_SQ;
    const particles = this.cloth.particles;
    const geo = this.geometry;
    const index = geo.index;
    const normals = geo.attributes.normal;

    _wind.set(Math.sin(time * 1.7), 0.15, Math.cos(time * 1.1)).multiplyScalar(0.35);
    _wind.x += Math.sin(yaw) * walkSpeed * 1.8;
    _wind.z += Math.cos(yaw) * walkSpeed * 1.8;

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
    }

    this.figure.worldPos("chest", _chest);
    this.figure.worldPos("pelvis", _hit);
    this.collideSphere(_chest, 0.2);
    this.collideSphere(_hit, 0.17);

    for (const p of particles) {
      if (p.position.y < FLOOR_Y) p.position.y = FLOOR_Y;
    }

    this.pinToShoulders();
  }

  private collideSphere(center: Vector3, radius: number): void {
    for (const p of this.cloth.particles) {
      _hit.subVectors(p.position, center);
      const d = _hit.length();
      if (d > 0 && d < radius) {
        _hit.multiplyScalar(radius / d);
        p.position.copy(center).add(_hit);
      }
    }
  }

  private pinToShoulders(): void {
    this.figure.worldPos("leftShoulder", _left);
    this.figure.worldPos("rightShoulder", _right);
    this.figure.worldPos("neck", _neck);
    const yaw = this.figure.bone("root").rotation.y;
    _back.set(-Math.sin(yaw), 0, -Math.cos(yaw));

    for (let u = 0; u <= this.cloth.w; u++) {
      const t = u / this.cloth.w;
      const p = this.cloth.particles[this.cloth.index(u, 0)];
      p.position.lerpVectors(_left, _right, t);
      p.position.y = _neck.y - 0.02;
      p.position.addScaledVector(_back, 0.055 + Math.sin(t * Math.PI) * 0.03);
      p.previous.copy(p.position);
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
