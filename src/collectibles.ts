import {
  Box3,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from "three";
import type { MeshPhysicalMaterial } from "three";
import type { SandFloor } from "./sandFloor";
import { createWoodMaterial } from "./wood";

/**
 * Level-1 wooden toys. Walk into one, or tap the sand beside it, to pick it up.
 * Five of them open the lawn.
 */
const SPOTS: { x: number; z: number; kind: ToyKind }[] = [
  { x: -1.15, z: 2.0, kind: "top" },
  { x: -2.25, z: 1.45, kind: "block" },
  { x: 1.1, z: 1.25, kind: "ball" },
  { x: -2.1, z: 0.15, kind: "ring" },
  { x: 1.2, z: -0.75, kind: "peg" },
];

type ToyKind = "top" | "block" | "ball" | "ring" | "peg";

interface Toy {
  group: Group;
  x: number;
  z: number;
  restY: number;
  phase: number;
  state: "idle" | "pop" | "gone";
  pop: number;
}

export class ToyShelf {
  readonly group = new Group();
  readonly total: number;
  collected = 0;
  private readonly toys: Toy[] = [];

  constructor(sand: SandFloor) {
    const wood = createWoodMaterial({ kind: "walnut", seed: 21, size: 128, repeatX: 1, repeatY: 1.4 });
    this.group.name = "level-1-toys";
    this.total = SPOTS.length;
    SPOTS.forEach((spot, index) => {
      const group = buildToy(spot.kind, wood);
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = index * 0.7;
      this.group.add(group);
      group.updateWorldMatrix(true, true);
      const bounds = new Box3().setFromObject(group);
      const restY = sand.heightAt(spot.x, spot.z) - bounds.min.y + 0.012;
      group.position.y = restY;
      this.toys.push({
        group,
        x: spot.x,
        z: spot.z,
        restY,
        phase: index * 1.3,
        state: "idle",
        pop: 0,
      });
    });
  }

  get remaining(): number {
    return this.total - this.collected;
  }

  label(): string {
    if (this.remaining <= 0) return "Level 2";
    if (this.collected === 0) return `${this.total} left`;
    return `Collected ${this.collected}/${this.total}`;
  }

  update(dt: number, time: number): void {
    for (const toy of this.toys) {
      if (toy.state === "gone") continue;
      if (toy.state === "pop") {
        toy.pop += dt;
        const t = Math.min(1, toy.pop / 0.32);
        toy.group.position.y = toy.restY + t * 0.42;
        const scale = Math.max(0, 1 - t);
        toy.group.scale.setScalar(scale);
        if (t >= 1) {
          toy.state = "gone";
          toy.group.visible = false;
        }
        continue;
      }
      toy.group.position.y = toy.restY + Math.sin(time * 2.1 + toy.phase) * 0.028;
      toy.group.rotation.y += dt * 0.35;
    }
  }

  /** Pick up the nearest idle toy inside `radius`. One toy per call. */
  collectNear(x: number, z: number, radius: number): boolean {
    let best: Toy | null = null;
    let bestD = radius;
    for (const toy of this.toys) {
      if (toy.state !== "idle") continue;
      const d = Math.hypot(toy.x - x, toy.z - z);
      if (d < bestD) {
        best = toy;
        bestD = d;
      }
    }
    if (!best) return false;
    best.state = "pop";
    this.collected += 1;
    return true;
  }
}

function buildToy(kind: ToyKind, wood: MeshPhysicalMaterial): Group {
  const group = new Group();
  group.name = `toy-${kind}`;
  const add = (mesh: Mesh, x = 0, y = 0, z = 0): void => {
    mesh.material = wood;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  if (kind === "top") {
    add(new Mesh(new ConeGeometry(0.11, 0.16, 16)), 0, 0.08, 0);
    add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.08, 8)), 0, 0.18, 0);
  } else if (kind === "block") {
    add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2)), 0, 0.1, 0);
  } else if (kind === "ball") {
    add(new Mesh(new SphereGeometry(0.13, 18, 14)), 0, 0.13, 0);
  } else if (kind === "ring") {
    const ring = new Mesh(new TorusGeometry(0.12, 0.038, 10, 20));
    ring.rotation.x = Math.PI / 2;
    add(ring, 0, 0.05, 0);
  } else {
    add(new Mesh(new CylinderGeometry(0.07, 0.09, 0.16, 12)), 0, 0.08, 0);
    add(new Mesh(new SphereGeometry(0.07, 14, 12)), 0, 0.2, 0);
  }
  return group;
}
