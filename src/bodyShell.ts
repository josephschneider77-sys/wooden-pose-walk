import { Quaternion, Vector3 } from "three";
import type { BoneName, WoodenMannequin } from "./mannequin";
import {
  projectOutBox,
  projectOutCapsule,
  projectOutSphere,
  type ClothPoint,
} from "./verletCloth";

/** Small air gap. Large margins fight the springs and make the cloak explode. */
const MARGIN = 0.016;

interface SphereHit {
  center: Vector3;
  radius: number;
}

interface CapsuleHit {
  a: Vector3;
  b: Vector3;
  radius: number;
}

interface BoxHit {
  center: Vector3;
  rotation: Quaternion;
  hx: number;
  hy: number;
  hz: number;
}

function point(figure: WoodenMannequin, bone: BoneName, x: number, y: number, z: number, out: Vector3): void {
  out.set(x, y, z);
  figure.bone(bone).localToWorld(out);
}

function setBox(
  figure: WoodenMannequin,
  bone: BoneName,
  lx: number,
  ly: number,
  lz: number,
  hx: number,
  hy: number,
  hz: number,
  out: BoxHit,
): void {
  out.center.set(lx, ly, lz);
  figure.bone(bone).localToWorld(out.center);
  figure.bone(bone).getWorldQuaternion(out.rotation);
  out.hx = hx + MARGIN;
  out.hy = hy + MARGIN;
  out.hz = hz + MARGIN;
}

/**
 * Tight body volumes so cloth stays outside the wood without being
 * launched by overlapping fat colliders.
 */
export class BodyShell {
  private readonly spheres: SphereHit[] = Array.from({ length: 6 }, () => ({
    center: new Vector3(),
    radius: 0.1,
  }));
  private readonly capsules: CapsuleHit[] = Array.from({ length: 10 }, () => ({
    a: new Vector3(),
    b: new Vector3(),
    radius: 0.08,
  }));
  private readonly boxes: BoxHit[] = Array.from({ length: 3 }, () => ({
    center: new Vector3(),
    rotation: new Quaternion(),
    hx: 0.1,
    hy: 0.1,
    hz: 0.1,
  }));
  private readonly gap = new Vector3();
  private readonly segment = new Vector3();
  private readonly closest = new Vector3();
  private readonly local = new Vector3();
  private readonly inverse = new Quaternion();

  refresh(figure: WoodenMannequin): void {
    const s = this.spheres;
    const c = this.capsules;
    const b = this.boxes;

    point(figure, "head", 0, 0.1, 0.02, s[0].center);
    s[0].radius = 0.108 + MARGIN;
    point(figure, "neck", 0, 0.02, 0, s[1].center);
    s[1].radius = 0.052 + MARGIN;
    point(figure, "leftShoulder", 0, 0, 0, s[2].center);
    s[2].radius = 0.054 + MARGIN;
    point(figure, "rightShoulder", 0, 0, 0, s[3].center);
    s[3].radius = 0.054 + MARGIN;
    point(figure, "leftHand", 0, -0.05, 0, s[4].center);
    s[4].radius = 0.042 + MARGIN;
    point(figure, "rightHand", 0, -0.05, 0, s[5].center);
    s[5].radius = 0.042 + MARGIN;

    point(figure, "neck", 0, 0, 0, c[0].a);
    point(figure, "head", 0, 0.12, 0.01, c[0].b);
    c[0].radius = 0.058 + MARGIN;
    point(figure, "chest", 0, 0.04, 0, c[1].a);
    point(figure, "pelvis", 0, 0.04, 0, c[1].b);
    c[1].radius = 0.082 + MARGIN;
    point(figure, "leftShoulder", 0, 0, 0, c[2].a);
    point(figure, "leftElbow", 0, 0, 0, c[2].b);
    c[2].radius = 0.038 + MARGIN;
    point(figure, "leftElbow", 0, 0, 0, c[3].a);
    point(figure, "leftWrist", 0, 0, 0, c[3].b);
    c[3].radius = 0.03 + MARGIN;
    point(figure, "rightShoulder", 0, 0, 0, c[4].a);
    point(figure, "rightElbow", 0, 0, 0, c[4].b);
    c[4].radius = 0.038 + MARGIN;
    point(figure, "rightElbow", 0, 0, 0, c[5].a);
    point(figure, "rightWrist", 0, 0, 0, c[5].b);
    c[5].radius = 0.03 + MARGIN;
    point(figure, "leftHip", 0, 0, 0, c[6].a);
    point(figure, "leftKnee", 0, 0, 0, c[6].b);
    c[6].radius = 0.048 + MARGIN;
    point(figure, "leftKnee", 0, 0, 0, c[7].a);
    point(figure, "leftHeel", 0, 0, 0, c[7].b);
    c[7].radius = 0.036 + MARGIN;
    point(figure, "rightHip", 0, 0, 0, c[8].a);
    point(figure, "rightKnee", 0, 0, 0, c[8].b);
    c[8].radius = 0.048 + MARGIN;
    point(figure, "rightKnee", 0, 0, 0, c[9].a);
    point(figure, "rightHeel", 0, 0, 0, c[9].b);
    c[9].radius = 0.036 + MARGIN;

    setBox(figure, "chest", 0, 0.12, 0, 0.13, 0.14, 0.08, b[0]);
    setBox(figure, "chest", 0, 0.13, 0.055, 0.1, 0.09, 0.032, b[1]);
    setBox(figure, "pelvis", 0, 0.02, 0, 0.12, 0.055, 0.075, b[2]);
  }

  /**
   * Push free particles onto the exterior. Torso / head eject toward
   * `back` so vertices do not spike out the top or front.
   */
  resolve(particles: ClothPoint[], skipCount: number, settle = false, back?: Vector3): void {
    for (let i = skipCount; i < particles.length; i++) {
      const p = particles[i];
      for (const box of this.boxes) {
        projectOutBox(p, box.center, box.rotation, box.hx, box.hy, box.hz, settle, true);
      }
      for (let s = 0; s < this.spheres.length; s++) {
        const prefer = s <= 1 ? back : undefined;
        projectOutSphere(p, this.spheres[s].center, this.spheres[s].radius, settle, prefer);
      }
      for (let c = 0; c < this.capsules.length; c++) {
        const prefer = c <= 1 ? back : undefined;
        projectOutCapsule(p, this.capsules[c].a, this.capsules[c].b, this.capsules[c].radius, settle, prefer);
      }
    }
  }

  /**
   * Outward normal when `position` is inside a collider or within `slack`
   * of its skin. The cape uses this for Coulomb friction after projection.
   */
  contactNormal(position: Vector3, out: Vector3, slack = 0.0026): boolean {
    let best = slack;
    let hit = false;
    const keep = (gap: number, nx: number, ny: number, nz: number): void => {
      if (gap >= best) return;
      best = gap;
      out.set(nx, ny, nz);
      hit = true;
    };

    for (const sphere of this.spheres) {
      this.gap.subVectors(position, sphere.center);
      const dist = this.gap.length();
      if (dist < 1e-8) {
        keep(-sphere.radius, 0, 0, -1);
        continue;
      }
      this.gap.multiplyScalar(1 / dist);
      keep(dist - sphere.radius, this.gap.x, this.gap.y, this.gap.z);
    }

    for (const capsule of this.capsules) {
      this.segment.subVectors(capsule.b, capsule.a);
      const lenSq = this.segment.lengthSq();
      let t = 0;
      if (lenSq > 1e-10) {
        t = Math.min(
          1,
          Math.max(0, this.gap.subVectors(position, capsule.a).dot(this.segment) / lenSq),
        );
      }
      this.closest.copy(capsule.a).addScaledVector(this.segment, t);
      this.gap.subVectors(position, this.closest);
      const dist = this.gap.length();
      if (dist < 1e-8) {
        keep(-capsule.radius, 0, 0, -1);
        continue;
      }
      this.gap.multiplyScalar(1 / dist);
      keep(dist - capsule.radius, this.gap.x, this.gap.y, this.gap.z);
    }

    for (const box of this.boxes) {
      this.inverse.copy(box.rotation).invert();
      this.local.copy(position).sub(box.center).applyQuaternion(this.inverse);
      const ax = Math.abs(this.local.x);
      const ay = Math.abs(this.local.y);
      const az = Math.abs(this.local.z);
      if (ax <= box.hx && ay <= box.hy && az <= box.hz) {
        const dx = box.hx - ax;
        const dy = box.hy - ay;
        const dz = box.hz - az;
        this.gap.set(0, 0, 0);
        let gap = 0;
        if (dx <= dy && dx <= dz) {
          this.gap.x = this.local.x >= 0 ? 1 : -1;
          gap = -dx;
        } else if (dy <= dz) {
          this.gap.y = this.local.y >= 0 ? 1 : -1;
          gap = -dy;
        } else {
          this.gap.z = this.local.z >= 0 ? 1 : -1;
          gap = -dz;
        }
        this.gap.applyQuaternion(box.rotation);
        keep(gap, this.gap.x, this.gap.y, this.gap.z);
      } else {
        const cx = Math.min(box.hx, Math.max(-box.hx, this.local.x));
        const cy = Math.min(box.hy, Math.max(-box.hy, this.local.y));
        const cz = Math.min(box.hz, Math.max(-box.hz, this.local.z));
        this.gap.set(this.local.x - cx, this.local.y - cy, this.local.z - cz);
        const dist = this.gap.length();
        if (dist < 1e-8) continue;
        this.gap.multiplyScalar(1 / dist).applyQuaternion(box.rotation);
        keep(dist, this.gap.x, this.gap.y, this.gap.z);
      }
    }

    return hit;
  }
}
