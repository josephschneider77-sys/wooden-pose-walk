import { Vector3 } from "three";

/**
 * Verlet cloth from the official three.js MIT example, plus Drape
 * (aatishb/drape, MIT): skip-neighbor bending springs and frictional
 * contact. https://github.com/aatishb/drape
 */
const DAMPING = 0.03;
const DRAG = 1 - DAMPING;
/** Drape restDistanceB — longer bending rest lets the sheet sag into folds. */
const BEND_SLACK = 1.06;

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

    const link = (u0: number, v0: number, u1: number, v1: number, slack = 1) => {
      const a = this.particles[this.index(u0, v0)];
      const b = this.particles[this.index(u1, v1)];
      this.constraints.push({
        a,
        b,
        rest: a.position.distanceTo(b.position) * slack,
      });
    };

    // Structural (Drape "cross grain")
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        link(u, v, u, v + 1);
        link(u, v, u + 1, v);
      }
    }
    for (let v = 0; v < h; v++) link(w, v, w, v + 1);
    for (let u = 0; u < w; u++) link(u, h, u + 1, h);

    // Shear (Drape "bias grain")
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        link(u, v, u + 1, v + 1);
        link(u + 1, v, u, v + 1);
      }
    }

    // Bending (Drape "drape") — skip-one springs for larger folds
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        if (v + 2 <= h) link(u, v, u, v + 2, BEND_SLACK);
        if (u + 2 <= w) link(u, v, u + 2, v, BEND_SLACK);
      }
    }
  }

  index(u: number, v: number): number {
    return u + v * (this.w + 1);
  }
}

const _diff = new Vector3();
const _noFriction = new Vector3();
const _frictionPos = new Vector3();
const _motion = new Vector3();

export function satisfyConstraint(a: ClothParticle, b: ClothParticle, rest: number): void {
  _diff.subVectors(b.position, a.position);
  const dist = _diff.length();
  if (dist === 0) return;
  _diff.multiplyScalar(1 - rest / dist);
  a.position.addScaledVector(_diff, 0.5);
  b.position.addScaledVector(_diff, -0.5);
}

/**
 * Drape sphere contact: project out, then blend with last-frame
 * position plus collider motion so the cloth can cling.
 */
export function collideSphereFriction(
  particle: ClothParticle,
  center: Vector3,
  prevCenter: Vector3,
  radius: number,
  friction: number,
  minY = -Infinity,
): void {
  if (particle.position.y < minY) return;
  _diff.subVectors(particle.position, center);
  const dist = _diff.length();
  if (dist === 0 || dist >= radius) return;

  _noFriction.copy(center).addScaledVector(_diff, radius / dist);
  _diff.subVectors(particle.previous, center);
  if (_diff.length() > radius) {
    _motion.subVectors(center, prevCenter);
    _frictionPos.copy(particle.previous).add(_motion);
    particle.position
      .copy(_frictionPos)
      .multiplyScalar(friction)
      .addScaledVector(_noFriction, 1 - friction);
  } else {
    particle.position.copy(_noFriction);
  }
}
