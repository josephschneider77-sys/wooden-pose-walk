import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Raycaster,
} from "three";
import { attachRealisticFace } from "./face";
import { WoodenMannequin } from "./mannequin";

export const STALL_FRONT = new Vector3(1.15, 0, -1.15);
export const GATE_POS = new Vector3(0, 0, -7.15);

const STONE = new MeshPhysicalMaterial({ color: "#2a2420", roughness: 0.92 });
const SLAB = new MeshPhysicalMaterial({ color: "#3a322c", roughness: 0.88 });
const WOOD = new MeshPhysicalMaterial({ color: "#6b4228", roughness: 0.7 });
const CLOTH = new MeshPhysicalMaterial({
  color: "#6a1c22",
  roughness: 0.86,
  sheen: 0.3,
  sheenColor: "#a8444a",
});
const BRASS = new MeshPhysicalMaterial({ color: "#c4a056", metalness: 0.65, roughness: 0.3 });

export class Bazaar {
  readonly root = new Group();
  readonly vault = new Group();
  readonly merchant: WoodenMannequin;
  readonly stallPick: Mesh[] = [];
  gateOpen = false;
  private readonly leftDoor: Mesh;
  private readonly rightDoor: Mesh;
  private readonly moths = new Group();
  private readonly lanternGlow: PointLight;
  private unlock = 0;

  constructor() {
    this.root.name = "bazaar";
    this.root.visible = false;
    this.vault.name = "vault";
    this.vault.visible = false;

    const floor = new Mesh(new BoxGeometry(16, 0.18, 18), SLAB);
    floor.position.y = -0.09;
    floor.receiveShadow = true;
    this.root.add(floor);

    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), STONE);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };
    wall(16, 3.4, 0.28, 0, 1.6, 8.6);
    wall(16, 3.4, 0.28, 0, 1.6, -8.6);
    wall(0.28, 3.4, 17.2, -7.9, 1.6, 0);
    wall(0.28, 3.4, 17.2, 7.9, 1.6, 0);
    wall(3.4, 1.8, 1.4, 0, 0.85, 7.4);

    const rubble = new Mesh(new BoxGeometry(2.6, 1.1, 1.1), STONE);
    rubble.position.set(0, 0.5, 7.15);
    rubble.rotation.z = 0.12;
    this.root.add(rubble);

    this.buildStall();
    this.merchant = this.buildMerchant();
    this.poseMerchant(0);
    this.root.add(this.merchant.root);

    const arch = new Mesh(new BoxGeometry(3.4, 3.1, 0.36), STONE);
    arch.position.set(0, 1.5, -7.15);
    this.root.add(arch);
    this.leftDoor = new Mesh(new BoxGeometry(1.15, 2.35, 0.12), STONE);
    this.rightDoor = this.leftDoor.clone();
    this.leftDoor.position.set(-0.58, 1.15, -7.05);
    this.rightDoor.position.set(0.58, 1.15, -7.05);
    this.root.add(this.leftDoor, this.rightDoor);

    this.moths.visible = false;
    for (let i = 0; i < 14; i++) {
      const moth = new Mesh(
        new SphereGeometry(0.035, 8, 6),
        new MeshBasicMaterial({ color: new Color(3.2, 2.4, 1.1) }),
      );
      moth.position.set((i % 7) * 0.22 - 0.66, 0.7 + (i % 3) * 0.35, -6.85);
      this.moths.add(moth);
    }
    this.root.add(this.moths);

    this.lanternGlow = new PointLight("#ffb45a", 0, 4.2, 1.6);
    this.root.add(this.lanternGlow);

    const lamps: [number, number, number][] = [
      [-4.6, 2.4, 2.2],
      [4.6, 2.4, 2.2],
      [-4.2, 2.3, -3.6],
      [4.2, 2.3, -3.6],
    ];
    for (const [x, y, z] of lamps) {
      const bulb = new Mesh(
        new SphereGeometry(0.07, 10, 8),
        new MeshBasicMaterial({ color: new Color(4.2, 2.8, 1.4) }),
      );
      bulb.position.set(x, y, z);
      this.root.add(bulb);
      const light = new PointLight("#ffb070", 1.05, 7, 1.6);
      light.position.set(x, y, z);
      this.root.add(light);
    }

    this.buildVault();
  }

  private buildStall(): void {
    const stall = new Group();
    stall.position.set(2.55, 0, -1.2);

    const deck = new Mesh(new BoxGeometry(2.15, 0.1, 0.95), WOOD);
    deck.position.set(0, 0.92, 0.05);
    deck.castShadow = true;
    stall.add(deck);
    this.stallPick.push(deck);

    for (const x of [-0.9, 0.9]) {
      const leg = new Mesh(new BoxGeometry(0.08, 0.92, 0.08), WOOD);
      leg.position.set(x, 0.46, 0.35);
      stall.add(leg);
      const back = leg.clone();
      back.position.set(x, 0.46, -0.35);
      stall.add(back);
    }

    const cloth = new Mesh(new BoxGeometry(2.2, 0.06, 1.15), CLOTH);
    cloth.position.set(0, 1.72, 0);
    stall.add(cloth);
    const pole = (x: number) => {
      const mesh = new Mesh(new CylinderGeometry(0.03, 0.03, 1.75, 8), WOOD);
      mesh.position.set(x, 0.88, -0.4);
      stall.add(mesh);
    };
    pole(-1.0);
    pole(1.0);

    const crate = new Mesh(new BoxGeometry(0.45, 0.32, 0.38), WOOD);
    crate.position.set(-0.7, 0.16, 0.55);
    stall.add(crate);
    const scale = new Mesh(new BoxGeometry(0.28, 0.04, 0.22), BRASS);
    scale.position.set(0.15, 1.0, 0.12);
    stall.add(scale);
    const bowl = new Mesh(new CylinderGeometry(0.08, 0.07, 0.04, 12), BRASS);
    bowl.position.set(0.15, 1.04, 0.12);
    stall.add(bowl);
    for (let i = 0; i < 5; i++) {
      const coin = new Mesh(new CylinderGeometry(0.03, 0.03, 0.006, 12), BRASS);
      coin.rotation.x = Math.PI / 2;
      coin.position.set(-0.15 + i * 0.06, 0.99, 0.22);
      stall.add(coin);
    }
    const jar = new Mesh(
      new CylinderGeometry(0.07, 0.08, 0.16, 10),
      new MeshPhysicalMaterial({
        color: "#7a2a18",
        roughness: 0.2,
        transparent: true,
        opacity: 0.55,
      }),
    );
    jar.position.set(0.62, 1.08, 0.05);
    stall.add(jar);

    const pick = new Mesh(
      new BoxGeometry(2.3, 2.1, 1.4),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pick.position.set(0, 1.05, 0.1);
    pick.name = "stallPick";
    stall.add(pick);
    this.stallPick.push(pick);
    this.root.add(stall);
  }

  private buildMerchant(): WoodenMannequin {
    const figure = new WoodenMannequin();
    figure.root.name = "merchant";
    figure.root.position.set(2.55, 0, -1.85);
    figure.root.rotation.y = 0;
    figure.bone("root").rotation.set(0, 0, 0);
    const apron = new Mesh(new BoxGeometry(0.26, 0.34, 0.04), CLOTH);
    apron.position.set(0, 0.08, 0.1);
    figure.bone("chest").add(apron);
    const sash = new Mesh(new TorusGeometry(0.13, 0.018, 8, 20), CLOTH);
    sash.rotation.x = Math.PI / 2;
    figure.bone("pelvis").add(sash);
    void attachRealisticFace(figure).catch(() => {
      // Twin can stand without the scan if the face pack fails.
    });
    return figure;
  }

  poseMerchant(time: number): void {
    const figure = this.merchant;
    figure.resetPose();
    figure.bone("root").rotation.set(0, 0, 0);
    figure.bone("chest").rotateX(0.08);
    figure.bone("pelvis").position.y = figure.restPelvisY + Math.sin(time * 1.4) * 0.008;
    const left = figure.bone("leftShoulder");
    const right = figure.bone("rightShoulder");
    left.rotateX(-0.55);
    left.rotateZ(0.55);
    figure.bone("leftElbow").rotateX(0.7);
    right.rotateZ(-0.22);
    right.rotateX(-0.12 + Math.sin(time * 1.1) * 0.04);
    figure.refreshWorld();
  }

  hit(raycaster: Raycaster): boolean {
    const meshes = [...this.stallPick, ...this.merchant.pickables()];
    return raycaster.intersectObjects(meshes, false).length > 0;
  }

  inShopRange(x: number, z: number): boolean {
    const dx = x - STALL_FRONT.x;
    const dz = z - STALL_FRONT.z;
    return dx * dx + dz * dz < 1.35 * 1.35;
  }

  nearGate(x: number, z: number): boolean {
    const dx = x - GATE_POS.x;
    const dz = z - GATE_POS.z;
    return dx * dx + dz * dz < 1.7 * 1.7;
  }

  throughGate(x: number, z: number): boolean {
    return this.gateOpen && z < -7.35 && Math.abs(x) < 1.15;
  }

  feedLantern(world: Vector3, worn: boolean): void {
    this.lanternGlow.position.copy(world);
    this.lanternGlow.intensity = worn ? 1.8 : 0;
    if (worn && this.nearGate(world.x, world.z) && !this.gateOpen) {
      this.unlock = Math.min(1, this.unlock + 0.02);
      this.moths.visible = true;
      this.moths.children.forEach((moth, i) => {
        moth.position.y = 0.75 + Math.sin(performance.now() / 400 + i) * 0.12 + i * 0.08;
      });
      if (this.unlock >= 1) this.openGate();
    }
  }

  openGate(): void {
    this.gateOpen = true;
    this.moths.visible = true;
    this.leftDoor.position.x = -1.55;
    this.rightDoor.position.x = 1.55;
  }

  private buildVault(): void {
    const floor = new Mesh(new CylinderGeometry(6.4, 6.4, 0.18, 28), SLAB);
    floor.position.y = -0.09;
    floor.receiveShadow = true;
    this.vault.add(floor);
    const ring = new Mesh(new CylinderGeometry(6.5, 6.5, 3.2, 28, 1, true), STONE);
    ring.position.y = 1.5;
    this.vault.add(ring);
    const well = new Mesh(new CylinderGeometry(0.85, 0.95, 0.45, 16), STONE);
    well.position.y = 0.18;
    this.vault.add(well);
    const heart = new Mesh(
      new SphereGeometry(0.12, 12, 10),
      new MeshBasicMaterial({ color: new Color(3.6, 2.2, 0.8) }),
    );
    heart.position.y = 1.15;
    this.vault.add(heart);
    const glow = new PointLight("#ffc878", 1.6, 9, 1.4);
    glow.position.set(0, 1.4, 0);
    this.vault.add(glow);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const moth = new Mesh(
        new SphereGeometry(0.04, 8, 6),
        new MeshBasicMaterial({ color: new Color(3.1, 2.5, 1.2) }),
      );
      moth.position.set(Math.cos(a) * 2.1, 1.4, Math.sin(a) * 2.1);
      this.vault.add(moth);
    }
  }
}

export function disposeTree(root: Group): void {
  root.removeFromParent();
  root.visible = false;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
  });
}
