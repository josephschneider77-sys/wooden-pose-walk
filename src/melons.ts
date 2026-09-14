import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Raycaster,
} from "three";
import type { LawnWardrobe } from "./wearables";

const CHOP_RANGE = 0.95;

const FLESH = new MeshPhysicalMaterial({
  color: "#e02338",
  roughness: 0.28,
  clearcoat: 0.55,
  clearcoatRoughness: 0.18,
});
const PALE = new MeshPhysicalMaterial({ color: "#f3d6be", roughness: 0.42 });
const SEED = new MeshPhysicalMaterial({ color: "#1a1410", roughness: 0.55 });
const STEM = new MeshPhysicalMaterial({ color: "#4a3218", roughness: 0.8 });
const BOARD = new MeshPhysicalMaterial({ color: "#8b5a32", roughness: 0.62 });
const STEEL = new MeshPhysicalMaterial({
  color: "#c5cdd4",
  metalness: 0.7,
  roughness: 0.22,
  clearcoat: 0.35,
});
const GRIP = new MeshPhysicalMaterial({ color: "#3d2418", roughness: 0.7 });

const SPOTS: [number, number][] = [
  [0.3, 0.2],
  [-0.28, 0.22],
  [0.04, -0.3],
];

const rindMap = stripeTexture("#164a20", "#8ecf4a");
const RIND = new MeshPhysicalMaterial({
  color: "#ffffff",
  map: rindMap,
  roughness: 0.7,
});

export class MelonBoard {
  readonly root = new Group();
  chopped = false;
  private readonly wholes = new Group();
  private readonly pieces = new Group();
  private readonly looseKnife = new Group();
  private readonly picks: Mesh[] = [];

  constructor() {
    this.root.name = "melonBoard";
    this.root.position.set(0.55, 0, 2.45);

    const block = new Mesh(new BoxGeometry(1.55, 0.14, 1.55), BOARD);
    block.position.y = 0.07;
    block.castShadow = true;
    block.receiveShadow = true;
    this.root.add(block);
    this.picks.push(block);

    const lip = new Mesh(new BoxGeometry(1.62, 0.04, 1.62), BOARD);
    lip.position.y = 0.015;
    this.root.add(lip);

    for (const [x, z] of SPOTS) {
      const whole = wholeMelon();
      whole.position.set(x, 0.24, z);
      this.wholes.add(whole);
      whole.traverse((object) => {
        if ((object as Mesh).isMesh) this.picks.push(object as Mesh);
      });

      const pile = choppedPile();
      pile.position.set(x, 0.16, z);
      this.pieces.add(pile);
    }

    this.looseKnife.add(boardKnife());
    this.looseKnife.position.set(0.52, 0.16, -0.48);
    this.looseKnife.rotation.set(0, 0.4, 1.2);
    this.looseKnife.traverse((object) => {
      if ((object as Mesh).isMesh) this.picks.push(object as Mesh);
    });

    this.pieces.visible = false;
    this.root.add(this.wholes, this.pieces, this.looseKnife);
  }

  hit(raycaster: Raycaster): boolean {
    return raycaster.intersectObjects(this.picks, false).length > 0;
  }

  inRange(x: number, z: number): boolean {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    return dx * dx + dz * dz < CHOP_RANGE * CHOP_RANGE;
  }

  showLooseKnife(on: boolean): void {
    this.looseKnife.visible = on && !this.chopped;
  }

  use(wardrobe: LawnWardrobe): string {
    if (this.chopped) return "Watermelons chopped — nice and ready";
    if (!wardrobe.isWorn("sword")) {
      wardrobe.forceWear("sword");
      this.looseKnife.visible = false;
      return "Picked up the knife — tap the melons to chop";
    }
    return this.chop();
  }

  private chop(): string {
    this.chopped = true;
    this.wholes.visible = false;
    this.looseKnife.visible = false;
    this.pieces.visible = true;
    return "Watermelons chopped — nice and ready";
  }
}

function stripeTexture(dark: string, light: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("melon texture");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = light;
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(8 + i * 28, 0, 11, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function wholeMelon(): Group {
  const group = new Group();
  const body = new Mesh(new SphereGeometry(0.2, 28, 20), RIND);
  body.scale.set(1.08, 0.86, 1.08);
  body.castShadow = true;
  group.add(body);
  const stem = new Mesh(new CylinderGeometry(0.014, 0.02, 0.045, 8), STEM);
  stem.position.y = 0.18;
  group.add(stem);
  return group;
}

function choppedPile(): Group {
  const pile = new Group();
  for (let i = 0; i < 6; i++) {
    const slice = wedge();
    const a = (i / 6) * Math.PI * 2;
    slice.position.set(Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12);
    slice.rotation.y = a + 0.35;
    slice.rotation.x = 0.55;
    pile.add(slice);
  }
  for (let i = 0; i < 5; i++) {
    const cube = new Mesh(new BoxGeometry(0.06, 0.045, 0.06), FLESH);
    const a = (i / 5) * Math.PI * 2 + 0.3;
    cube.position.set(Math.cos(a) * 0.035, 0.04, Math.sin(a) * 0.035);
    cube.rotation.y = a;
    cube.castShadow = true;
    pile.add(cube);
  }
  return pile;
}

function wedge(): Group {
  const group = new Group();
  const span = Math.PI * 0.5;
  const rind = new Mesh(new SphereGeometry(0.16, 18, 14, 0, span, 0, Math.PI), RIND);
  const white = new Mesh(new SphereGeometry(0.15, 18, 14, 0, span, 0, Math.PI), PALE);
  const flesh = new Mesh(new SphereGeometry(0.14, 18, 14, 0, span, 0, Math.PI), FLESH);
  rind.scale.set(1, 0.84, 1);
  white.scale.set(1, 0.84, 1);
  flesh.scale.set(1, 0.84, 1);
  rind.castShadow = true;
  group.add(rind, white, flesh);
  const cut = new Mesh(new CircleGeometry(0.14, 20, 0, Math.PI), FLESH);
  cut.scale.set(1, 0.84, 1);
  group.add(cut);
  const cut2 = cut.clone();
  cut2.rotation.y = span;
  group.add(cut2);
  for (let s = 0; s < 4; s++) {
    const seed = new Mesh(new SphereGeometry(0.008, 6, 5), SEED);
    seed.position.set(0.01, 0.04 - s * 0.03, 0.05);
    group.add(seed);
  }
  return group;
}

function boardKnife(): Group {
  const group = new Group();
  const handle = new Mesh(new BoxGeometry(0.03, 0.11, 0.022), GRIP);
  handle.position.y = 0.04;
  const blade = new Mesh(new BoxGeometry(0.045, 0.22, 0.008), STEEL);
  blade.position.set(0.006, -0.1, 0);
  group.add(handle, blade);
  return group;
}
