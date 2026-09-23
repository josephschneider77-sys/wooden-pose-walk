import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
const SAND = new MeshPhysicalMaterial({ color: "#e2c48a", roughness: 0.92 });
const SEA = new MeshPhysicalMaterial({
  color: "#3a8fc4",
  roughness: 0.18,
  metalness: 0.08,
  transparent: true,
  opacity: 0.78,
});
const FOAM = new MeshPhysicalMaterial({ color: "#d8eef4", roughness: 0.55, transparent: true, opacity: 0.7 });
const TRUNK = new MeshPhysicalMaterial({ color: "#6b4424", roughness: 0.8 });
const FROND = new MeshPhysicalMaterial({ color: "#2f7a3a", roughness: 0.7 });
const ROCK = new MeshPhysicalMaterial({ color: "#7a7368", roughness: 0.88 });
const WOOD = new MeshPhysicalMaterial({ color: "#8a5a32", roughness: 0.7 });

export class Beach {
  readonly root = new Group();
  private readonly water: Mesh;

  constructor() {
    this.root.name = "beach";
    this.root.visible = false;

    const sand = new Mesh(new PlaneGeometry(36, 22), SAND);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0, -1.2);
    sand.receiveShadow = true;
    this.root.add(sand);

    this.water = new Mesh(new PlaneGeometry(36, 14), SEA);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -0.04, 11.2);
    this.root.add(this.water);

    const foam = new Mesh(new PlaneGeometry(36, 1.4), FOAM);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.01, 4.55);
    this.root.add(foam);

    this.palm(-7.2, -4.6);
    this.palm(6.8, -5.1);
    this.palm(-5.4, 1.8);
    this.rock(4.6, 2.4, 0.42);
    this.rock(-3.8, 3.1, 0.34);
    this.rock(7.4, 1.2, 0.28);
    this.log(2.4, -2.8);

    const sky = new Mesh(
      new SphereGeometry(0.7, 16, 12),
      new MeshBasicMaterial({ color: "#ffe08a" }),
    );
    sky.position.set(-8.5, 6.4, -7.2);
    this.root.add(sky);
  }

  private palm(x: number, z: number): void {
    const trunk = new Mesh(new CylinderGeometry(0.11, 0.16, 2.35, 8), TRUNK);
    trunk.position.set(x, 1.15, z);
    trunk.castShadow = true;
    this.root.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new Mesh(new ConeGeometry(0.18, 1.15, 6), FROND);
      leaf.position.set(x, 2.25, z);
      leaf.rotation.z = 1.05;
      leaf.rotation.y = (i / 5) * Math.PI * 2;
      leaf.castShadow = true;
      this.root.add(leaf);
    }
  }

  private rock(x: number, z: number, s: number): void {
    const mesh = new Mesh(new SphereGeometry(s, 8, 6), ROCK);
    mesh.scale.set(1.3, 0.7, 1.1);
    mesh.position.set(x, s * 0.45, z);
    mesh.castShadow = true;
    this.root.add(mesh);
  }

  private log(x: number, z: number): void {
    const mesh = new Mesh(new CylinderGeometry(0.12, 0.14, 1.7, 8), WOOD);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, 0.12, z);
    mesh.castShadow = true;
    this.root.add(mesh);
  }

  sway(time: number): void {
    this.water.position.y = -0.04 + Math.sin(time * 0.7) * 0.012;
  }
}

export const BEACH_SPAWN = new Vector3(0, 0, -0.4);
