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
import type { SandFloor } from "./sandFloor";

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
  | "leftHand"
  | "lamp";

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
  | "jetpack"
  | "lantern";

export const LANTERN_COST = 15;

export const SELL_PRICE: Record<Exclude<WearId, "lantern">, number> = {
  beret: 4,
  sunglasses: 5,
  shoes: 6,
  shirt: 7,
  pants: 7,
  belt: 5,
  socks: 3,
  sword: 10,
  shield: 9,
  jetpack: 16,
};

const BOB = 0.014;

/** In the opening camera. Spaced so a step collects one piece, not two. */
const SPOTS: Record<WearId, { x: number; z: number }> = {
  jetpack: { x: -1.65, z: 1.95 },
  sword: { x: 0.25, z: 1.85 },
  sunglasses: { x: 1.3, z: 1.05 },
  beret: { x: -2.5, z: 1.15 },
  shoes: { x: -0.75, z: 1.05 },
  shirt: { x: -1.85, z: 0.2 },
  shield: { x: 1.6, z: 0.05 },
  pants: { x: -2.2, z: -0.85 },
  belt: { x: 0.85, z: -0.75 },
  socks: { x: -0.7, z: -0.95 },
  lantern: { x: 0, z: 0 },
};

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
  /** How far the resting mesh sits above the sand. */
  lift: number;
  shopOnly?: boolean;
}

const SPECS: WearSpec[] = [
  {
    id: "beret",
    slot: "head",
    title: "beret",
    found: "Found a beret",
    lawn: new Vector3(SPOTS.beret.x, 0.07, SPOTS.beret.z),
    bone: "head",
    wearPos: new Vector3(0.006, 0.168, 0.012),
    wearRot: new Vector3(-0.28, 0.18, -0.12),
    drop: new Vector3(0.45, 0, 0),
    lift: 0.07,
  },
  {
    id: "sunglasses",
    slot: "face",
    title: "sunglasses",
    found: "Found sunglasses",
    lawn: new Vector3(SPOTS.sunglasses.x, 0.048, SPOTS.sunglasses.z),
    bone: "head",
    wearPos: new Vector3(0, 0.058, 0.1),
    wearRot: new Vector3(0.02, 0, 0),
    drop: new Vector3(-0.45, 0, 0),
    lift: 0.05,
  },
  {
    id: "shoes",
    slot: "feet",
    title: "shoes",
    found: "Found a pair of shoes",
    lawn: new Vector3(SPOTS.shoes.x, 0.072, SPOTS.shoes.z),
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
    lift: 0.08,
  },
  {
    id: "shirt",
    slot: "torso",
    title: "shirt",
    found: "Found a shirt",
    lawn: new Vector3(SPOTS.shirt.x, 0.08, SPOTS.shirt.z),
    bone: "chest",
    wearPos: new Vector3(0, 0.13, 0.012),
    wearRot: new Vector3(0, 0, 0),
    drop: new Vector3(0.55, 0, 0.25),
    lift: 0.08,
  },
  {
    id: "pants",
    slot: "legs",
    title: "pants",
    found: "Found pants",
    lawn: new Vector3(SPOTS.pants.x, 0.1, SPOTS.pants.z),
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
    lift: 0.1,
  },
  {
    id: "belt",
    slot: "waist",
    title: "belt",
    found: "Found a belt",
    lawn: new Vector3(SPOTS.belt.x, 0.04, SPOTS.belt.z),
    bone: "pelvis",
    wearPos: new Vector3(0, 0.03, 0),
    wearRot: new Vector3(Math.PI / 2, 0, 0),
    drop: new Vector3(0.5, 0, -0.35),
    lift: 0.05,
  },
  {
    id: "socks",
    slot: "socks",
    title: "socks",
    found: "Found socks",
    lawn: new Vector3(SPOTS.socks.x, 0.06, SPOTS.socks.z),
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
    lift: 0.06,
  },
  {
    id: "sword",
    slot: "rightHand",
    title: "knife",
    found: "Found a knife",
    lawn: new Vector3(SPOTS.sword.x, 0.04, SPOTS.sword.z),
    bone: "rightHand",
    wearPos: new Vector3(0, -0.16, 0.01),
    wearRot: new Vector3(0.15, 0, 0.2),
    drop: new Vector3(0.65, 0, 0.45),
    lift: 0.05,
  },
  {
    id: "shield",
    slot: "leftHand",
    title: "shield",
    found: "Found a shield",
    lawn: new Vector3(SPOTS.shield.x, 0.08, SPOTS.shield.z),
    bone: "leftHand",
    wearPos: new Vector3(-0.06, -0.04, 0.04),
    wearRot: new Vector3(0, 1.15, 0.2),
    drop: new Vector3(-0.65, 0, 0.45),
    lift: 0.08,
  },
  {
    id: "jetpack",
    slot: "back",
    title: "jetpack",
    found: "Found a jetpack — tap the glowing window to fly through",
    lawn: new Vector3(SPOTS.jetpack.x, 0.14, SPOTS.jetpack.z),
    bone: "chest",
    wearPos: new Vector3(0, 0.36, -0.32),
    wearRot: new Vector3(0, 0, 0),
    drop: new Vector3(0, 0, -0.55),
    lift: 0.14,
  },
  {
    id: "lantern",
    slot: "lamp",
    title: "brass lantern",
    found: "The brass lantern is yours. Walk to the sealed stone doors at the far end of the hall.",
    lawn: new Vector3(0, 0, 0),
    bone: "chest",
    wearPos: new Vector3(0.18, 0.02, 0.14),
    wearRot: new Vector3(0.15, 0, 0.2),
    drop: new Vector3(0.4, 0, 0.2),
    lift: 0,
    shopOnly: true,
  },
];

/**
 * Level-1 wardrobe. The meshes are the original wearable set (beret through
 * jetpack). Walking into a piece, or tapping the sand beside it, equips it
 * on the mannequin. The fur hat stays until the beret is collected.
 */
export class GearShelf {
  readonly group = new Group();
  readonly total: number;
  collected = 0;
  private readonly figure: WoodenMannequin;
  private readonly items: WearItem[];
  private ground: Object3D;
  private readonly scratch = new Vector3();

  constructor(sand: SandFloor, figure: WoodenMannequin) {
    this.figure = figure;
    this.group.name = "level-1-gear";
    this.ground = this.group;
    this.items = SPECS.map((spec) => new WearItem(spec));
    this.total = this.items.filter((item) => !item.spec.shopOnly).length;
    for (const item of this.items) {
      if (item.spec.shopOnly) continue;
      const y = sand.heightAt(item.lawn.x, item.lawn.z) + item.spec.lift;
      item.lawn.y = y;
      item.root.position.copy(item.lawn);
      this.group.add(item.root);
    }
  }

  get remaining(): number {
    return this.total - this.collected;
  }

  /** Finds still on the sand. The window, not this count, is level 2. */
  label(): string {
    if (this.remaining <= 0) return "Fly the window";
    if (this.collected === 0) return `${this.total} finds`;
    return `${this.remaining} finds left`;
  }

  allWorn(): boolean {
    const lawn = this.items.filter((item) => !item.spec.shopOnly);
    return lawn.length > 0 && lawn.every((item) => item.worn);
  }

  wearing(id: WearId): boolean {
    return this.isWorn(id);
  }

  isWorn(id: WearId): boolean {
    return this.items.some((item) => item.spec.id === id && item.worn);
  }

  setGround(ground: Object3D): void {
    this.ground = ground;
  }

  setThrust(on: boolean, time: number): void {
    const pack = this.items.find((item) => item.spec.id === "jetpack");
    pack?.setThrust(on, time);
  }

  update(time: number): void {
    for (const item of this.items) item.bob(time);
  }

  /** Equip the nearest loose piece inside `radius`. One piece per call. */
  collectNear(x: number, z: number, radius: number): string | null {
    let best: WearItem | null = null;
    let bestD = radius;
    for (const item of this.items) {
      if (item.worn || item.spec.shopOnly) continue;
      const d = Math.hypot(item.lawn.x - x, item.lawn.z - z);
      if (d < bestD) {
        best = item;
        bestD = d;
      }
    }
    if (!best) return null;
    return this.wear(best);
  }

  forceWear(id: WearId): string | null {
    const item = this.items.find((entry) => entry.spec.id === id);
    if (!item || item.worn) return null;
    return this.wear(item);
  }

  walkTarget(id: WearId, out: Vector3): Vector3 {
    const item = this.items.find((entry) => entry.spec.id === id);
    if (!item || item.worn) return out;
    return out.copy(item.lawn);
  }

  hit(raycaster: Raycaster): { id: WearId; title: string; worn: boolean } | null {
    const meshes = this.items.flatMap((item) => item.pickMeshes);
    const first = raycaster.intersectObjects(meshes, false)[0];
    if (!first) return null;
    const item = this.items.find((entry) => entry.owns(first.object));
    if (!item) return null;
    return { id: item.spec.id, title: item.spec.title, worn: item.worn };
  }

  takeOff(id: WearId): string | null {
    const item = this.items.find((entry) => entry.spec.id === id && entry.worn);
    if (!item) return null;
    this.figure.root.getWorldPosition(this.scratch);
    item.drop(this.ground, this.scratch, this.figure.bone("root").rotation.y);
    if (!item.spec.shopOnly) this.collected = Math.max(0, this.collected - 1);
    return `Took off the ${item.spec.title}`;
  }

  wornGoods(): { id: Exclude<WearId, "lantern">; title: string; price: number }[] {
    return this.items
      .filter((item) => item.worn && item.spec.id !== "lantern")
      .map((item) => ({
        id: item.spec.id as Exclude<WearId, "lantern">,
        title: item.spec.title,
        price: SELL_PRICE[item.spec.id as Exclude<WearId, "lantern">],
      }));
  }

  sell(id: WearId): number | null {
    if (id === "lantern") return null;
    const item = this.items.find((entry) => entry.spec.id === id && entry.worn);
    if (!item) return null;
    item.discard();
    this.collected = Math.max(0, this.collected - 1);
    return SELL_PRICE[id];
  }

  buyLantern(): string | null {
    const item = this.items.find((entry) => entry.spec.id === "lantern");
    if (!item || item.worn) return null;
    return this.wear(item);
  }

  private wear(item: WearItem): string {
    item.attach(this.figure);
    if (!item.spec.shopOnly) this.collected += 1;
    return item.spec.found;
  }
}

class WearItem {
  readonly spec: WearSpec;
  readonly root: Group;
  readonly pickMeshes: Mesh[] = [];
  readonly lawn: Vector3;
  worn = false;
  gone = false;
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

  owns(object: Object3D): boolean {
    return this.pickMeshes.includes(object as Mesh);
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
      this.lawn.y,
      figurePos.z + Math.sin(yaw) * side + Math.cos(yaw) * forward,
    );
    this.root.position.copy(this.lawn);
    this.root.rotation.set(0, yaw, 0);
    ground.add(this.root);
    this.worn = false;
  }

  discard(): void {
    if (this.spec.pair && this.leftPart && this.rightPart) {
      this.leftPart.removeFromParent();
      this.rightPart.removeFromParent();
    } else {
      this.root.removeFromParent();
    }
    for (const flame of this.flames) flame.visible = false;
    this.glint.visible = false;
    this.worn = false;
    this.gone = true;
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
  if (id === "lantern") return { root: buildLantern(), flames: [] };
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
  add(group, new Mesh(new BoxGeometry(0.022, 0.09, 0.02), grip)).position.y = 0.03;
  add(group, new Mesh(new BoxGeometry(0.055, 0.014, 0.022), steel)).position.y = 0.078;
  const blade = add(group, new Mesh(new BoxGeometry(0.038, 0.2, 0.006), steel));
  blade.position.set(0.006, -0.05, 0);
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

function buildLantern(): Group {
  const group = new Group();
  const brass = mat("#c4a056", { metalness: 0.72, roughness: 0.28 });
  add(group, new Mesh(new CylinderGeometry(0.028, 0.032, 0.04, 12), brass)).position.y = -0.08;
  add(group, new Mesh(new CylinderGeometry(0.034, 0.03, 0.03, 12), brass)).position.y = 0.06;
  const glass = add(
    group,
    new Mesh(
      new CylinderGeometry(0.03, 0.03, 0.09, 12),
      mat("#f4e0a8", {
        roughness: 0.12,
        transparent: true,
        opacity: 0.55,
        emissive: "#ffb45a",
        emissiveIntensity: 0.8,
      }),
    ),
  );
  glass.position.y = -0.01;
  const flame = add(group, new Mesh(new SphereGeometry(0.016, 10, 8), new MeshBasicMaterial({ color: "#ffd080" })));
  flame.position.y = -0.01;
  const bail = add(group, new Mesh(new TorusGeometry(0.028, 0.004, 8, 16, Math.PI), brass));
  bail.rotation.x = Math.PI;
  bail.position.y = 0.09;
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
