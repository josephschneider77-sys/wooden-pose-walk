import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { Object3D, Raycaster, Scene } from "three";
import type { WoodenMannequin } from "./mannequin";

export type WearSlot = "head" | "face" | "feet";
export type WearId = "beret" | "sunglasses" | "shoes";

const COLLECT_RANGE = 0.62;
const BOB = 0.014;

interface WearSpec {
  id: WearId;
  slot: WearSlot;
  title: string;
  found: string;
  lawn: Vector3;
  wearPos: Vector3;
  wearRot: Vector3;
}

const SPECS: WearSpec[] = [
  {
    id: "beret",
    slot: "head",
    title: "beret",
    found: "Found a beret",
    lawn: new Vector3(1.35, 0.07, 1.5),
    wearPos: new Vector3(0.006, 0.168, 0.012),
    wearRot: new Vector3(-0.28, 0.18, -0.12),
  },
  {
    id: "sunglasses",
    slot: "face",
    title: "sunglasses",
    found: "Found sunglasses",
    lawn: new Vector3(-1.25, 0.048, 1.7),
    wearPos: new Vector3(0, 0.058, 0.1),
    wearRot: new Vector3(0.02, 0, 0),
  },
  {
    id: "shoes",
    slot: "feet",
    title: "shoes",
    found: "Found a pair of shoes",
    lawn: new Vector3(0.2, 0.072, 2.35),
    wearPos: new Vector3(0, 0, 0),
    wearRot: new Vector3(0, 0, 0),
  },
];

const SHOE_LAWN_LEFT = new Vector3(-0.09, 0, 0);
const SHOE_LAWN_RIGHT = new Vector3(0.09, 0, 0);
const SHOE_WEAR = new Vector3(0, 0, 0);

export interface WearHit {
  id: WearId;
  title: string;
  worn: boolean;
}

/**
 * Lawn pickups that snap onto the head. One item per slot;
 * picking a second drops the first back on the grass.
 */
export class LawnWardrobe {
  private readonly figure: WoodenMannequin;
  private readonly scene: Scene;
  private readonly items: WearItem[];
  private readonly scratch = new Vector3();

  constructor(scene: Scene, figure: WoodenMannequin) {
    this.scene = scene;
    this.figure = figure;
    this.items = SPECS.map((spec) => new WearItem(spec));
    for (const item of this.items) scene.add(item.root);
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

  takeOff(id: WearId): string | null {
    const item = this.items.find((entry) => entry.spec.id === id && entry.worn);
    if (!item) return null;
    this.figure.root.getWorldPosition(this.scratch);
    item.drop(this.scene, this.scratch, this.figure.bone("root").rotation.y);
    return `Took off the ${item.spec.title}`;
  }

  private wear(item: WearItem): string {
    const occupant = this.items.find(
      (entry) => entry.worn && entry.spec.slot === item.spec.slot && entry !== item,
    );
    if (occupant) {
      this.figure.root.getWorldPosition(this.scratch);
      occupant.drop(this.scene, this.scratch, this.figure.bone("root").rotation.y);
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
  private readonly leftShoe: Group | null = null;
  private readonly rightShoe: Group | null = null;

  constructor(spec: WearSpec) {
    this.spec = spec;
    this.lawn = spec.lawn.clone();
    if (spec.id === "beret") this.root = buildBeret();
    else if (spec.id === "sunglasses") this.root = buildSunglasses();
    else {
      this.root = new Group();
      this.leftShoe = buildShoe(1);
      this.rightShoe = buildShoe(-1);
      this.leftShoe.position.copy(SHOE_LAWN_LEFT);
      this.rightShoe.position.copy(SHOE_LAWN_RIGHT);
      this.root.add(this.leftShoe, this.rightShoe);
    }
    this.root.name = spec.id;
    this.root.position.copy(this.lawn);
    this.root.traverse((object) => {
      if ((object as Mesh).isMesh && object !== this.root) {
        this.pickMeshes.push(object as Mesh);
      }
    });
    this.glint = new Mesh(
      new SphereGeometry(0.018, 10, 8),
      new MeshBasicMaterial({ color: "#f0d48a" }),
    );
    this.glint.position.set(0.02, spec.id === "shoes" ? 0.1 : 0.08, 0.03);
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
    const pulse = 0.7 + Math.sin(time * 5) * 0.3;
    this.glint.scale.setScalar(pulse);
  }

  attach(figure: WoodenMannequin): void {
    this.glint.visible = false;
    if (this.leftShoe && this.rightShoe) {
      this.root.removeFromParent();
      this.leftShoe.removeFromParent();
      this.rightShoe.removeFromParent();
      this.leftShoe.position.copy(SHOE_WEAR);
      this.rightShoe.position.copy(SHOE_WEAR);
      this.leftShoe.rotation.set(0, 0, 0);
      this.rightShoe.rotation.set(0, 0, 0);
      figure.bone("leftHeel").add(this.leftShoe);
      figure.bone("rightHeel").add(this.rightShoe);
      this.worn = true;
      return;
    }
    this.root.removeFromParent();
    this.root.position.copy(this.spec.wearPos);
    this.root.rotation.set(this.spec.wearRot.x, this.spec.wearRot.y, this.spec.wearRot.z);
    figure.bone("head").add(this.root);
    this.worn = true;
  }

  drop(scene: Scene, figurePos: Vector3, yaw: number): void {
    if (this.leftShoe && this.rightShoe) {
      this.leftShoe.removeFromParent();
      this.rightShoe.removeFromParent();
      this.leftShoe.position.copy(SHOE_LAWN_LEFT);
      this.rightShoe.position.copy(SHOE_LAWN_RIGHT);
      this.leftShoe.rotation.set(0, 0, 0);
      this.rightShoe.rotation.set(0, 0, 0);
      this.root.add(this.leftShoe, this.rightShoe);
    } else {
      this.root.removeFromParent();
    }
    const along = this.spec.id === "shoes" ? 0.55 : this.spec.id === "beret" ? 0.42 : -0.42;
    const side = this.spec.id === "shoes" ? 0 : along;
    const forward = this.spec.id === "shoes" ? along : 0;
    this.lawn.set(
      figurePos.x + Math.cos(yaw) * side + Math.sin(yaw) * forward,
      this.spec.lawn.y,
      figurePos.z + Math.sin(yaw) * side + Math.cos(yaw) * forward,
    );
    this.root.position.copy(this.lawn);
    this.root.rotation.set(0, yaw, 0);
    scene.add(this.root);
    this.worn = false;
  }
}

function felt(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: "#5c1a24",
    roughness: 0.94,
    metalness: 0,
    sheen: 0.46,
    sheenColor: "#8d3344",
    sheenRoughness: 0.7,
  });
}

function framePlastic(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: "#141414",
    roughness: 0.32,
    metalness: 0.12,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
  });
}

function lensGlass(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: "#1b2416",
    roughness: 0.08,
    metalness: 0.35,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.1,
  });
}

function add(parent: Group, mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildBeret(): Group {
  const group = new Group();
  const cloth = felt();
  const crown = add(group, new Mesh(new SphereGeometry(0.11, 28, 18), cloth));
  crown.scale.set(1.28, 0.46, 1.28);
  crown.position.y = 0.016;
  const band = add(group, new Mesh(new CylinderGeometry(0.088, 0.094, 0.02, 28), cloth));
  band.position.y = -0.008;
  const stem = add(group, new Mesh(new SphereGeometry(0.014, 10, 8), cloth));
  stem.position.set(0.012, 0.058, 0.008);
  return group;
}

function buildSunglasses(): Group {
  const group = new Group();
  const frame = framePlastic();
  const glass = lensGlass();
  const rim = (x: number) => {
    const ring = add(group, new Mesh(new TorusGeometry(0.028, 0.0045, 10, 22), frame));
    ring.position.set(x, 0, 0);
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

function leather(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: "#3d2418",
    roughness: 0.58,
    metalness: 0.05,
    sheen: 0.22,
    sheenColor: "#6b4030",
    sheenRoughness: 0.55,
  });
}

function soleRubber(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: "#1a1410",
    roughness: 0.88,
    metalness: 0,
  });
}

function buildShoe(sign: number): Group {
  const group = new Group();
  const hide = leather();
  const sole = soleRubber();
  const bottom = add(group, new Mesh(new BoxGeometry(0.086, 0.014, 0.228), sole));
  bottom.position.set(0, -0.061, 0.072);
  const heel = add(group, new Mesh(new BoxGeometry(0.082, 0.022, 0.058), sole));
  heel.position.set(0, -0.068, -0.012);
  const vamp = add(group, new Mesh(new BoxGeometry(0.08, 0.048, 0.132), hide));
  vamp.position.set(0, -0.03, 0.078);
  const toe = add(group, new Mesh(new SphereGeometry(0.038, 16, 12), hide));
  toe.scale.set(1.08, 0.68, 1.15);
  toe.position.set(0, -0.032, 0.168);
  const collar = add(group, new Mesh(new CylinderGeometry(0.03, 0.034, 0.036, 16), hide));
  collar.position.set(0, -0.002, 0.012);
  const lace = add(group, new Mesh(new BoxGeometry(0.012, 0.006, 0.05), sole));
  lace.position.set(sign * 0.002, -0.006, 0.07);
  return group;
}
