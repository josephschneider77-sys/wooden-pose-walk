import { Quaternion, Vector3 } from "three";
import type { BoneName, WoodenMannequin } from "./mannequin";
import {
  projectOutBox,
  projectOutCapsule,
  projectOutSphere,
  type ClothParticle,
} from "./verletCloth";

/** Air gap so the cloth sits on the wood instead of sharing the surface. */
const MARGIN = 0.04;

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
 * Oriented boxes, capsules, and spheres around the wooden figure so
 * cloth vertices cannot remain inside the body.
 */
export class BodyShell {
  private readonly spheres: SphereHit[] = Array.from({ length: 11 }, () => ({
    center: new Vector3(),
    radius: 0.1,
  }));
  private readonly capsules: CapsuleHit[] = Array.from({ length: 12 }, () => ({
    a: new Vector3(),
    b: new Vector3(),
    radius: 0.08,
  }));
  private readonly boxes: BoxHit[] = Array.from({ length: 4 }, () => ({
    center: new Vector3(),
    rotation: new Quaternion(),
    hx: 0.1,
    hy: 0.1,
    hz: 0.1,
  }));

  refresh(figure: WoodenMannequin): void {
    const s = this.spheres;
    const c = this.capsules;
    const b = this.boxes;

    // Head / photoreal face (chin-to-crown ~0.2, cheeks ~0.16).
    point(figure, "head", 0, 0.1, 0.02, s[0].center);
    s[0].radius = 0.125 + MARGIN;
    point(figure, "head", 0, 0.08, 0.09, s[1].center);
    s[1].radius = 0.09 + MARGIN;
    point(figure, "head", 0, 0.02, 0.03, s[2].center);
    s[2].radius = 0.085 + MARGIN;
    point(figure, "neck", 0, 0.02, 0, s[3].center);
    s[3].radius = 0.072 + MARGIN;
    point(figure, "leftShoulder", 0, 0, 0, s[4].center);
    s[4].radius = 0.07 + MARGIN;
    point(figure, "rightShoulder", 0, 0, 0, s[5].center);
    s[5].radius = 0.07 + MARGIN;
    point(figure, "leftHand", 0, -0.05, 0, s[6].center);
    s[6].radius = 0.055 + MARGIN;
    point(figure, "rightHand", 0, -0.05, 0, s[7].center);
    s[7].radius = 0.055 + MARGIN;
    point(figure, "leftHip", 0, 0, 0, s[8].center);
    s[8].radius = 0.065 + MARGIN;
    point(figure, "rightHip", 0, 0, 0, s[9].center);
    s[9].radius = 0.065 + MARGIN;
    point(figure, "chest", 0, 0.12, -0.02, s[10].center);
    s[10].radius = 0.15 + MARGIN;

    point(figure, "neck", 0, 0, 0, c[0].a);
    point(figure, "head", 0, 0.14, 0.01, c[0].b);
    c[0].radius = 0.08 + MARGIN;
    point(figure, "chest", 0, 0.02, 0, c[1].a);
    point(figure, "pelvis", 0, 0.04, 0, c[1].b);
    c[1].radius = 0.11 + MARGIN;
    point(figure, "leftShoulder", 0, 0, 0, c[2].a);
    point(figure, "leftElbow", 0, 0, 0, c[2].b);
    c[2].radius = 0.042 + MARGIN;
    point(figure, "leftElbow", 0, 0, 0, c[3].a);
    point(figure, "leftWrist", 0, 0, 0, c[3].b);
    c[3].radius = 0.034 + MARGIN;
    point(figure, "rightShoulder", 0, 0, 0, c[4].a);
    point(figure, "rightElbow", 0, 0, 0, c[4].b);
    c[4].radius = 0.042 + MARGIN;
    point(figure, "rightElbow", 0, 0, 0, c[5].a);
    point(figure, "rightWrist", 0, 0, 0, c[5].b);
    c[5].radius = 0.034 + MARGIN;
    point(figure, "leftHip", 0, 0, 0, c[6].a);
    point(figure, "leftKnee", 0, 0, 0, c[6].b);
    c[6].radius = 0.052 + MARGIN;
    point(figure, "leftKnee", 0, 0, 0, c[7].a);
    point(figure, "leftHeel", 0, 0, 0, c[7].b);
    c[7].radius = 0.04 + MARGIN;
    point(figure, "rightHip", 0, 0, 0, c[8].a);
    point(figure, "rightKnee", 0, 0, 0, c[8].b);
    c[8].radius = 0.052 + MARGIN;
    point(figure, "rightKnee", 0, 0, 0, c[9].a);
    point(figure, "rightHeel", 0, 0, 0, c[9].b);
    c[9].radius = 0.04 + MARGIN;
    point(figure, "leftShoulder", 0.02, 0.01, -0.01, c[10].a);
    point(figure, "rightShoulder", -0.02, 0.01, -0.01, c[10].b);
    c[10].radius = 0.075 + MARGIN;
    point(figure, "spine", 0, 0.04, 0, c[11].a);
    point(figure, "chest", 0, 0.08, 0, c[11].b);
    c[11].radius = 0.1 + MARGIN;

    // Wooden boxes + a head volume for the scan.
    setBox(figure, "chest", 0, 0.12, 0, 0.13, 0.14, 0.08, b[0]);
    setBox(figure, "chest", 0, 0.13, 0.055, 0.1, 0.09, 0.035, b[1]);
    setBox(figure, "pelvis", 0, 0.02, 0, 0.12, 0.06, 0.08, b[2]);
    setBox(figure, "head", 0, 0.09, 0.015, 0.088, 0.11, 0.095, b[3]);
  }

  /** Push every free particle onto the exterior. Collar row stays pinned. */
  resolve(particles: ClothParticle[], skipCount: number): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = skipCount; i < particles.length; i++) {
        const p = particles[i];
        for (const box of this.boxes) {
          projectOutBox(p, box.center, box.rotation, box.hx, box.hy, box.hz);
        }
        for (const s of this.spheres) projectOutSphere(p, s.center, s.radius);
        for (const cap of this.capsules) projectOutCapsule(p, cap.a, cap.b, cap.radius);
      }
    }
  }
}
