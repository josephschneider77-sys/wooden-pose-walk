import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { boneOrientTowards, twoBoneInverseKinematics, type Xform } from "./ik";
import { createJointMaterial, createWoodMaterial } from "./wood";

export type LimbId = "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

export type BoneName =
  | "root"
  | "pelvis"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "leftShoulder"
  | "leftElbow"
  | "leftWrist"
  | "leftHand"
  | "rightShoulder"
  | "rightElbow"
  | "rightWrist"
  | "rightHand"
  | "leftHip"
  | "leftKnee"
  | "leftHeel"
  | "leftToe"
  | "leftToeEnd"
  | "rightHip"
  | "rightKnee"
  | "rightHeel"
  | "rightToe"
  | "rightToeEnd";

const LIMB = {
  thigh: 0.4,
  shin: 0.38,
  footLift: 0.05,
  footLen: 0.2,
  toeLen: 0.075,
  upperArm: 0.3,
  forearm: 0.26,
  hipWidth: 0.2,
  shoulderWidth: 0.36,
} as const;

export const MANNEQUIN_HEIGHT = 1.66;
export const ARM_REACH = LIMB.upperArm + LIMB.forearm;
export const LEG_REACH = LIMB.thigh + LIMB.shin;

function xformOf(object: Object3D, target: Xform): Xform {
  object.matrixWorld.decompose(target.translation, target.rotation, _scale);
  return target;
}

const _scale = new Vector3();
const _side = new Vector3();
const _modifiedHip = new Quaternion();
const _modifiedKnee = new Quaternion();
const _modifiedShoulder = new Quaternion();
const _modifiedElbow = new Quaternion();
const _pelvisX = { translation: new Vector3(), rotation: new Quaternion() };
const _chestX = { translation: new Vector3(), rotation: new Quaternion() };
const _hipX = { translation: new Vector3(), rotation: new Quaternion() };
const _kneeX = { translation: new Vector3(), rotation: new Quaternion() };
const _heelX = { translation: new Vector3(), rotation: new Quaternion() };
const _toeX = { translation: new Vector3(), rotation: new Quaternion() };
const _toeEndX = { translation: new Vector3(), rotation: new Quaternion() };
const _shoulderX = { translation: new Vector3(), rotation: new Quaternion() };
const _elbowX = { translation: new Vector3(), rotation: new Quaternion() };
const _wristX = { translation: new Vector3(), rotation: new Quaternion() };
const _handX = { translation: new Vector3(), rotation: new Quaternion() };

export function limbIdOf(object: Object3D): LimbId | null {
  let current: Object3D | null = object;
  while (current) {
    const id = current.userData.limbId as LimbId | undefined;
    if (id) return id;
    current = current.parent;
  }
  return null;
}

export function isArm(id: LimbId): boolean {
  return id === "leftArm" || id === "rightArm";
}

export function limbSide(id: LimbId): "left" | "right" {
  return id.startsWith("left") ? "left" : "right";
}

export function limbAnchor(id: LimbId): "chest" | "pelvis" {
  return isArm(id) ? "chest" : "pelvis";
}

export function limbEndBone(id: LimbId): BoneName {
  if (id === "leftArm") return "leftHand";
  if (id === "rightArm") return "rightHand";
  if (id === "leftLeg") return "leftToe";
  return "rightToe";
}

export function limbLabel(id: LimbId): string {
  const side = limbSide(id);
  return isArm(id) ? `${side} arm` : `${side} leg`;
}

function addMesh(parent: Object3D, mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function ball(radius: number, material: MeshPhysicalMaterial): Mesh {
  return new Mesh(new SphereGeometry(radius, 22, 16), material);
}

function limb(
  length: number,
  rTop: number,
  rBot: number,
  material: MeshPhysicalMaterial,
): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(rTop, rBot, length, 18),
    material,
  );
  mesh.position.y = -length / 2;
  return mesh;
}

export class WoodenMannequin {
  readonly root = new Group();
  readonly bones = new Map<BoneName, Object3D>();
  readonly restLocal = new Map<BoneName, Quaternion>();
  readonly restPelvisY: number;
  readonly heelMinHeight: number;
  readonly toeMinHeight: number;
  readonly toeEndMinHeight: number;
  skull: Mesh | null = null;
  neckSocket: Group | null = null;

  private readonly wood = createWoodMaterial({
    kind: "walnut",
    seed: 14,
    repeatX: 1.1,
    repeatY: 2.4,
  });
  private readonly darkWood = createWoodMaterial({
    kind: "beech",
    base: "#a56b34",
    seed: 41,
    repeatX: 1.6,
    repeatY: 1.2,
  });
  private readonly joint = createJointMaterial();

  constructor() {
    this.root.name = "mannequin";
    this.build();
    this.root.updateWorldMatrix(true, true);
    this.restPelvisY = this.bone("pelvis").position.y;
    this.heelMinHeight = this.worldPos("leftHeel").y;
    this.toeMinHeight = this.worldPos("leftToe").y;
    this.toeEndMinHeight = this.worldPos("leftToeEnd").y;
  }

  bone(name: BoneName): Object3D {
    const found = this.bones.get(name);
    if (!found) throw new Error(`Missing bone ${name}`);
    return found;
  }

  worldPos(name: BoneName, out = new Vector3()): Vector3 {
    return this.bone(name).getWorldPosition(out);
  }

  resetPose(): void {
    for (const [name, rest] of this.restLocal) {
      this.bone(name).quaternion.copy(rest);
    }
  }

  refreshWorld(): void {
    this.root.updateWorldMatrix(true, true);
  }

  solveLeg(
    side: "left" | "right",
    targetToe: Vector3,
    options: {
      enableHeightClamp: boolean;
      enableHeelLookAt: boolean;
      enableToeLookAt: boolean;
      softening: number;
      maxReach?: number;
    },
  ): void {
    const hipName = side === "left" ? "leftHip" : "rightHip";
    const kneeName = side === "left" ? "leftKnee" : "rightKnee";
    const heelName = side === "left" ? "leftHeel" : "rightHeel";
    const toeName = side === "left" ? "leftToe" : "rightToe";
    const toeEndName = side === "left" ? "leftToeEnd" : "rightToeEnd";

    const pelvis = this.bone("pelvis");
    const hip = this.bone(hipName);
    const knee = this.bone(kneeName);
    const heel = this.bone(heelName);
    const toe = this.bone(toeName);
    const toeEnd = this.bone(toeEndName);

    const toeTarget = targetToe.clone();
    if (options.enableHeightClamp) {
      toeTarget.y = Math.max(toeTarget.y, this.toeMinHeight);
    }

    xformOf(heel, _heelX);
    xformOf(toe, _toeX);
    const targetHeel = toeTarget.clone().add(
      _heelX.translation.clone().sub(_toeX.translation),
    );
    if (options.enableHeightClamp) {
      targetHeel.y = Math.max(targetHeel.y, this.heelMinHeight);
    }

    xformOf(pelvis, _pelvisX);
    xformOf(hip, _hipX);
    xformOf(knee, _kneeX);
    xformOf(heel, _heelX);

    const kneeSideLocal = side === "left" ? new Vector3(1, 0, 0) : new Vector3(-1, 0, 0);
    _side.copy(kneeSideLocal).applyQuaternion(
      options.maxReach !== undefined ? _pelvisX.rotation : _kneeX.rotation,
    );
    const maxExtension =
      options.maxReach ?? _hipX.translation.distanceTo(_heelX.translation);

    twoBoneInverseKinematics(
      _modifiedHip,
      _modifiedKnee,
      _pelvisX,
      _hipX,
      _kneeX,
      _heelX,
      targetHeel,
      _side,
      maxExtension,
      options.softening,
    );
    hip.quaternion.copy(_modifiedHip);
    knee.quaternion.copy(_modifiedKnee);

    if (options.enableHeelLookAt) {
      this.refreshWorld();
      xformOf(knee, _kneeX);
      xformOf(heel, _heelX);
      xformOf(toe, _toeX);
      heel.quaternion.copy(
        boneOrientTowards(_kneeX, _heelX, _toeX, toeTarget),
      );
    }

    if (options.enableToeLookAt) {
      this.refreshWorld();
      xformOf(heel, _heelX);
      xformOf(toe, _toeX);
      xformOf(toeEnd, _toeEndX);
      const toeEndTarget = _toeEndX.translation.clone();
      if (options.enableHeightClamp) {
        toeEndTarget.y = Math.max(toeEndTarget.y, this.toeEndMinHeight);
      }
      toe.quaternion.copy(
        boneOrientTowards(_heelX, _toeX, _toeEndX, toeEndTarget),
      );
    }

    this.refreshWorld();
  }

  solveArm(side: "left" | "right", targetHand: Vector3, softening: number): void {
    const shoulderName = side === "left" ? "leftShoulder" : "rightShoulder";
    const elbowName = side === "left" ? "leftElbow" : "rightElbow";
    const wristName = side === "left" ? "leftWrist" : "rightWrist";
    const handName = side === "left" ? "leftHand" : "rightHand";

    const chest = this.bone("chest");
    const shoulder = this.bone(shoulderName);
    const elbow = this.bone(elbowName);
    const wrist = this.bone(wristName);
    const hand = this.bone(handName);

    xformOf(wrist, _wristX);
    xformOf(hand, _handX);
    const targetWrist = targetHand.clone().add(
      _wristX.translation.clone().sub(_handX.translation),
    );

    xformOf(chest, _chestX);
    xformOf(shoulder, _shoulderX);
    xformOf(elbow, _elbowX);
    xformOf(wrist, _wristX);

    const elbowSideLocal = side === "left" ? new Vector3(1, 0, -0.55) : new Vector3(-1, 0, -0.55);
    _side.copy(elbowSideLocal).applyQuaternion(_chestX.rotation);
    const maxExtension = ARM_REACH;

    twoBoneInverseKinematics(
      _modifiedShoulder,
      _modifiedElbow,
      _chestX,
      _shoulderX,
      _elbowX,
      _wristX,
      targetWrist,
      _side,
      maxExtension,
      softening,
    );
    shoulder.quaternion.copy(_modifiedShoulder);
    elbow.quaternion.copy(_modifiedElbow);

    this.refreshWorld();
    xformOf(elbow, _elbowX);
    xformOf(wrist, _wristX);
    xformOf(hand, _handX);
    wrist.quaternion.copy(
      boneOrientTowards(_elbowX, _wristX, _handX, targetHand),
    );
    this.refreshWorld();
  }

  pickables(): Mesh[] {
    const meshes: Mesh[] = [];
    this.root.traverse((object) => {
      if ((object as Mesh).isMesh && limbIdOf(object)) {
        meshes.push(object as Mesh);
      }
    });
    return meshes;
  }

  private buildNeckSocket(head: Object3D): Group {
    const socket = new Group();
    socket.name = "neckSocket";
    socket.position.y = -0.012;
    head.add(socket);

    const cup = new Mesh(
      new LatheGeometry(
        [
          new Vector2(0.034, -0.028),
          new Vector2(0.04, -0.01),
          new Vector2(0.052, 0.01),
          new Vector2(0.062, 0.026),
          new Vector2(0.058, 0.034),
        ],
        32,
      ),
      this.wood,
    );
    cup.castShadow = true;
    cup.receiveShadow = true;
    socket.add(cup);

    const lip = new Mesh(
      new TorusGeometry(0.056, 0.007, 12, 36),
      this.joint,
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.03;
    lip.castShadow = true;
    lip.receiveShadow = true;
    socket.add(lip);

    const pivot = addMesh(socket, ball(0.034, this.joint));
    pivot.position.y = -0.02;
    return socket;
  }

  private tagLimb(object: Object3D, limbId: LimbId): void {
    object.userData.limbId = limbId;
  }

  private addGrab(parent: Object3D, radius: number, limbId: LimbId, offsetY = 0): void {
    const handle = new Mesh(
      new SphereGeometry(radius, 10, 8),
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    handle.position.y = offsetY;
    handle.userData.limbId = limbId;
    handle.userData.grabHandle = true;
    parent.add(handle);
  }

  private register(name: BoneName, object: Object3D): Object3D {
    object.name = name;
    this.bones.set(name, object);
    this.restLocal.set(name, object.quaternion.clone());
    return object;
  }

  private build(): void {
    const root = this.register("root", this.root);

    const pelvisY = LIMB.thigh + LIMB.shin + LIMB.footLift + 0.055;
    const pelvis = new Group();
    pelvis.position.set(0, pelvisY, 0);
    root.add(pelvis);
    this.register("pelvis", pelvis);

    addMesh(pelvis, ball(0.062, this.joint));
    const pelvisBlock = addMesh(
      pelvis,
      new Mesh(new BoxGeometry(0.24, 0.11, 0.15), this.darkWood),
    );
    pelvisBlock.position.y = 0.02;

    const spine = new Group();
    spine.position.set(0, 0.1, 0);
    pelvis.add(spine);
    this.register("spine", spine);
    addMesh(spine, ball(0.05, this.joint));
    const waist = addMesh(spine, limb(0.12, 0.07, 0.08, this.wood));
    waist.position.y = 0.06;

    const chest = new Group();
    chest.position.set(0, 0.16, 0);
    spine.add(chest);
    this.register("chest", chest);
    addMesh(chest, ball(0.055, this.joint));
    const rib = addMesh(
      chest,
      new Mesh(new BoxGeometry(0.26, 0.28, 0.16), this.wood),
    );
    rib.position.y = 0.12;
    const chestFront = addMesh(
      chest,
      new Mesh(new BoxGeometry(0.2, 0.18, 0.06), this.darkWood),
    );
    chestFront.position.set(0, 0.13, 0.055);

    const neck = new Group();
    neck.position.set(0, 0.3, 0);
    chest.add(neck);
    this.register("neck", neck);
    addMesh(neck, ball(0.038, this.joint));
    addMesh(neck, limb(0.138, 0.03, 0.042, this.wood)).position.y = 0.03;

    const head = new Group();
    head.position.set(0, 0.12, 0);
    neck.add(head);
    this.register("head", head);
    const skull = addMesh(head, ball(0.1, this.wood));
    skull.scale.set(0.86, 1.18, 0.92);
    skull.position.y = 0.07;
    this.skull = skull;
    this.neckSocket = this.buildNeckSocket(head);

    this.buildArm("left", chest);
    this.buildArm("right", chest);
    this.buildLeg("left", pelvis);
    this.buildLeg("right", pelvis);

    for (const [name, object] of this.bones) {
      this.restLocal.set(name, object.quaternion.clone());
    }
  }

  private buildArm(side: "left" | "right", chest: Object3D): void {
    const sign = side === "left" ? 1 : -1;
    const limbId: LimbId = side === "left" ? "leftArm" : "rightArm";
    const shoulder = new Group();
    shoulder.position.set(sign * (LIMB.shoulderWidth / 2), 0.22, 0);
    chest.add(shoulder);
    this.register(side === "left" ? "leftShoulder" : "rightShoulder", shoulder);
    this.tagLimb(shoulder, limbId);
    addMesh(shoulder, ball(0.05, this.joint));
    addMesh(shoulder, limb(LIMB.upperArm, 0.034, 0.028, this.wood));
    this.addGrab(shoulder, 0.09, limbId, -LIMB.upperArm * 0.45);

    const elbow = new Group();
    elbow.position.set(0, -LIMB.upperArm, 0);
    shoulder.add(elbow);
    this.register(side === "left" ? "leftElbow" : "rightElbow", elbow);
    this.tagLimb(elbow, limbId);
    addMesh(elbow, ball(0.042, this.joint));
    addMesh(elbow, limb(LIMB.forearm, 0.026, 0.022, this.wood));
    this.addGrab(elbow, 0.085, limbId, -LIMB.forearm * 0.45);

    const wrist = new Group();
    wrist.position.set(0, -LIMB.forearm, 0);
    elbow.add(wrist);
    this.register(side === "left" ? "leftWrist" : "rightWrist", wrist);
    this.tagLimb(wrist, limbId);
    addMesh(wrist, ball(0.03, this.joint));
    this.addGrab(wrist, 0.08, limbId);

    const hand = new Group();
    hand.position.set(0, -0.02, 0);
    wrist.add(hand);
    this.register(side === "left" ? "leftHand" : "rightHand", hand);
    this.tagLimb(hand, limbId);
    this.addGrab(hand, 0.09, limbId, -0.05);
    const palm = addMesh(
      hand,
      new Mesh(new BoxGeometry(0.055, 0.1, 0.028), this.darkWood),
    );
    palm.position.y = -0.055;
    const thumb = addMesh(hand, ball(0.016, this.darkWood));
    thumb.position.set(sign * 0.03, -0.03, 0.01);
  }

  private buildLeg(side: "left" | "right", pelvis: Object3D): void {
    const sign = side === "left" ? 1 : -1;
    const limbId: LimbId = side === "left" ? "leftLeg" : "rightLeg";
    const hip = new Group();
    hip.position.set(sign * (LIMB.hipWidth / 2), -0.03, 0);
    pelvis.add(hip);
    this.register(side === "left" ? "leftHip" : "rightHip", hip);
    this.tagLimb(hip, limbId);
    addMesh(hip, ball(0.056, this.joint));
    addMesh(hip, limb(LIMB.thigh, 0.044, 0.036, this.wood));
    this.addGrab(hip, 0.1, limbId, -LIMB.thigh * 0.45);

    const knee = new Group();
    knee.position.set(0, -LIMB.thigh, 0);
    hip.add(knee);
    this.register(side === "left" ? "leftKnee" : "rightKnee", knee);
    this.tagLimb(knee, limbId);
    addMesh(knee, ball(0.048, this.joint));
    addMesh(knee, limb(LIMB.shin, 0.034, 0.028, this.wood));
    this.addGrab(knee, 0.09, limbId, -LIMB.shin * 0.45);

    const heel = new Group();
    heel.position.set(0, -LIMB.shin, 0);
    knee.add(heel);
    this.register(side === "left" ? "leftHeel" : "rightHeel", heel);
    this.tagLimb(heel, limbId);
    addMesh(heel, ball(0.034, this.joint));
    this.addGrab(heel, 0.08, limbId);

    const foot = addMesh(
      heel,
      new Mesh(new BoxGeometry(0.07, 0.045, LIMB.footLen), this.darkWood),
    );
    foot.position.set(0, -LIMB.footLift + 0.012, LIMB.footLen * 0.28);

    const toe = new Group();
    toe.position.set(0, -0.028, LIMB.footLen * 0.62);
    heel.add(toe);
    this.register(side === "left" ? "leftToe" : "rightToe", toe);
    this.tagLimb(toe, limbId);
    this.addGrab(toe, 0.08, limbId);
    addMesh(toe, ball(0.02, this.joint));
    const toePad = addMesh(
      toe,
      new Mesh(new BoxGeometry(0.068, 0.03, LIMB.toeLen), this.darkWood),
    );
    toePad.position.set(0, -0.01, LIMB.toeLen * 0.35);

    const toeEnd = new Group();
    toeEnd.position.set(0, -0.012, LIMB.toeLen);
    toe.add(toeEnd);
    this.register(side === "left" ? "leftToeEnd" : "rightToeEnd", toeEnd);
  }
}
