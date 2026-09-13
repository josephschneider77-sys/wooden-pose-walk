import { Vector3 } from "three";

/**
 * Verlet cloth from the official three.js MIT example
 * `examples/webgl_animation_cloth.html` (mrdoob/three.js).
 */
const DAMPING = 0.03;
const DRAG = 1 - DAMPING;

export class ClothParticle {
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly original = new Vector3();
  readonly acceleration = new Vector3();
  invMass = 1;
  private readonly scratch = new Vector3();

  addForce(force: Vector3): void {
    this.acceleration.addScaledVector(force, this.invMass);
  }

  integrate(timesq: number): void {
    const next = this.scratch.subVectors(this.position, this.previous);
    next.multiplyScalar(DRAG).add(this.position);
    next.addScaledVector(this.acceleration, timesq);
    this.previous.copy(this.position);
    this.position.copy(next);
    this.acceleration.set(0, 0, 0);
  }
}

export interface ClothConstraint {
  a: ClothParticle;
  b: ClothParticle;
  rest: number;
}

export class VerletCloth {
  readonly w: number;
  readonly h: number;
  readonly particles: ClothParticle[] = [];
  readonly constraints: ClothConstraint[] = [];

  constructor(w: number, h: number, place: (u: number, v: number, out: Vector3) => void) {
    this.w = w;
    this.h = h;
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        const p = new ClothParticle();
        place(u / w, v / h, p.position);
        p.previous.copy(p.position);
        p.original.copy(p.position);
        this.particles.push(p);
      }
    }

    const link = (u0: number, v0: number, u1: number, v1: number) => {
      const a = this.particles[this.index(u0, v0)];
      const b = this.particles[this.index(u1, v1)];
      this.constraints.push({ a, b, rest: a.position.distanceTo(b.position) });
    };

    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        link(u, v, u, v + 1);
        link(u, v, u + 1, v);
      }
    }
    for (let v = 0; v < h; v++) link(w, v, w, v + 1);
    for (let u = 0; u < w; u++) link(u, h, u + 1, h);

    // Shear springs — nicer folds than the official structural-only setup
    const shear = Math.SQRT2;
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const a = this.particles[this.index(u, v)];
        const d = this.particles[this.index(u + 1, v + 1)];
        const b = this.particles[this.index(u + 1, v)];
        const c = this.particles[this.index(u, v + 1)];
        this.constraints.push({ a, b: d, rest: a.position.distanceTo(d.position) || shear * 0.05 });
        this.constraints.push({ a: b, b: c, rest: b.position.distanceTo(c.position) || shear * 0.05 });
      }
    }
  }

  index(u: number, v: number): number {
    return u + v * (this.w + 1);
  }
}

const _diff = new Vector3();

export function satisfyConstraint(a: ClothParticle, b: ClothParticle, rest: number): void {
  _diff.subVectors(b.position, a.position);
  const dist = _diff.length();
  if (dist === 0) return;
  _diff.multiplyScalar(1 - rest / dist);
  a.position.addScaledVector(_diff, 0.5);
  b.position.addScaledVector(_diff, -0.5);
}
