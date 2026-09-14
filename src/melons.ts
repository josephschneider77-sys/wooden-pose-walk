import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  type Raycaster,
} from "three";

const CHOP_RANGE = 0.85;

const RIND = new MeshPhysicalMaterial({ color: "#1e6a2c", roughness: 0.72 });
const STRIPE = new MeshPhysicalMaterial({ color: "#7db84a", roughness: 0.68 });
const FLESH = new MeshPhysicalMaterial({
  color: "#e23b4a",
  roughness: 0.32,
  clearcoat: 0.5,
  clearcoatRoughness: 0.22,
});
const PALE = new MeshPhysicalMaterial({ color: "#f4d8c4", roughness: 0.45 });
const SEED = new MeshPhysicalMaterial({ color: "#1a1410", roughness: 0.55 });
const STEM = new MeshPhysicalMaterial({ color: "#4a3218", roughness: 0.8 });
const BOARD = new MeshPhysicalMaterial({ color: "#8b5a32", roughness: 0.62 });

const SPOTS: [number, number][] = [
  [0.28, 0.18],
  [-0.26, 0.2],
  [0.02, -0.28],
];

export class MelonBoard {
  readonly root = new Group();
  chopped = false;
  private readonly wholes = new Group();
  private readonly pieces = new Group();
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
      whole.position.set(x, 0.22, z);
      this.wholes.add(whole);
      whole.traverse((object) => {
        if ((object as Mesh).isMesh) this.picks.push(object as Mesh);
      });

      const pile = choppedPile();
      pile.position.set(x, 0.16, z);
      this.pieces.add(pile);
    }

    this.pieces.visible = false;
    this.root.add(this.wholes, this.pieces);
  }

  hit(raycaster: Raycaster): boolean {
    return raycaster.intersectObjects(this.picks, false).length > 0;
  }

  inRange(x: number, z: number): boolean {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    return dx * dx + dz * dz < CHOP_RANGE * CHOP_RANGE;
  }

  chop(): string {
    if (this.chopped) return "Already chopped — ready to eat";
    this.chopped = true;
    this.wholes.visible = false;
    this.pieces.visible = true;
    return "Watermelons chopped — nice and ready";
  }
}

function wholeMelon(): Group {
  const group = new Group();
  const body = new Mesh(new SphereGeometry(0.18, 22, 16), RIND);
  body.scale.set(1.05, 0.84, 1.05);
  body.castShadow = true;
  group.add(body);
  for (let i = 0; i < 5; i++) {
    const band = new Mesh(new CylinderGeometry(0.175, 0.175, 0.028, 22, 1, true), STRIPE);
    band.scale.set(1.05, 1, 0.84);
    band.rotation.z = (i / 5) * Math.PI;
    group.add(band);
  }
  const stem = new Mesh(new CylinderGeometry(0.012, 0.018, 0.04, 8), STEM);
  stem.position.y = 0.16;
  group.add(stem);
  return group;
}

function choppedPile(): Group {
  const pile = new Group();
  for (let i = 0; i < 6; i++) {
    const slice = wedge();
    const a = (i / 6) * Math.PI * 2;
    slice.position.set(Math.cos(a) * 0.11, 0.02, Math.sin(a) * 0.11);
    slice.rotation.y = a + 0.4;
    slice.rotation.z = 0.18;
    pile.add(slice);
  }
  for (let i = 0; i < 4; i++) {
    const cube = new Mesh(new BoxGeometry(0.055, 0.04, 0.055), FLESH);
    const a = (i / 4) * Math.PI * 2 + 0.4;
    cube.position.set(Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.04);
    cube.rotation.y = a;
    cube.castShadow = true;
    pile.add(cube);
  }
  return pile;
}

function wedge(): Group {
  const group = new Group();
  const span = Math.PI * 0.46;
  const rind = new Mesh(new SphereGeometry(0.145, 16, 12, 0, span, 0, Math.PI), RIND);
  const white = new Mesh(new SphereGeometry(0.136, 16, 12, 0, span, 0, Math.PI), PALE);
  const flesh = new Mesh(new SphereGeometry(0.128, 16, 12, 0, span, 0, Math.PI), FLESH);
  rind.scale.set(1, 0.82, 1);
  white.scale.set(1, 0.82, 1);
  flesh.scale.set(1, 0.82, 1);
  rind.castShadow = true;
  group.add(rind, white, flesh);

  const face = (angle: number) => {
    const cut = new Mesh(new CircleGeometry(0.128, 18, 0, Math.PI), FLESH);
    cut.rotation.y = angle;
    cut.scale.set(1, 0.82, 1);
    group.add(cut);
    for (let s = 0; s < 3; s++) {
      const seed = new Mesh(new SphereGeometry(0.007, 6, 5), SEED);
      const t = 0.25 + s * 0.22;
      seed.position.set(
        Math.sin(angle) * 0.004,
        Math.cos(t * Math.PI) * 0.07,
        Math.cos(angle) * 0.004 + Math.sin(t * Math.PI) * 0.06 * (angle < 0.1 ? 1 : -1),
      );
      group.add(seed);
    }
  };
  face(0);
  face(span);
  return group;
}
