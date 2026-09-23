import { Vector3 } from "three";

/**
 * CPU sheet solver adapted from the simulated-cloth skill
 * (examples/simulated-cloth/source/cloth-kernel.js, MIT, © 2026 Scott Sun).
 *
 * The gallery solver is a 96×96 WebGPU XPBD sheet with a spatial hash.
 * This tier keeps the same mechanisms at cape resolution on WebGL2:
 * inextensible warp/weft, free-then-locking shear, soft yarn bending,
 * quadratic air drag, and a speed limit. Self-contact is a short fold
 * separation instead of the 131072-bucket hash.
 */
const STRUCTURAL_RELAX = 0.96;
const SHEAR_FREE = 0.1;
const THICKNESS = 0.0004;
const ES = 1.2e4;
const BEND = 9.0e-5;
const BEND_ALPHA = 1 / BEND;
const AIR_N = 1.15;
const AIR_T = 0.12;
const DAMP = 0.16;
const VMAX = 4;
const SELF_THICK = 0.0065;

export interface SheetPoint {
  position: Vector3;
  previous: Vector3;
  velocity: Vector3;
  invMass: number;
}

interface ShearTri {
  i0: number;
  i1: number;
  i2: number;
  d00: number;
  d01: number;
  d10: number;
  d11: number;
  aS: number;
}

interface BendYarn {
  i0: number;
  i1: number;
  i2: number;
}

const _d = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _f0 = new Vector3();
const _f1 = new Vector3();
const _s0 = new Vector3();
const _s1 = new Vector3();
const _g0 = new Vector3();
const _g1 = new Vector3();
const _g2 = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _axis = new Vector3();
const _d0 = new Vector3();
const _d1 = new Vector3();
const _d2 = new Vector3();
const _n = new Vector3();
const _rel = new Vector3();
const _vt = new Vector3();

export class WovenSheet {
  readonly w: number;
  readonly h: number;
  readonly points: SheetPoint[];
  readonly normals: Vector3[];
  private readonly restH: Float32Array;
  private readonly restV: Float32Array;
  private readonly shearTris: ShearTri[] = [];
  private readonly bends: BendYarn[] = [];
  private readonly folds: Array<[number, number]> = [];

  constructor(
    w: number,
    h: number,
    widthM: number,
    lengthM: number,
    density: number,
    place: (u: number, v: number, out: Vector3) => void,
  ) {
    this.w = w;
    this.h = h;
    const count = (w + 1) * (h + 1);
    this.points = [];
    this.normals = [];
    const cellU = widthM / w;
    const cellV = lengthM / h;
    const area = cellU * cellV;
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        const point: SheetPoint = {
          position: new Vector3(),
          previous: new Vector3(),
          velocity: new Vector3(),
          invMass: 1,
        };
        place(u / w, v / h, point.position);
        point.previous.copy(point.position);
        const edgeU = u === 0 || u === w ? 0.5 : 1;
        const edgeV = v === 0 || v === h ? 0.5 : 1;
        const mass = Math.max(1e-5, density * area * edgeU * edgeV);
        point.invMass = 1 / mass;
        this.points.push(point);
        this.normals.push(new Vector3(0, 0, -1));
      }
    }

    this.restH = new Float32Array((h + 1) * w);
    this.restV = new Float32Array(h * (w + 1));
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u < w; u++) {
        const a = this.points[this.index(u, v)]!;
        const b = this.points[this.index(u + 1, v)]!;
        this.restH[v * w + u] = Math.max(1e-4, a.position.distanceTo(b.position));
      }
    }
    for (let v = 0; v < h; v++) {
      for (let u = 0; u <= w; u++) {
        const a = this.points[this.index(u, v)]!;
        const b = this.points[this.index(u, v + 1)]!;
        this.restV[v * (w + 1) + u] = Math.max(1e-4, a.position.distanceTo(b.position));
      }
    }

    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const a = this.index(u, v);
        const b = this.index(u + 1, v);
        const c = this.index(u + 1, v + 1);
        const d = this.index(u, v + 1);
        this.pushShear(a, d, b);
        this.pushShear(b, d, c);
      }
    }

    for (let v = 0; v <= h; v++) {
      for (let u = 1; u < w; u++) {
        this.bends.push({
          i0: this.index(u - 1, v),
          i1: this.index(u, v),
          i2: this.index(u + 1, v),
        });
      }
    }
    for (let u = 0; u <= w; u++) {
      for (let v = 1; v < h; v++) {
        this.bends.push({
          i0: this.index(u, v - 1),
          i1: this.index(u, v),
          i2: this.index(u, v + 1),
        });
      }
    }
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        if (u + 2 <= w) this.folds.push([this.index(u, v), this.index(u + 2, v)]);
        if (v + 2 <= h) this.folds.push([this.index(u, v), this.index(u, v + 2)]);
      }
    }

    if (count !== this.points.length) {
      throw new Error("Woven sheet count mismatch");
    }
  }

  index(u: number, v: number): number {
    return u + v * (this.w + 1);
  }

  /** Verlet-free velocity step: gravity, wind-relative air drag, damping. */
  integrate(dt: number, wind: Vector3, gravity: number): void {
    this.computeNormals();
    const damp = Math.max(0, 1 - DAMP * dt);
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i]!;
      p.previous.copy(p.position);
      if (p.invMass <= 0) continue;
      const v = p.velocity;
      v.y += gravity * dt;
      const n = this.normals[i]!;
      _rel.copy(v).sub(wind);
      const vn = _rel.dot(n);
      _vt.copy(_rel).addScaledVector(n, -vn);
      const vtl = _vt.length();
      v.addScaledVector(n, -AIR_N * Math.abs(vn) * vn * dt);
      if (vtl > 1e-8) v.addScaledVector(_vt, -AIR_T * vtl * dt);
      v.multiplyScalar(damp);
      p.position.addScaledVector(v, dt);
    }
  }

  structural(): void {
    const { w, h } = this;
    for (let pass = 0; pass < 2; pass++) {
      for (let v = 0; v <= h; v++) {
        for (let u = pass; u < w; u += 2) {
          this.solvePair(this.index(u, v), this.index(u + 1, v), this.restH[v * w + u]!);
        }
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let v = pass; v < h; v += 2) {
        for (let u = 0; u <= w; u++) {
          this.solvePair(this.index(u, v), this.index(u, v + 1), this.restV[v * (w + 1) + u]!);
        }
      }
    }
  }

  shear(dt: number): void {
    const dt2 = dt * dt;
    for (const tri of this.shearTris) {
      const p0 = this.points[tri.i0]!;
      const p1 = this.points[tri.i1]!;
      const p2 = this.points[tri.i2]!;
      _e1.subVectors(p1.position, p0.position);
      _e2.subVectors(p2.position, p0.position);
      _f0.copy(_e1).multiplyScalar(tri.d00).addScaledVector(_e2, tri.d10);
      _f1.copy(_e1).multiplyScalar(tri.d01).addScaledVector(_e2, tri.d11);
      const l0 = _f0.length();
      const l1 = _f1.length();
      if (l0 < 1e-7 || l1 < 1e-7) continue;
      const raw = _f0.dot(_f1) / (l0 * l1);
      const ar = Math.abs(raw);
      if (ar <= SHEAR_FREE) continue;
      const sgn = raw >= 0 ? 1 : -1;
      const c = (ar - SHEAR_FREE) * sgn;
      const lockT = Math.min(1, Math.max(0, (ar - SHEAR_FREE) / (0.6 - SHEAR_FREE)));
      const stiffMul = 0.3 + 7.7 * lockT * lockT;
      const invLengths = 1 / (l0 * l1);
      _s0.copy(_f1).multiplyScalar(invLengths).addScaledVector(_f0, -raw / (l0 * l0));
      _s1.copy(_f0).multiplyScalar(invLengths).addScaledVector(_f1, -raw / (l1 * l1));
      _g1.copy(_s0).multiplyScalar(tri.d00).addScaledVector(_s1, tri.d01);
      _g2.copy(_s0).multiplyScalar(tri.d10).addScaledVector(_s1, tri.d11);
      _g0.copy(_g1).add(_g2).multiplyScalar(-1);
      const w0 = p0.invMass;
      const w1 = p1.invMass;
      const w2 = p2.invMass;
      let denom = w0 * _g0.dot(_g0) + w1 * _g1.dot(_g1) + w2 * _g2.dot(_g2);
      denom += tri.aS / stiffMul / dt2;
      if (denom < 1e-12) continue;
      const dL = -c / denom;
      if (w0 > 0) p0.position.addScaledVector(_g0, w0 * dL);
      if (w1 > 0) p1.position.addScaledVector(_g1, w1 * dL);
      if (w2 > 0) p2.position.addScaledVector(_g2, w2 * dL);
    }
  }

  bend(dt: number): void {
    const dt2 = dt * dt;
    for (const yarn of this.bends) {
      const p0 = this.points[yarn.i0]!;
      const p1 = this.points[yarn.i1]!;
      const p2 = this.points[yarn.i2]!;
      const w0 = p0.invMass;
      const w1 = p1.invMass;
      const w2 = p2.invMass;
      if (w0 + w1 + w2 === 0) continue;
      _e1.subVectors(p1.position, p0.position);
      _e2.subVectors(p2.position, p1.position);
      const l0 = _e1.length();
      const l1 = _e2.length();
      if (Math.min(l0, l1) < 1e-7) continue;
      _u.copy(_e1).multiplyScalar(1 / l0);
      _v.copy(_e2).multiplyScalar(1 / l1);
      _axis.crossVectors(_u, _v);
      const sine = _axis.length();
      const cosine = Math.min(1, Math.max(-1, _u.dot(_v)));
      const c = Math.atan2(sine, cosine);
      if (c < 0.02) continue;
      if (sine < 1e-6) {
        _d0.subVectors(p1.previous, p0.previous);
        _d2.subVectors(p2.previous, p1.previous);
        _n.crossVectors(_d0, _d2);
        if (_n.lengthSq() < 1e-8) continue;
      } else {
        _n.copy(_axis);
      }
      _n.normalize();
      _d0.crossVectors(_n, _u).multiplyScalar(1 / l0);
      _d2.crossVectors(_n, _v).multiplyScalar(1 / l1);
      _d1.copy(_d0).add(_d2).multiplyScalar(-1);
      let denom = w0 * _d0.dot(_d0) + w1 * _d1.dot(_d1) + w2 * _d2.dot(_d2);
      denom += BEND_ALPHA / dt2;
      if (denom < 1e-20) continue;
      const dL = -c / denom;
      if (w0 > 0) p0.position.addScaledVector(_d0, w0 * dL);
      if (w1 > 0) p1.position.addScaledVector(_d1, w1 * dL);
      if (w2 > 0) p2.position.addScaledVector(_d2, w2 * dL);
    }
  }

  /** Push folded non-neighbors apart without adding speed. */
  separateFolds(): void {
    for (const [ia, ib] of this.folds) this.separate(ia, ib, SELF_THICK);
  }

  /** Pull isolated vertices back toward their yarn neighbors. */
  flattenSpikes(limit: number): void {
    const { w, h, points } = this;
    for (let v = 1; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        const p = points[this.index(u, v)]!;
        if (p.invMass <= 0) continue;
        _d.set(0, 0, 0);
        let n = 0;
        if (u > 0) {
          _d.add(points[this.index(u - 1, v)]!.position);
          n++;
        }
        if (u < w) {
          _d.add(points[this.index(u + 1, v)]!.position);
          n++;
        }
        if (v > 0) {
          _d.add(points[this.index(u, v - 1)]!.position);
          n++;
        }
        if (v < h) {
          _d.add(points[this.index(u, v + 1)]!.position);
          n++;
        }
        if (n < 3) continue;
        _d.multiplyScalar(1 / n);
        if (p.position.distanceTo(_d) > limit) {
          const ox = p.position.x;
          const oy = p.position.y;
          const oz = p.position.z;
          p.position.lerp(_d, 0.65);
          const dx = p.position.x - ox;
          const dy = p.position.y - oy;
          const dz = p.position.z - oz;
          p.previous.x += dx;
          p.previous.y += dy;
          p.previous.z += dz;
        }
      }
    }
  }

  finishVelocity(dt: number): void {
    const inv = 1 / dt;
    for (const p of this.points) {
      if (p.invMass <= 0) {
        p.velocity.set(0, 0, 0);
        p.previous.copy(p.position);
        continue;
      }
      p.velocity.subVectors(p.position, p.previous).multiplyScalar(inv);
      const speed = p.velocity.length();
      if (speed > VMAX) p.velocity.multiplyScalar(VMAX / speed);
      if (!Number.isFinite(p.position.x)) {
        p.position.copy(p.previous);
        p.velocity.set(0, 0, 0);
      }
    }
  }

  private separate(ia: number, ib: number, minDist: number): void {
    const a = this.points[ia]!;
    const b = this.points[ib]!;
    _d.subVectors(b.position, a.position);
    const l = _d.length();
    if (l >= minDist || l < 1e-6) return;
    const w0 = a.invMass;
    const w1 = b.invMass;
    const ws = w0 + w1;
    if (ws < 1e-8) return;
    const push = (minDist - l) / l;
    const c0 = (push * w0) / ws;
    const c1 = (push * w1) / ws;
    if (w0 > 0) {
      a.position.addScaledVector(_d, -c0);
      a.previous.addScaledVector(_d, -c0);
    }
    if (w1 > 0) {
      b.position.addScaledVector(_d, c1);
      b.previous.addScaledVector(_d, c1);
    }
  }

  private solvePair(ia: number, ib: number, rest: number): void {
    const a = this.points[ia]!;
    const b = this.points[ib]!;
    const w0 = a.invMass;
    const w1 = b.invMass;
    const ws = w0 + w1;
    if (ws < 1e-12) return;
    _d.subVectors(b.position, a.position);
    const l = _d.length();
    if (l < 1e-8) return;
    const c = l - rest;
    if (Math.abs(c) < rest * 0.00015) return;
    const scale = (STRUCTURAL_RELAX * c) / (ws * l);
    if (w0 > 0) a.position.addScaledVector(_d, scale * w0);
    if (w1 > 0) b.position.addScaledVector(_d, -scale * w1);
  }

  private pushShear(i0: number, i1: number, i2: number): void {
    const p0 = this.points[i0]!.position;
    const p1 = this.points[i1]!.position;
    const p2 = this.points[i2]!.position;
    _e1.subVectors(p1, p0);
    _e2.subVectors(p2, p0);
    const x1 = _e1.length();
    if (x1 < 1e-6) return;
    const x2 = _e2.dot(_e1) / x1;
    const z2 = Math.sqrt(Math.max(0, _e2.lengthSq() - x2 * x2));
    const det = x1 * z2;
    if (det < 1e-8) return;
    const area = 0.5 * det;
    const alphaBase = 1 / (THICKNESS * area);
    this.shearTris.push({
      i0,
      i1,
      i2,
      d00: z2 / det,
      d01: -x2 / det,
      d10: 0,
      d11: x1 / det,
      aS: alphaBase / ES,
    });
  }

  private computeNormals(): void {
    const { w, h } = this;
    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        const r = this.points[this.index(Math.min(u + 1, w), v)]!.position;
        const l = this.points[this.index(Math.max(u - 1, 0), v)]!.position;
        const dn = this.points[this.index(u, Math.min(v + 1, h))]!.position;
        const up = this.points[this.index(u, Math.max(v - 1, 0))]!.position;
        _e1.subVectors(r, l);
        _e2.subVectors(dn, up);
        const n = this.normals[this.index(u, v)]!;
        n.crossVectors(_e1, _e2);
        if (n.lengthSq() < 1e-10) n.set(0, 0, -1);
        else n.normalize();
      }
    }
  }
}
