import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Raycaster,
} from "three";
import type { GearShelf } from "./wearables";

const TOP_Y = 0.8;
const HIT = 0.3;
const TAKE_RANGE = 1.05;

const FLESH = new MeshPhysicalMaterial({
  color: "#e02338",
  roughness: 0.28,
  clearcoat: 0.55,
  clearcoatRoughness: 0.18,
});
const PALE = new MeshPhysicalMaterial({ color: "#f3d6be", roughness: 0.42 });
const SEED = new MeshPhysicalMaterial({ color: "#1a1410", roughness: 0.55 });
const STEM = new MeshPhysicalMaterial({ color: "#4a3218", roughness: 0.8 });
const TOP = new MeshPhysicalMaterial({ color: "#8b5a32", roughness: 0.58 });
const LEG = new MeshPhysicalMaterial({ color: "#5c3a22", roughness: 0.7 });
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

const _melon = new Vector3();

export class MelonBoard {
  readonly root = new Group();
  chopped = false;
  private readonly wholes = new Group();
  private readonly pieces = new Group();
  private readonly looseKnife = new Group();
  private readonly picks: Mesh[] = [];

  constructor() {
    this.root.name = "melonTable";
    this.root.position.set(-0.2, 0, 1.15);

    const top = new Mesh(new BoxGeometry(1.7, 0.07, 1.15), TOP);
    top.position.y = TOP_Y;
    top.castShadow = true;
    top.receiveShadow = true;
    this.root.add(top);
    this.picks.push(top);

    const apron = new Mesh(new BoxGeometry(1.66, 0.08, 1.11), LEG);
    apron.position.y = TOP_Y - 0.07;
    this.root.add(apron);

    for (const [x, z] of [
      [-0.72, -0.46],
      [0.72, -0.46],
      [-0.72, 0.46],
      [0.72, 0.46],
    ] as const) {
      const post = new Mesh(new BoxGeometry(0.08, TOP_Y - 0.02, 0.08), LEG);
      post.position.set(x, (TOP_Y - 0.02) / 2, z);
      post.castShadow = true;
      this.root.add(post);
    }

    for (const [x, z] of SPOTS) {
      const whole = wholeMelon();
      whole.position.set(x, TOP_Y + 0.2, z);
      this.wholes.add(whole);
      whole.traverse((object) => {
        if ((object as Mesh).isMesh) this.picks.push(object as Mesh);
      });

      const pile = choppedPile();
      pile.position.set(x, TOP_Y + 0.06, z);
      this.pieces.add(pile);
    }

    this.looseKnife.add(tableKnife());
    this.looseKnife.position.set(0.62, TOP_Y + 0.04, -0.38);
    this.looseKnife.rotation.set(0, 0.35, 1.15);
    this.looseKnife.traverse((object) => {
      if ((object as Mesh).isMesh) this.picks.push(object as Mesh);
    });

    this.pieces.visible = false;
    this.root.add(this.wholes, this.pieces, this.looseKnife);

    const lamp = new PointLight("#ffd2a8", 2.4, 9, 1.3);
    lamp.position.set(0, 2.15, 0);
    this.root.add(lamp);
    const bulb = new Mesh(
      new SphereGeometry(0.07, 12, 10),
      new MeshBasicMaterial({ color: new Color(4.4, 3.2, 1.7) }),
    );
    bulb.position.set(0, 2.1, 0);
    this.root.add(bulb);
  }

  hit(raycaster: Raycaster): boolean {
    return raycaster.intersectObjects(this.picks, false).length > 0;
  }

  inRange(x: number, z: number): boolean {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    return dx * dx + dz * dz < TAKE_RANGE * TAKE_RANGE;
  }

  showLooseKnife(on: boolean): void {
    this.looseKnife.visible = on && !this.chopped;
  }

  takeKnife(wardrobe: GearShelf): string | null {
    if (wardrobe.isWorn("sword")) return null;
    wardrobe.forceWear("sword");
    this.looseKnife.visible = false;
    return "Knife in hand — drag the right arm through the watermelons";
  }

  bladeHits(points: Vector3[]): boolean {
    if (this.chopped) return false;
    for (const [x, z] of SPOTS) {
      _melon.set(x, TOP_Y + 0.2, z);
      this.root.localToWorld(_melon);
      for (const point of points) {
        if (point.distanceTo(_melon) < HIT) return true;
      }
    }
    return false;
  }

  chop(): string {
    if (this.chopped) return "Watermelons chopped — nice and ready";
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

function tableKnife(): Group {
  const group = new Group();
  const handle = new Mesh(new BoxGeometry(0.03, 0.11, 0.022), GRIP);
  handle.position.y = 0.04;
  const blade = new Mesh(new BoxGeometry(0.045, 0.22, 0.008), STEEL);
  blade.position.set(0.006, -0.1, 0);
  group.add(handle, blade);
  return group;
}
