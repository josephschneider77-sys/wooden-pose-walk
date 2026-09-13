import { Vector3 } from "three";
import { clamp } from "./math";

export interface FootLockingState {
  position: Vector3;
  velocity: Vector3;
  inputPosition: Vector3;
  inputVelocity: Vector3;
  offsetPosition: Vector3;
  offsetVelocity: Vector3;
  time: number;
  contact: Vector3;
  locked: boolean;
}

export function createFootLock(position: Vector3): FootLockingState {
  return {
    position: position.clone(),
    velocity: new Vector3(),
    inputPosition: position.clone(),
    inputVelocity: new Vector3(),
    offsetPosition: new Vector3(),
    offsetVelocity: new Vector3(),
    time: 10,
    contact: position.clone(),
    locked: false,
  };
}

function inertializeCubicUpdate(
  position: Vector3,
  velocity: Vector3,
  state: FootLockingState,
  inputPosition: Vector3,
  inputVelocity: Vector3,
  deltaTime: number,
  blendTime: number,
): void {
  const t = clamp((state.time + deltaTime) / Math.max(blendTime, 1e-8), 0, 1);
  const w0 = 2 * t * t * t - 3 * t * t + 1;
  const w1 = (t * t * t - 2 * t * t + t) * blendTime;
  const w2 = (6 * t * t - 6 * t) / Math.max(blendTime, 1e-8);
  const w3 = 3 * t * t - 4 * t + 1;

  position
    .copy(inputPosition)
    .addScaledVector(state.offsetPosition, w0)
    .addScaledVector(state.offsetVelocity, w1);
  velocity
    .copy(inputVelocity)
    .addScaledVector(state.offsetPosition, w2)
    .addScaledVector(state.offsetVelocity, w3);
  state.time += deltaTime;
}

function inertializeCubicTransition(
  state: FootLockingState,
  sourcePosition: Vector3,
  sourceVelocity: Vector3,
  destinationPosition: Vector3,
  destinationVelocity: Vector3,
  blendTime: number,
): void {
  const t = clamp(state.time / Math.max(blendTime, 1e-8), 0, 1);
  const w0 = 2 * t * t * t - 3 * t * t + 1;
  const w1 = (t * t * t - 2 * t * t + t) * blendTime;
  const w2 = (6 * t * t - 6 * t) / Math.max(blendTime, 1e-8);
  const w3 = 3 * t * t - 4 * t + 1;

  const oldOffPos = state.offsetPosition.clone();
  const oldOffVel = state.offsetVelocity.clone();

  state.offsetPosition
    .copy(sourcePosition)
    .addScaledVector(oldOffPos, w0)
    .addScaledVector(oldOffVel, w1)
    .sub(destinationPosition);

  state.offsetVelocity
    .copy(sourceVelocity)
    .addScaledVector(oldOffPos, w2)
    .addScaledVector(oldOffVel, w3)
    .sub(destinationVelocity);

  state.time = 0;
}

/**
 * Runtime toe locking with cubic inertialization.
 * When contact is active, follow the planted contact; otherwise follow the
 * source animation toe. Transitions blend with Holden's cubic weights.
 */
export function updateFootLockingState(
  state: FootLockingState,
  inputPosition: Vector3,
  inputContact: boolean,
  contactHeight: number,
  deltaTime: number,
  unlockDistance: number,
  lockDistance: number,
  blendTime: number,
): void {
  state.inputVelocity
    .copy(inputPosition)
    .sub(state.inputPosition)
    .multiplyScalar(1 / Math.max(deltaTime, 1e-8));
  state.inputPosition.copy(inputPosition);

  inertializeCubicUpdate(
    state.position,
    state.velocity,
    state,
    state.locked ? state.contact : state.inputPosition,
    state.locked ? new Vector3() : state.inputVelocity,
    deltaTime,
    blendTime,
  );

  const inputDistance = state.position.distanceTo(state.inputPosition);

  if (!state.locked && inputContact && inputDistance < lockDistance) {
    state.locked = true;
    state.contact.copy(state.inputPosition);
    state.contact.y = contactHeight;
    inertializeCubicTransition(
      state,
      state.inputPosition,
      state.inputVelocity,
      state.contact,
      new Vector3(),
      blendTime,
    );
  } else if (state.locked && (!inputContact || inputDistance > unlockDistance)) {
    state.locked = false;
    inertializeCubicTransition(
      state,
      state.contact,
      new Vector3(),
      state.inputPosition,
      state.inputVelocity,
      blendTime,
    );
  }
}
