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
  Vector3,
} from "three";

/** Long gash south of the landing path so the whole descent is visible. */
export const WELL = {
  cx: -3.8,
  cz: -2.15,
  hx: 1.15,
  hz: 3.25,
};

export const STEPS = 20;
export const RISE = 0.21;
export const RUN = 0.31;
export const CELLAR_Y = -(STEPS * RISE);
const WIDTH = 1.85;
const Z0 = WELL.cz + WELL.hz;

const STONE = new MeshPhysicalMaterial({ color: "#1c1816", roughness: 0.94 });
const STEP = new MeshPhysicalMaterial({
  color: "#5a4636",
  roughness: 0.82,
  emissive: "#2a1810",
  emissiveIntensity: 0.22,
});
const NOSE = new MeshPhysicalMaterial({
  color: "#8a6a48",
  roughness: 0.45,
  emissive: "#ff7a3a",
  emissiveIntensity: 0.35,
});
const RUST = new MeshPhysicalMaterial({
  color: "#6a3224",
  roughness: 0.62,
  metalness: 0.32,
});
const MOSS = new MeshPhysicalMaterial({ color: "#2a3418", roughness: 0.95 });

export class Stairwell {
  readonly root = new Group();
  readonly walkIn = new Vector3(WELL.cx, 0, Z0 - STEPS * RUN - 1.8);
  open = false;

  constructor() {
    this.root.name = "stairwell";
    this.root.visible = false;

    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), STONE);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };
    const shaftH = STEPS * RISE + 0.35;
    const shaftY = -shaftH * 0.5;
    wall(0.16, shaftH, WELL.hz * 2 + 0.2, WELL.cx - WELL.hx, shaftY, WELL.cz);
    wall(0.16, shaftH, WELL.hz * 2 + 0.2, WELL.cx + WELL.hx, shaftY, WELL.cz);
    wall(WELL.hx * 2 + 0.2, shaftH, 0.16, WELL.cx, shaftY, WELL.cz + WELL.hz);
    wall(WELL.hx * 2 * 0.38, shaftH, 0.16, WELL.cx + WELL.hx * 0.62, shaftY, WELL.cz - WELL.hz);
    wall(WELL.hx * 2 * 0.38, shaftH, 0.16, WELL.cx - WELL.hx * 0.62, shaftY, WELL.cz - WELL.hz);

    const coping = new MeshPhysicalMaterial({ color: "#1c1816", roughness: 0.7 });
    const rim = (w: number, d: number, x: number, z: number) => {
      const mesh = new Mesh(new BoxGeometry(w, 0.12, d), coping);
      mesh.position.set(x, 0.04, z);
      mesh.castShadow = true;
      this.root.add(mesh);
    };
    rim(WELL.hx * 2 + 0.28, 0.12, WELL.cx, WELL.cz + WELL.hz + 0.08);
    rim(WELL.hx * 2 + 0.28, 0.12, WELL.cx, WELL.cz - WELL.hz - 0.08);
    rim(0.12, WELL.hz * 2 + 0.28, WELL.cx - WELL.hx - 0.08, WELL.cz);
    rim(0.12, WELL.hz * 2 + 0.28, WELL.cx + WELL.hx + 0.08, WELL.cz);

    for (let i = 0; i < STEPS; i++) {
      const wobble = ((i % 5) - 2) * 0.028;
      const chip = i % 4 === 3 ? 0.16 : 0;
      const tread = new Mesh(new BoxGeometry(WIDTH - chip, 0.075, RUN + 0.03), STEP);
      const z = Z0 - (i + 0.5) * RUN;
      const y = -(i + 0.5) * RISE;
      tread.position.set(WELL.cx + wobble, y, z);
      tread.rotation.x = wobble * 0.35;
      tread.rotation.z = ((i % 3) - 1) * 0.025;
      tread.castShadow = true;
      tread.receiveShadow = true;
      this.root.add(tread);

      const nose = new Mesh(new BoxGeometry(WIDTH - chip - 0.08, 0.03, 0.04), NOSE);
      nose.position.set(WELL.cx + wobble, y + 0.05, z - RUN * 0.42);
      this.root.add(nose);

      if (i % 3 === 1) {
        const lamp = new PointLight("#d4622a", 1.15, 3.4, 1.7);
        lamp.position.set(WELL.cx, y + 0.55, z);
        this.root.add(lamp);
      }

      const riser = new Mesh(new BoxGeometry(WIDTH - 0.12, RISE + 0.01, 0.04), STONE);
      riser.position.set(WELL.cx + wobble * 0.4, -i * RISE - RISE * 0.5, Z0 - i * RUN);
      this.root.add(riser);

      if (i % 3 === 0) {
        const stain = new Mesh(new BoxGeometry(0.22, 0.02, 0.18), MOSS);
        stain.position.set(WELL.cx + 0.4 * ((i % 2) * 2 - 1), y + 0.04, z);
        this.root.add(stain);
      }
    }

    const rail = (side: number) => {
      for (let i = 0; i < STEPS; i += 1) {
        const post = new Mesh(new CylinderGeometry(0.016, 0.022, 0.78, 6), RUST);
        post.position.set(
          WELL.cx + side * (WIDTH * 0.48),
          -i * RISE + 0.18,
          Z0 - (i + 0.5) * RUN,
        );
        post.rotation.z = side * 0.08;
        post.rotation.x = 0.06;
        this.root.add(post);
      }
      const bar = new Mesh(new BoxGeometry(0.035, 0.03, STEPS * RUN * 1.02), RUST);
      bar.position.set(WELL.cx + side * (WIDTH * 0.48), -STEPS * RISE * 0.45 + 0.42, WELL.cz);
      bar.rotation.x = Math.atan(RISE / RUN);
      this.root.add(bar);
    };
    rail(1);
    rail(-1);

    for (let i = 0; i < 5; i++) {
      const chain = new Mesh(new CylinderGeometry(0.012, 0.012, 0.9 + i * 0.15, 6), RUST);
      chain.position.set(
        WELL.cx + ((i % 2) * 2 - 1) * 0.55,
        -0.7 - i * 0.35,
        Z0 - 1.2 - i * 0.9,
      );
      chain.rotation.z = 0.15 * ((i % 2) * 2 - 1);
      this.root.add(chain);
      const hook = new Mesh(new SphereGeometry(0.035, 6, 5), RUST);
      hook.position.copy(chain.position);
      hook.position.y -= 0.5;
      this.root.add(hook);
    }

    const cellar = new Group();
    const floor = new Mesh(new BoxGeometry(8.4, 0.22, 7.2), STONE);
    floor.position.set(WELL.cx, CELLAR_Y - 0.11, Z0 - STEPS * RUN - 3.4);
    floor.receiveShadow = true;
    cellar.add(floor);

    const chamber = (x: number, z: number, w: number, d: number) => {
      const mesh = new Mesh(new BoxGeometry(w, 2.8, d), STONE);
      mesh.position.set(x, CELLAR_Y + 1.3, z);
      cellar.add(mesh);
    };
    const cx = WELL.cx;
    const cz = Z0 - STEPS * RUN - 3.4;
    chamber(cx, cz - 3.7, 8.4, 0.28);
    chamber(cx, cz + 3.7, 8.4, 0.28);
    chamber(cx - 4.25, cz, 0.28, 7.2);
    chamber(cx + 4.25, cz + 1.6, 0.28, 4);
    chamber(cx + 4.25, cz - 2.2, 0.28, 2.8);

    const slit = new Mesh(
      new BoxGeometry(0.1, 1.15, 0.05),
      new MeshBasicMaterial({ color: new Color(2.6, 0.12, 0.06) }),
    );
    slit.position.set(cx - 4.1, CELLAR_Y + 1.55, cz);
    cellar.add(slit);

    const drip = new PointLight("#7a140c", 1.35, 8.5, 1.55);
    drip.position.set(cx - 0.8, CELLAR_Y + 2.2, cz);
    cellar.add(drip);
    const ember = new Mesh(
      new SphereGeometry(0.055, 8, 6),
      new MeshBasicMaterial({ color: new Color(3.4, 0.35, 0.1) }),
    );
    ember.position.copy(drip.position);
    cellar.add(ember);

    const mouth = new PointLight("#ff8a4a", 2.2, 6.5, 1.35);
    mouth.position.set(WELL.cx, 0.9, WELL.cz + 0.4);
    this.root.add(mouth);
    const shaftGlow = new PointLight("#c43a18", 1.6, 8, 1.5);
    shaftGlow.position.set(WELL.cx, -1.4, WELL.cz);
    this.root.add(shaftGlow);

    const pillar = new Mesh(new CylinderGeometry(0.16, 0.2, 2.6, 8), STONE);
    pillar.position.set(cx + 1.8, CELLAR_Y + 1.3, cz - 1.1);
    cellar.add(pillar);

    this.root.add(cellar);
  }

  reveal(): void {
    this.open = true;
    this.root.visible = true;
  }

  inPit(x: number, z: number): boolean {
    return Math.abs(x - WELL.cx) <= WELL.hx + 0.12 && Math.abs(z - WELL.cz) <= WELL.hz + 0.12;
  }

  heightAt(x: number, z: number): number {
    if (!this.open) return 0;
    const cellarZ = Z0 - STEPS * RUN;
    if (
      Math.abs(x - WELL.cx) < 4.1 &&
      z < cellarZ - 0.15 &&
      z > cellarZ - 7.2
    ) {
      return CELLAR_Y;
    }
    if (Math.abs(x - WELL.cx) > WELL.hx + 0.12) return 0;
    if (z > Z0 + 0.12 || z < cellarZ - 0.2) return 0;
    const t = (Z0 - z) / RUN;
    const step = Math.min(STEPS - 1, Math.max(0, Math.floor(t)));
    return -step * RISE;
  }
}

export function buildTerraceFloor(parent: Group, slate: MeshPhysicalMaterial): Mesh {
  const add = (w: number, d: number, x: number, z: number): Mesh => {
    const mesh = new Mesh(new BoxGeometry(w, 0.16, d), slate);
    mesh.position.set(x, -0.08, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const east = 11 - (WELL.cx + WELL.hx);
  add(east, 22, WELL.cx + WELL.hx + east * 0.5, 0);
  const west = WELL.cx - WELL.hx - -11;
  add(west, 22, -11 + west * 0.5, 0);
  const north = 11 - (WELL.cz + WELL.hz);
  add(WELL.hx * 2, north, WELL.cx, WELL.cz + WELL.hz + north * 0.5);
  const south = WELL.cz - WELL.hz - -11;
  add(WELL.hx * 2, south, WELL.cx, -11 + south * 0.5);
  const plug = add(WELL.hx * 2, WELL.hz * 2, WELL.cx, WELL.cz);
  plug.name = "floorPlug";
  return plug;
}
