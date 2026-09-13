import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { Object3D, Raycaster } from "three";
import type { BoneName, WoodenMannequin } from "./mannequin";

export type WearSlot =
  | "head"
  | "face"
  | "torso"
  | "waist"
  | "legs"
  | "socks"
  | "feet"
  | "back"
  | "rightHand"
  | "leftHand";

export type WearId =
  | "beret"
  | "sunglasses"
  | "shoes"
  | "shirt"
  | "pants"
  | "belt"
  | "socks"
  | "sword"
  | "shield"
  | "jetpack";

const COLLECT_RANGE = 0.85;
const BOB = 0.014;

interface PairBind {
  left: BoneName;
  right: BoneName;
  lawnL: Vector3;
  lawnR: Vector3;
  wear: Vector3;
}

interface WearSpec {
  id: WearId;
  slot: WearSlot;
  title: string;
  found: string;
  lawn: Vector3;
  bone: BoneName;
  wearPos: Vector3;
  wearRot: Vector3;
  pair?: PairBind;
  drop: Vector3;
}

const SPECS: WearSpec[] = [
  {
    id: "beret",
    slot: "head",
    title: "beret",
    found: "Found a beret",
    lawn: new Vector3(1.35, 0.07, 1.5),
    bone: "head",
    wearPos: new Vector3(0.006, 0.168, 0.012),
    wearRot: new Vector3(-0.28, 0.18, -0.12),
    drop: new Vector3(0.45, 0, 0),
  },
  {
    id: "sunglasses",
    slot: "face",
    title: "sunglasses",
    found: "Found sunglasses",
    lawn: new Vector3(-1.25, 0.048, 1.7),
    bone: "head",
    wearPos: new Vector3(0, 0.058, 0.1),
    wearRot: new Vector3(0.02, 0, 0),
    drop: new Vector3(-0.45, 0, 0),
  },
  {
    id: "shoes",
    slot: "feet",
    title: "shoes",
    found: "Found a pair of shoes",
    lawn: new Vector3(0.2, 0.072, 2.35),
    bone: "leftHeel",
    wearPos: new Vector3(0, 0, 0),
    wearRot: new Vector3(0, 0, 0),
    pair: {
      left: "leftHeel",
      right: "rightHeel",
      lawnL: new Vector3(-0.09, 0, 0),
      lawnR: new Vector3(0.09, 0, 0),
      wear: new Vector3(0, 0, 0),
    },
    drop: new Vector3(0, 0, 0.55),
  },
  {
    id: "shirt",
    slot: "torso",
    title: "shirt",
    found: "Found a shirt",
    lawn: new Vector3(2.15, 0.08, 0.35),
    bone: "chest",
    wearPos: new Vector3(0, 0.13, 0.012),
    wearRot: new Vector3(0, 0, 0),
    drop: new Vector3(0.55, 0, 0.25),
  },
  {
    id: "pants",
    slot: "legs",
    title: "pants",
    found: "Found pants",
    lawn: new Vector3(-2.1, 0.1, 0.45),
    bone: "leftHip",
    wearPos: new Vector3(0, 0, 0),
    wearRot: new Vector3(0, 0, 0),
    pair: {
      left: "leftHip",
      right: "rightHip",
      lawnL: new Vector3(-0.08, 0, 0),
      lawnR: new Vector3(0.08, 0, 0),
      wear: new Vector3(0, -0.2, 0.01),
    },
    drop: new Vector3(-0.55, 0, 0.2),
  },
  {
    id: "belt",
    slot: "waist",
    title: "belt",
    found: "Found a belt",
    lawn: new Vector3(1.7, 0.04, -1.15),
    bone: "pelvis",
    wearPos: new Vector3(0, 0.03, 0),
    wearRot: new Vector3(Math.PI / 2, 0, 0),
    drop: new Vector3(0.5, 0, -0.35),
  },
  {
    id: "socks",
    slot: "socks",
    title: "socks",
    found: "Found socks",
    lawn: new Vector3(-1.65, 0.06, -1.25),
    bone: "leftKnee",
    wearPos: new Vector3(0, 0, 0),
    wearRot: new Vector3(0, 0, 0),
    pair: {
      left: "leftKnee",
      right: "rightKnee",
      lawnL: new Vector3(-0.07, 0, 0),
      lawnR: new Vector3(0.07, 0, 0),
      wear: new Vector3(0, -0.16, 0),
    },
    drop: new Vector3(-0.5, 0, -0.35),
  },
  {
    id: "sword",
    slot: "rightHand",
    title: "sword",
    found: "Found a sword",
    lawn: new Vector3(2.35, 0.04, 1.85),
    bone: "rightHand",
    wearPos: new Vector3(0, -0.16, 0.01),
    wearRot: new Vector3(0.15, 0, 0.2),
    drop: new Vector3(0.65, 0, 0.45),
  },
  {
    id: "shield",
    slot: "leftHand",
    title: "shield",
    found: "Found a shield",
    lawn: new Vector3(-2.25, 0.08, 1.8),
    bone: "leftHand",
    wearPos: new Vector3(-0.06, -0.04, 0.04),
    wearRot: new Vector3(0, 1.15, 0.2),
    drop: new Vector3(-0.65, 0, 0.45),
  },
  {
    id: "jetpack",
    slot: "back",
    title: "jetpack",
    found: "Found a jetpack — double-tap grass to fly, or tap the glowing window",
    lawn: new Vector3(-3.55, 0.14, 1.15),
    bone: "chest",
    wearPos: new Vector3(0, 0.22, -0.3),
    wearRot: new Vector3(0, 0, 0),
    drop: new Vector3(0, 0, -0.55),
  },
];

export interface WearHit {
  id: WearId;
  title: string;
  worn: boolean;
}

export class LawnWardrobe {
  private readonly figure: WoodenMannequin;
  private readonly ground: Object3D;
  private readonly items: WearItem[];
  private readonly scratch = new Vector3();

  constructor(ground: Object3D, figure: WoodenMannequin) {
    this.ground = ground;
    this.figure = figure;
    this.items = SPECS.map((spec) => new WearItem(spec));
    for (const item of this.items) ground.add(item.root);
  }

  isWorn(id: WearId): boolean {
    return this.items.some((item) => item.spec.id === id && item.worn);
  }

  allWorn(): boolean {
    return this.items.length > 0 && this.items.every((item) => item.worn);
  }

  setThrust(on: boolean, time: number): void {
    const pack = this.items.find((item) => item.spec.id === "jetpack");
    pack?.setThrust(on, time);
  }

  update(time: number): string | null {
    this.figure.root.getWorldPosition(this.scratch);
    let found: string | null = null;
    for (const item of this.items) {
      item.bob(time);
      if (item.worn) continue;
      const dx = item.root.position.x - this.scratch.x;
      const dz = item.root.position.z - this.scratch.z;
      if (dx * dx + dz * dz < COLLECT_RANGE * COLLECT_RANGE) {
        found = this.wear(item) ?? found;
      }
    }
    return found;
  }

  hit(raycaster: Raycaster): WearHit | null {
    const meshes = this.items.flatMap((item) => item.pickMeshes);
    const first = raycaster.intersectObjects(meshes, false)[0];
    if (!first) return null;
    const item = this.items.find((entry) => entry.owns(first.object));
    if (!item) return null;
    return { id: item.spec.id, title: item.spec.title, worn: item.worn };
  }

  walkTarget(id: WearId, out: Vector3): Vector3 {
    const item = this.items.find((entry) => entry.spec.id === id);
    if (!item || item.worn) return out;
    return out.copy(item.lawn);
  }

  forceWear(id: WearId): string | null {
    const item = this.items.find((entry) => entry.spec.id === id);
    if (!item || item.worn) return null;
    return this.wear(item);
  }

  takeOff(id: WearId): string | null {
    const item = this.items.find((entry) => entry.spec.id === id && entry.worn);
    if (!item) return null;
    this.figure.root.getWorldPosition(this.scratch);
    item.drop(this.ground, this.scratch, this.figure.bone("root").rotation.y);
    return `Took off the ${item.spec.title}`;
  }

  private wear(item: WearItem): string {
    const occupant = this.items.find(
      (entry) => entry.worn && entry.spec.slot === item.spec.slot && entry !== item,
    );
    if (occupant) {
      this.figure.root.getWorldPosition(this.scratch);
      occupant.drop(this.ground, this.scratch, this.figure.bone("root").rotation.y);
    }
    item.attach(this.figure);
    return item.spec.found;
  }
}

class WearItem {
  readonly spec: WearSpec;
  readonly root: Group;
  readonly pickMeshes: Mesh[] = [];
  readonly lawn: Vector3;
  worn = false;
  private readonly glint: Mesh;
  private readonly leftPart: Group | null = null;
  private readonly rightPart: Group | null = null;
  private readonly flames: Mesh[] = [];

  constructor(spec: WearSpec) {
    this.spec = spec;
    this.lawn = spec.lawn.clone();
    const built = buildWearable(spec.id);
    this.root = built.root;
    this.leftPart = built.left ?? null;
    this.rightPart = built.right ?? null;
    this.flames.push(...built.flames);
    if (spec.pair && this.leftPart && this.rightPart) {
      this.leftPart.position.copy(spec.pair.lawnL);
      this.rightPart.position.copy(spec.pair.lawnR);
      this.root.add(this.leftPart, this.rightPart);
    }
    this.root.name = spec.id;
    this.root.position.copy(this.lawn);
    this.root.traverse((object) => {
      if ((object as Mesh).isMesh) this.pickMeshes.push(object as Mesh);
    });
    const jet = spec.id === "jetpack";
    this.glint = new Mesh(
      new SphereGeometry(jet ? 0.055 : 0.036, 12, 10),
      new MeshBasicMaterial({ color: jet ? "#ffe08a" : "#f4d592" }),
    );
    this.glint.position.set(0, jet ? 0.32 : 0.2, 0);
    this.root.add(this.glint);
    this.pickMeshes.push(this.glint);
  }

  owns(object: Object3D): boolean {
    return this.pickMeshes.includes(object as Mesh);
  }

  bob(time: number): void {
    this.glint.visible = !this.worn;
    if (this.worn) return;
    this.root.position.y = this.lawn.y + Math.sin(time * 2.1 + this.lawn.x) * BOB;
    this.root.rotation.y = Math.sin(time * 0.7) * 0.18;
    this.glint.scale.setScalar(0.7 + Math.sin(time * 5) * 0.3);
  }

  setThrust(on: boolean, time: number): void {
    for (const flame of this.flames) {
      flame.visible = on && this.worn;
      if (on) flame.scale.setScalar(0.85 + Math.sin(time * 28) * 0.35);
    }
  }

  attach(figure: WoodenMannequin): void {
    this.glint.visible = false;
    if (this.spec.pair && this.leftPart && this.rightPart) {
      this.root.removeFromParent();
      this.leftPart.removeFromParent();
      this.rightPart.removeFromParent();
      this.leftPart.position.copy(this.spec.pair.wear);
      this.rightPart.position.copy(this.spec.pair.wear);
      this.leftPart.rotation.set(0, 0, 0);
      this.rightPart.rotation.set(0, 0, 0);
      figure.bone(this.spec.pair.left).add(this.leftPart);
      figure.bone(this.spec.pair.right).add(this.rightPart);
      this.worn = true;
      return;
    }
    this.root.removeFromParent();
    this.root.position.copy(this.spec.wearPos);
    this.root.rotation.set(this.spec.wearRot.x, this.spec.wearRot.y, this.spec.wearRot.z);
    figure.bone(this.spec.bone).add(this.root);
    this.worn = true;
  }

  drop(ground: Object3D, figurePos: Vector3, yaw: number): void {
    if (this.spec.pair && this.leftPart && this.rightPart) {
      this.leftPart.removeFromParent();
      this.rightPart.removeFromParent();
      this.leftPart.position.copy(this.spec.pair.lawnL);
      this.rightPart.position.copy(this.spec.pair.lawnR);
      this.leftPart.rotation.set(0, 0, 0);
      this.rightPart.rotation.set(0, 0, 0);
      this.root.add(this.leftPart, this.rightPart);
    } else {
      this.root.removeFromParent();
    }
    for (const flame of this.flames) flame.visible = false;
    const side = this.spec.drop.x;
    const forward = this.spec.drop.z;
    this.lawn.set(
      figurePos.x + Math.cos(yaw) * side + Math.sin(yaw) * forward,
      this.spec.lawn.y,
      figurePos.z + Math.sin(yaw) * side + Math.cos(yaw) * forward,
    );
    this.root.position.copy(this.lawn);
    this.root.rotation.set(0, yaw, 0);
    ground.add(this.root);
    this.worn = false;
  }
}

interface BuiltWearable {
  root: Group;
  left?: Group;
  right?: Group;
  flames: Mesh[];
}

function buildWearable(id: WearId): BuiltWearable {
  if (id === "beret") return { root: buildBeret(), flames: [] };
  if (id === "sunglasses") return { root: buildSunglasses(), flames: [] };
  if (id === "shoes") return { root: new Group(), left: buildShoe(1), right: buildShoe(-1), flames: [] };
  if (id === "shirt") return { root: buildShirt(), flames: [] };
  if (id === "pants") return { root: new Group(), left: buildPantLeg(), right: buildPantLeg(), flames: [] };
  if (id === "belt") return { root: buildBelt(), flames: [] };
  if (id === "socks") return { root: new Group(), left: buildSock(), right: buildSock(), flames: [] };
  if (id === "sword") return { root: buildSword(), flames: [] };
  if (id === "shield") return { root: buildShield(), flames: [] };
  return buildJetpack();
}

function mat(color: string, extra: ConstructorParameters<typeof MeshPhysicalMaterial>[0] = {}): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color, roughness: 0.7, metalness: 0.04, ...extra });
}

function add(parent: Group, mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function felt(): MeshPhysicalMaterial {
  return mat("#5c1a24", { roughness: 0.94, sheen: 0.46, sheenColor: "#8d3344", sheenRoughness: 0.7 });
}

function leather(): MeshPhysicalMaterial {
  return mat("#3d2418", { roughness: 0.58, sheen: 0.22, sheenColor: "#6b4030" });
}

function buildBeret(): Group {
  const group = new Group();
  const cloth = felt();
  const crown = add(group, new Mesh(new SphereGeometry(0.11, 28, 18), cloth));
  crown.scale.set(1.28, 0.46, 1.28);
  crown.position.y = 0.016;
  add(group, new Mesh(new CylinderGeometry(0.088, 0.094, 0.02, 28), cloth)).position.y = -0.008;
  add(group, new Mesh(new SphereGeometry(0.014, 10, 8), cloth)).position.set(0.012, 0.058, 0.008);
  return group;
}

function buildSunglasses(): Group {
  const group = new Group();
  const frame = mat("#141414", { roughness: 0.32, metalness: 0.12, clearcoat: 0.45 });
  const glass = mat("#1b2416", { roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.78 });
  const rim = (x: number) => {
    add(group, new Mesh(new TorusGeometry(0.028, 0.0045, 10, 22), frame)).position.set(x, 0, 0);
    const lens = add(group, new Mesh(new CylinderGeometry(0.025, 0.025, 0.004, 22), glass));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, 0, 0);
  };
  rim(-0.036);
  rim(0.036);
  const bridge = add(group, new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.02, 8), frame));
  bridge.rotation.z = Math.PI / 2;
  const temple = (x: number) => {
    const arm = add(group, new Mesh(new CylinderGeometry(0.0028, 0.0028, 0.08, 8), frame));
    arm.rotation.x = Math.PI / 2;
    arm.position.set(x, 0.006, -0.038);
  };
  temple(-0.058);
  temple(0.058);
  return group;
}

function buildShoe(sign: number): Group {
  const group = new Group();
  const hide = leather();
  const sole = mat("#1a1410", { roughness: 0.88 });
  add(group, new Mesh(new BoxGeometry(0.086, 0.014, 0.228), sole)).position.set(0, -0.061, 0.072);
  add(group, new Mesh(new BoxGeometry(0.082, 0.022, 0.058), sole)).position.set(0, -0.068, -0.012);
  add(group, new Mesh(new BoxGeometry(0.08, 0.048, 0.132), hide)).position.set(0, -0.03, 0.078);
  const toe = add(group, new Mesh(new SphereGeometry(0.038, 16, 12), hide));
  toe.scale.set(1.08, 0.68, 1.15);
  toe.position.set(0, -0.032, 0.168);
  add(group, new Mesh(new CylinderGeometry(0.03, 0.034, 0.036, 16), hide)).position.set(0, -0.002, 0.012);
  add(group, new Mesh(new BoxGeometry(0.012, 0.006, 0.05), sole)).position.set(sign * 0.002, -0.006, 0.07);
  return group;
}

function buildShirt(): Group {
  const group = new Group();
  const cloth = mat("#3e5c86", { roughness: 0.82, sheen: 0.18, sheenColor: "#8aa4c8" });
  add(group, new Mesh(new BoxGeometry(0.28, 0.3, 0.18), cloth));
  add(group, new Mesh(new BoxGeometry(0.16, 0.08, 0.04), cloth)).position.set(0, 0.14, 0.08);
  return group;
}

function buildPantLeg(): Group {
  const group = new Group();
  const cloth = mat("#2c3340", { roughness: 0.86 });
  add(group, new Mesh(new CylinderGeometry(0.062, 0.05, 0.4, 16), cloth));
  return group;
}

function buildBelt(): Group {
  const group = new Group();
  const hide = leather();
  add(group, new Mesh(new TorusGeometry(0.12, 0.016, 10, 28), hide));
  add(group, new Mesh(new BoxGeometry(0.04, 0.03, 0.012), mat("#c4a056", { metalness: 0.55, roughness: 0.28 }))).position.set(0, 0.12, 0);
  return group;
}

function buildSock(): Group {
  const group = new Group();
  add(group, new Mesh(new CylinderGeometry(0.038, 0.032, 0.22, 14), mat("#d8c9b0", { roughness: 0.9 })));
  return group;
}

function buildSword(): Group {
  const group = new Group();
  const steel = mat("#c5cdd4", { metalness: 0.72, roughness: 0.22, clearcoat: 0.4 });
  const grip = mat("#4a2c1a", { roughness: 0.7 });
  add(group, new Mesh(new BoxGeometry(0.018, 0.08, 0.018), grip)).position.y = 0.02;
  add(group, new Mesh(new BoxGeometry(0.07, 0.012, 0.02), steel)).position.y = 0.06;
  const blade = add(group, new Mesh(new BoxGeometry(0.022, 0.28, 0.008), steel));
  blade.position.y = -0.1;
  return group;
}

function buildShield(): Group {
  const group = new Group();
  const wood = mat("#6b3a22", { roughness: 0.55 });
  const rim = mat("#c4a056", { metalness: 0.5, roughness: 0.3 });
  add(group, new Mesh(new CylinderGeometry(0.11, 0.11, 0.02, 24), wood)).rotation.x = Math.PI / 2;
  add(group, new Mesh(new TorusGeometry(0.11, 0.01, 8, 24), rim)).rotation.x = Math.PI / 2;
  add(group, new Mesh(new SphereGeometry(0.02, 10, 8), rim));
  return group;
}

function paintPack(root: Group): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    const material = mesh.material as MeshPhysicalMaterial | MeshBasicMaterial;
    material.depthWrite = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -8;
    material.polygonOffsetUnits = -8;
  });
}

function buildJetpack(): BuiltWearable {
  const root = new Group();
  const tank = mat("#ee6a1a", { metalness: 0.38, roughness: 0.32 });
  const strap = mat("#2a1c14", { roughness: 0.8 });
  add(root, new Mesh(new CylinderGeometry(0.07, 0.076, 0.34, 16), tank)).position.set(-0.082, 0, 0);
  add(root, new Mesh(new CylinderGeometry(0.07, 0.076, 0.34, 16), tank)).position.set(0.082, 0, 0);
  add(root, new Mesh(new SphereGeometry(0.07, 12, 10), tank)).position.set(-0.082, 0.17, 0);
  add(root, new Mesh(new SphereGeometry(0.07, 12, 10), tank)).position.set(0.082, 0.17, 0);
  add(root, new Mesh(new BoxGeometry(0.24, 0.12, 0.08), tank)).position.set(0, 0.02, 0.03);
  const over = (x: number) => {
    const band = add(root, new Mesh(new CylinderGeometry(0.014, 0.014, 0.34, 8), strap));
    band.position.set(x, 0.08, 0.12);
    band.rotation.x = 1.05;
  };
  over(-0.1);
  over(0.1);
  add(root, new Mesh(new BoxGeometry(0.28, 0.04, 0.05), strap)).position.set(0, 0.14, 0.06);
  const flameMat = new MeshBasicMaterial({ color: "#ff8a2a" });
  const left = new Mesh(new ConeGeometry(0.028, 0.12, 10), flameMat);
  const right = new Mesh(new ConeGeometry(0.028, 0.12, 10), flameMat);
  left.rotation.x = Math.PI;
  right.rotation.x = Math.PI;
  left.position.set(-0.082, -0.22, 0);
  right.position.set(0.082, -0.22, 0);
  left.visible = false;
  right.visible = false;
  root.add(left, right);
  paintPack(root);
  return { root, flames: [left, right] };
}
