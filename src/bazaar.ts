import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
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

const STONE = new MeshPhysicalMaterial({ color: "#5a4c42", roughness: 0.88 });
const SLAB = new MeshPhysicalMaterial({ color: "#6a5a4c", roughness: 0.84 });
const WOOD = new MeshPhysicalMaterial({ color: "#8a5a32", roughness: 0.62 });
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
  private readonly lamps: VaultLamp[] = [];
  private vaultAmbient = new AmbientLight("#ffe8c4", 0.78);

  constructor() {
    this.root.name = "bazaar";
    this.root.visible = false;
    this.vault.name = "vault";
    this.vault.visible = false;

    const floor = new Mesh(new BoxGeometry(16, 0.18, 18), SLAB);
    floor.position.y = -0.09;
    floor.receiveShadow = true;
    this.root.add(floor);
    this.root.add(new AmbientLight("#ffd2a8", 0.62));
    const hallLamp = new PointLight("#ffc080", 2.6, 16, 1.15);
    hallLamp.position.set(0, 2.7, 1.2);
    this.root.add(hallLamp);
    const stallLamp = new PointLight("#ffb060", 2.1, 8, 1.3);
    stallLamp.position.set(2.4, 2.3, -0.8);
    this.root.add(stallLamp);

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

    const post = (x: number) => {
      const mesh = new Mesh(new BoxGeometry(0.42, 3.1, 0.36), STONE);
      mesh.position.set(x, 1.5, -7.15);
      this.root.add(mesh);
    };
    post(-1.55);
    post(1.55);
    const lintel = new Mesh(new BoxGeometry(3.6, 0.38, 0.4), STONE);
    lintel.position.set(0, 2.95, -7.15);
    this.root.add(lintel);
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
      const light = new PointLight("#ffb070", 1.8, 9, 1.4);
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

  remainingLamps(): number {
    return this.lamps.filter((lamp) => lamp.lit).length;
  }

  allDark(): boolean {
    return this.lamps.length > 0 && this.remainingLamps() === 0;
  }

  snuffNear(x: number, z: number): boolean {
    for (const lamp of this.lamps) {
      if (!lamp.lit) continue;
      const dx = x - lamp.x;
      const dz = z - lamp.z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        lamp.snuff();
        this.vaultAmbient.intensity = 0.12 + 0.1 * this.remainingLamps();
        return true;
      }
    }
    return false;
  }

  lampApproach(raycaster: Raycaster, out: Vector3): boolean {
    const meshes = this.lamps.flatMap((lamp) => (lamp.lit ? lamp.picks : []));
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return false;
    const lamp = this.lamps.find((entry) => entry.owns(hit.object));
    if (!lamp || !lamp.lit) return false;
    out.copy(lamp.approach);
    return true;
  }

  private buildVault(): void {
    const floor = new Mesh(new CylinderGeometry(8.4, 8.4, 0.18, 28), SLAB);
    floor.position.y = -0.09;
    floor.receiveShadow = true;
    this.vault.add(floor);
    this.vault.add(this.vaultAmbient);
    const ringMat = STONE.clone();
    ringMat.side = DoubleSide;
    const ring = new Mesh(new CylinderGeometry(8.5, 8.5, 4.6, 32, 1, true), ringMat);
    ring.position.y = 2.3;
    this.vault.add(ring);
    const lid = new Mesh(new CylinderGeometry(8.45, 8.45, 0.16, 32), STONE);
    lid.position.y = 4.52;
    this.vault.add(lid);
    const well = new Mesh(new CylinderGeometry(0.62, 0.7, 0.38, 16), STONE);
    well.position.y = 0.16;
    this.vault.add(well);
    const fill = new PointLight("#ffe4c0", 1.15, 18, 1.25);
    fill.position.set(0, 2.55, 0);
    this.vault.add(fill);

    const spots: [number, number][] = [
      [2.55, 2.45],
      [2.55, -2.55],
      [-2.55, -2.55],
      [-2.55, 2.45],
    ];
    for (const [x, z] of spots) {
      const lamp = new VaultLamp(x, z);
      this.lamps.push(lamp);
      this.vault.add(lamp.root);
    }
  }
}

class VaultLamp {
  readonly root = new Group();
  readonly approach = new Vector3();
  readonly picks: Mesh[] = [];
  lit = true;
  readonly x: number;
  readonly z: number;
  private readonly flame: Mesh;
  private readonly light: PointLight;

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.root.position.set(x, 0, z);
    const toward = Math.hypot(x, z) || 1;
    this.approach.set(x - (x / toward) * 0.55, 0, z - (z / toward) * 0.55);

    const plinth = new Mesh(new CylinderGeometry(0.22, 0.28, 0.18, 10), STONE);
    plinth.position.y = 0.09;
    plinth.castShadow = true;
    this.root.add(plinth);
    this.picks.push(plinth);
    const column = new Mesh(new CylinderGeometry(0.07, 0.09, 1.05, 8), STONE);
    column.position.y = 0.7;
    this.root.add(column);
    this.picks.push(column);
    const bowl = new Mesh(new CylinderGeometry(0.16, 0.12, 0.1, 10), BRASS);
    bowl.position.y = 1.24;
    this.root.add(bowl);
    this.picks.push(bowl);

    this.flame = new Mesh(
      new SphereGeometry(0.09, 10, 8),
      new MeshBasicMaterial({ color: new Color(4.4, 2.6, 0.9) }),
    );
    this.flame.position.y = 1.4;
    this.root.add(this.flame);
    this.light = new PointLight("#ffc070", 2.35, 9.5, 1.2);
    this.light.position.y = 1.45;
    this.root.add(this.light);
    const halo = new Mesh(
      new SphereGeometry(0.55, 10, 8),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    halo.position.y = 1.35;
    this.root.add(halo);
    this.picks.push(halo);
  }

  owns(object: object): boolean {
    return this.picks.includes(object as Mesh);
  }

  snuff(): void {
    this.lit = false;
    this.light.intensity = 0;
    (this.flame.material as MeshBasicMaterial).color.set("#2a2018");
    this.flame.scale.setScalar(0.45);
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
