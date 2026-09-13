import { Vector3 } from "three";
import { clamp, lerp, saturate, shortestAngle, wrap01 } from "./math";
import type { WoodenMannequin } from "./mannequin";

export interface Walker {
  destination: Vector3 | null;
  yaw: number;
  speed: number;
  phase: number;
}

export function createWalker(): Walker {
  return {
    destination: null,
    yaw: 0,
    speed: 0,
    phase: 0,
  };
}

const MAX_SPEED = 1.24;
const ACCEL = 2.6;
const DECEL = 3.4;
const TURN_RATE = 3.4;
const ARRIVE = 0.2;
const STEP_METERS = 0.72;

export function setDestination(walker: Walker, point: Vector3): void {
  walker.destination = point.clone();
  walker.destination.y = 0;
}

export function steerWalker(
  walker: Walker,
  rootPosition: Vector3,
  dt: number,
): { walkWeight: number; arrived: boolean } {
  if (!walker.destination) {
    walker.speed = Math.max(0, walker.speed - DECEL * dt);
    return { walkWeight: saturate(walker.speed / 0.35), arrived: true };
  }

  const to = walker.destination.clone().sub(rootPosition);
  to.y = 0;
  const distance = to.length();
  if (distance < ARRIVE) {
    walker.destination = null;
    walker.speed = Math.max(0, walker.speed - DECEL * dt);
    return { walkWeight: saturate(walker.speed / 0.35), arrived: true };
  }

  const desiredYaw = Math.atan2(to.x, to.z);
  const turn = clamp(shortestAngle(walker.yaw, desiredYaw), -TURN_RATE * dt, TURN_RATE * dt);
  walker.yaw += turn;

  const facing = 1 - saturate(Math.abs(shortestAngle(walker.yaw, desiredYaw)) / 1.2);
  const slow = saturate((distance - ARRIVE) / 0.7);
  const targetSpeed = MAX_SPEED * facing * Math.max(0.35, slow);
  if (walker.speed < targetSpeed) {
    walker.speed = Math.min(targetSpeed, walker.speed + ACCEL * dt);
  } else {
    walker.speed = Math.max(targetSpeed, walker.speed - DECEL * dt);
  }

  // Source gait advances a little slower than root travel so raw motion slides;
  // toe locking is what plants the feet.
  const gaitSpeed = walker.speed * 0.8;
  walker.phase = wrap01(walker.phase + (gaitSpeed * dt) / (STEP_METERS * 2));

  rootPosition.x += Math.sin(walker.yaw) * walker.speed * dt;
  rootPosition.z += Math.cos(walker.yaw) * walker.speed * dt;

  return { walkWeight: saturate(walker.speed / 0.42), arrived: false };
}

function poseLeg(
  figure: WoodenMannequin,
  side: "left" | "right",
  legPhase: number,
  walkWeight: number,
): boolean {
  const hip = figure.bone(side === "left" ? "leftHip" : "rightHip");
  const knee = figure.bone(side === "left" ? "leftKnee" : "rightKnee");
  const heel = figure.bone(side === "left" ? "leftHeel" : "rightHeel");

  hip.quaternion.copy(figure.restLocal.get(side === "left" ? "leftHip" : "rightHip")!);
  knee.quaternion.copy(figure.restLocal.get(side === "left" ? "leftKnee" : "rightKnee")!);
  heel.quaternion.copy(figure.restLocal.get(side === "left" ? "leftHeel" : "rightHeel")!);

  const contact = walkWeight < 0.22 || legPhase < 0.56;
  const swing = saturate((legPhase - 0.56) / 0.44);
  const hipAmp = lerp(0.05, 0.4, walkWeight);
  const hipFlex = Math.cos(legPhase * Math.PI * 2) * hipAmp;
  const kneeFlex = contact
    ? lerp(0.16, 0.08, saturate(legPhase / 0.56)) * walkWeight + 0.04
    : 0.2 + Math.sin(swing * Math.PI) * lerp(0.2, 0.95, walkWeight);
  const ankle = contact
    ? lerp(-0.08, 0.12, legPhase / 0.56) * walkWeight
    : lerp(0.15, -0.2, swing) * walkWeight;

  hip.rotateX(-hipFlex);
  hip.rotateZ((side === "left" ? -1 : 1) * 0.03 * walkWeight);
  knee.rotateX(kneeFlex);
  heel.rotateX(ankle);
  return contact;
}

export function poseMannequin(
  figure: WoodenMannequin,
  walker: Walker,
  walkWeight: number,
  time: number,
): { leftContact: boolean; rightContact: boolean } {
  figure.resetPose();

  const pelvis = figure.bone("pelvis");
  const chest = figure.bone("chest");
  const spine = figure.bone("spine");
  const restPelvisY = figure.restPelvisY;
  const bob =
    Math.abs(Math.sin(walker.phase * Math.PI * 2)) * 0.022 * walkWeight +
    Math.sin(time * 1.7) * 0.006 * (1 - walkWeight);
  pelvis.position.y = restPelvisY + bob;
  pelvis.quaternion.copy(figure.restLocal.get("pelvis")!);
  pelvis.rotateY(Math.sin(walker.phase * Math.PI * 2) * 0.1 * walkWeight);
  pelvis.rotateZ(Math.sin(walker.phase * Math.PI * 2) * 0.045 * walkWeight);
  pelvis.rotateX(-0.04 * walkWeight + Math.sin(time * 1.4) * 0.015 * (1 - walkWeight));

  spine.quaternion.copy(figure.restLocal.get("spine")!);
  spine.rotateX(0.04 * walkWeight);
  chest.quaternion.copy(figure.restLocal.get("chest")!);
  chest.rotateY(-Math.sin(walker.phase * Math.PI * 2) * 0.12 * walkWeight);
  chest.rotateX(Math.sin(time * 1.5) * 0.02 * (1 - walkWeight));

  const leftPhase = walker.phase;
  const rightPhase = wrap01(walker.phase + 0.5);
  const leftContact = poseLeg(figure, "left", leftPhase, walkWeight);
  const rightContact = poseLeg(figure, "right", rightPhase, walkWeight);

  poseArm(figure, "left", -Math.cos(leftPhase * Math.PI * 2), walkWeight);
  poseArm(figure, "right", -Math.cos(rightPhase * Math.PI * 2), walkWeight);

  figure.bone("root").rotation.set(0, walker.yaw, 0);
  figure.refreshWorld();
  return { leftContact, rightContact };
}

function poseArm(
  figure: WoodenMannequin,
  side: "left" | "right",
  swing: number,
  walkWeight: number,
): void {
  const shoulderName = side === "left" ? "leftShoulder" : "rightShoulder";
  const elbowName = side === "left" ? "leftElbow" : "rightElbow";
  const shoulder = figure.bone(shoulderName);
  const elbow = figure.bone(elbowName);
  shoulder.quaternion.copy(figure.restLocal.get(shoulderName)!);
  elbow.quaternion.copy(figure.restLocal.get(elbowName)!);
  shoulder.rotateX(swing * lerp(0.04, 0.42, walkWeight));
  shoulder.rotateZ((side === "left" ? 1 : -1) * 0.08);
  elbow.rotateX(0.18 + Math.max(0, -swing) * 0.35 * walkWeight);
}

export function describeGait(
  walkWeight: number,
  leftLocked: boolean,
  rightLocked: boolean,
  ikOn: boolean,
  lockOn: boolean,
): string {
  if (!ikOn) return "IK off — raw walk cycle, feet can skate";
  if (!lockOn) return "IK on, lock off — heels follow the source pose";
  if (walkWeight < 0.2) return "Idle · both toes planted";
  if (leftLocked && rightLocked) return "Walking · both toes locked";
  if (leftLocked) return "Walking · left toe locked";
  if (rightLocked) return "Walking · right toe locked";
  return "Walking · both toes swinging";
}
