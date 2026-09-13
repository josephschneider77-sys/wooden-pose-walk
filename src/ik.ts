import { Quaternion, Vector3 } from "three";
import {
  clamp,
  quaternionBetween,
  quaternionFromScaledAngleAxis,
} from "./math";

export interface Xform {
  translation: Vector3;
  rotation: Quaternion;
}

const _axisDwn = new Vector3();
const _axisFwd = new Vector3();
const _axisRot = new Vector3();
const _tmp = new Vector3();
const _r0 = new Quaternion();
const _r1 = new Quaternion();
const _r2 = new Quaternion();
const _scaled = new Vector3();

/**
 * Two-bone IK from Daniel Holden / Orange Duck:
 * soft max-extension clamp + knee side vector as the rotation axis
 * (no pole vector).
 */
export function twoBoneInverseKinematics(
  localHip: Quaternion,
  localKnee: Quaternion,
  globalPelvis: Xform,
  globalHip: Xform,
  globalKnee: Xform,
  globalHeel: Xform,
  targetHeel: Vector3,
  sideVector: Vector3,
  maxExtension: number,
  softening: number,
): void {
  const targetClamp = targetHeel.clone();
  const targetLength = targetHeel.distanceTo(globalHip.translation);

  if (targetLength > maxExtension - softening) {
    const saturation =
      1.0 -
      Math.exp(
        -Math.max(targetLength - maxExtension + softening, 0.0) / softening,
      );
    const scale =
      (maxExtension - softening + softening * saturation) / targetLength;
    targetClamp.copy(targetHeel).sub(globalHip.translation).multiplyScalar(scale);
    targetClamp.add(globalHip.translation);
  }

  _axisDwn.subVectors(globalHeel.translation, globalHip.translation).normalize();
  _axisFwd.crossVectors(_axisDwn, sideVector).normalize();
  _axisRot.crossVectors(_axisDwn, _axisFwd).normalize();

  const a = globalHip.translation;
  const b = globalKnee.translation;
  const c = globalHeel.translation;
  const t = targetClamp;

  const lab = Math.max(b.distanceTo(a), 1e-5);
  const lcb = Math.max(b.distanceTo(c), 1e-5);
  const lat = Math.max(t.distanceTo(a), 1e-5);
  const lca = Math.max(a.distanceTo(c), 1e-5);

  const acab0 = Math.acos(
    clamp(
      _tmp.copy(c).sub(a).multiplyScalar(1 / lca).dot(
        new Vector3().copy(b).sub(a).multiplyScalar(1 / lab),
      ),
      -1,
      1,
    ),
  );
  const babc0 = Math.acos(
    clamp(
      _tmp.copy(a).sub(b).multiplyScalar(1 / lab).dot(
        new Vector3().copy(c).sub(b).multiplyScalar(1 / lcb),
      ),
      -1,
      1,
    ),
  );
  const acab1 = Math.acos(
    clamp((lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat), -1, 1),
  );
  const babc1 = Math.acos(
    clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1),
  );

  quaternionFromScaledAngleAxis(
    _scaled.copy(_axisRot).multiplyScalar(acab1 - acab0),
    _r0,
  );
  quaternionFromScaledAngleAxis(
    _scaled.copy(_axisRot).multiplyScalar(babc1 - babc0),
    _r1,
  );
  quaternionBetween(
    _tmp.copy(globalHeel.translation).sub(globalHip.translation),
    new Vector3().copy(targetClamp).sub(globalHip.translation),
    _r2,
  );

  localHip
    .copy(globalPelvis.rotation)
    .invert()
    .multiply(_r2)
    .multiply(_r0)
    .multiply(globalHip.rotation);

  localKnee
    .copy(globalHip.rotation)
    .invert()
    .multiply(_r1)
    .multiply(globalKnee.rotation);
}

export function boneOrientTowards(
  boneParent: Xform,
  bone: Xform,
  boneChild: Xform,
  target: Vector3,
  out = new Quaternion(),
): Quaternion {
  const desired = quaternionBetween(
    _tmp.copy(boneChild.translation).sub(bone.translation),
    new Vector3().copy(target).sub(bone.translation),
  ).multiply(bone.rotation);

  return out.copy(boneParent.rotation).invert().multiply(desired);
}
