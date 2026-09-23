import { Vector3 } from "three";
import { clamp, lerp, saturate, shortestAngle, wrap01 } from "./math";
import type { WoodenMannequin } from "./mannequin";

export interface Walker {
  destination: Vector3 | null;
  yaw: number;
  speed: number;
  phase: number;
  fly: boolean;
  climb: number;
}

export function createWalker(): Walker {
  return {
    destination: null,
    yaw: 0,
    speed: 0,
    phase: 0,
    fly: false,
    climb: FLY_HEIGHT,
  };
}

const MAX_SPEED = 1.24;
const FLY_SPEED = 2.2;
const ACCEL = 2.6;
const DECEL = 3.4;
const TURN_RATE = 3.4;
const ARRIVE = 0.2;
const STEP_METERS = 0.72;
/** Cruise height for a double-tap. The window passage asks for a higher climb. */
const FLY_HEIGHT = 1.58;

export function setDestination(walker: Walker, point: Vector3, fly = false, climb = FLY_HEIGHT): void {
  walker.destination = point.clone();
  walker.destination.y = 0;
  walker.fly = fly;
  walker.climb = climb;
}

export function steerWalker(
  walker: Walker,
  rootPosition: Vector3,
  dt: number,
  canFly = false,
  groundY = 0,
): { walkWeight: number; arrived: boolean; flying: boolean } {
  if (!canFly) walker.fly = false;
  const fly = canFly && (walker.fly || rootPosition.y > groundY + 0.08);
  const targetY = canFly && walker.fly && walker.destination ? walker.climb : groundY;
  rootPosition.y += (targetY - rootPosition.y) * Math.min(1, dt * 2.3);
  if (!fly) rootPosition.y = Math.max(groundY, rootPosition.y - 4.2 * dt);
  if (rootPosition.y < groundY + 0.08 && !walker.destination) walker.fly = false;
  const flying = rootPosition.y > groundY + 0.28;

  if (!walker.destination) {
    walker.speed = Math.max(0, walker.speed - DECEL * dt);
    return { walkWeight: flying ? 0 : saturate(walker.speed / 0.35), arrived: true, flying };
  }

  const to = walker.destination.clone().sub(rootPosition);
  to.y = 0;
  const distance = to.length();
  if (distance < ARRIVE) {
    walker.destination = null;
    walker.speed = Math.max(0, walker.speed - DECEL * dt);
    return { walkWeight: flying ? 0 : saturate(walker.speed / 0.35), arrived: true, flying };
  }

  const desiredYaw = Math.atan2(to.x, to.z);
  const turn = clamp(shortestAngle(walker.yaw, desiredYaw), -TURN_RATE * dt, TURN_RATE * dt);
  walker.yaw += turn;

  const facing = 1 - saturate(Math.abs(shortestAngle(walker.yaw, desiredYaw)) / 1.2);
  const slow = saturate((distance - ARRIVE) / 0.7);
  const max = flying ? FLY_SPEED : MAX_SPEED;
  const targetSpeed = max * (flying ? Math.max(0.55, facing) : facing * Math.max(0.35, slow));
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

  return { walkWeight: flying ? 0 : saturate(walker.speed / 0.42), arrived: false, flying };
}

/** Tucked legs and a forward lean while the jetpack is off the sand. */
export function poseHover(figure: WoodenMannequin, walker: Walker, time: number): void {
  figure.resetPose();
  const lean = Math.min(0.22, walker.speed * 0.08);
  const pelvis = figure.bone("pelvis");
  pelvis.position.y = figure.restPelvisY + Math.sin(time * 6) * 0.02;
  pelvis.quaternion.copy(figure.restLocal.get("pelvis")!);
  pelvis.rotateX(-0.12 - lean);
  figure.bone("chest").rotateX(0.08);
  for (const side of ["left", "right"] as const) {
    const hip = figure.bone(side === "left" ? "leftHip" : "rightHip");
    const knee = figure.bone(side === "left" ? "leftKnee" : "rightKnee");
    hip.quaternion.copy(figure.restLocal.get(side === "left" ? "leftHip" : "rightHip")!);
    knee.quaternion.copy(figure.restLocal.get(side === "left" ? "leftKnee" : "rightKnee")!);
    hip.rotateX(-0.55);
    knee.rotateX(1.05);
    const shoulder = figure.bone(side === "left" ? "leftShoulder" : "rightShoulder");
    shoulder.quaternion.copy(figure.restLocal.get(side === "left" ? "leftShoulder" : "rightShoulder")!);
    shoulder.rotateZ((side === "left" ? 1 : -1) * 0.35);
    shoulder.rotateX(-0.25);
  }
  figure.bone("root").rotation.set(0, walker.yaw, 0);
  figure.refreshWorld();
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
  held: { leftArm?: boolean; rightArm?: boolean } = {},
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

  if (!held.leftArm) {
    poseArm(figure, "left", -Math.cos(leftPhase * Math.PI * 2), walkWeight);
  }
  if (!held.rightArm) {
    poseArm(figure, "right", -Math.cos(rightPhase * Math.PI * 2), walkWeight);
  }

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
