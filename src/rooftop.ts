import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
} from "three";

const WINDOW_Z = 1.15;
const WINDOW_X = -9.94;

/** Night terrace you reach by flying through the studio window. */
export function createRooftop(): Group {
  const root = new Group();
  root.name = "rooftop";
  root.visible = false;

  const slate = new MeshPhysicalMaterial({
    color: "#2a3038",
    roughness: 0.88,
    metalness: 0.08,
  });
  const floor = new Mesh(new BoxGeometry(22, 0.16, 22), slate);
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  root.add(floor);

  const brick = new MeshPhysicalMaterial({
    color: "#3a2a28",
    roughness: 0.8,
  });
  const wall = (x: number, z: number, w: number, d: number) => {
    const mesh = new Mesh(new BoxGeometry(w, 0.55, d), brick);
    mesh.position.set(x, 0.22, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  wall(0, -10.6, 22, 0.35);
  wall(0, 10.6, 22, 0.35);
  wall(10.6, 0, 0.35, 21.2);
  wall(-10.6, -5.4, 0.35, 10.4);
  wall(-10.6, 6.6, 0.35, 7.2);

  const chimney = new Mesh(new BoxGeometry(0.7, 1.4, 0.7), brick);
  chimney.position.set(4.2, 0.7, -4.6);
  chimney.castShadow = true;
  root.add(chimney);
  const pot = new Mesh(
    new CylinderGeometry(0.12, 0.14, 0.35, 10),
    new MeshPhysicalMaterial({ color: "#1c1816", roughness: 0.7 }),
  );
  pot.position.set(4.2, 1.55, -4.6);
  root.add(pot);

  const terra = new MeshPhysicalMaterial({ color: "#6a3a28", roughness: 0.86 });
  const soil = new MeshPhysicalMaterial({ color: "#2a1c14", roughness: 0.95 });
  const leaf = new MeshPhysicalMaterial({ color: "#2f5a32", roughness: 0.7 });
  const planter = (x: number, z: number) => {
    const box = new Mesh(new BoxGeometry(1.15, 0.38, 0.55), terra);
    box.position.set(x, 0.19, z);
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
    const dirt = new Mesh(new BoxGeometry(0.98, 0.08, 0.4), soil);
    dirt.position.set(x, 0.4, z);
    root.add(dirt);
    for (let i = 0; i < 3; i++) {
      const bush = new Mesh(new SphereGeometry(0.16 + i * 0.02, 10, 8), leaf);
      bush.position.set(x - 0.28 + i * 0.28, 0.58, z + (i - 1) * 0.04);
      bush.castShadow = true;
      root.add(bush);
    }
  };
  planter(2.4, 5.1);
  planter(0.4, -5.4);

  const vent = new Mesh(
    new CylinderGeometry(0.22, 0.26, 0.45, 12),
    new MeshPhysicalMaterial({ color: "#4a5058", roughness: 0.45, metalness: 0.35 }),
  );
  vent.position.set(-3.4, 0.22, -3.2);
  vent.castShadow = true;
  root.add(vent);

  const lamp = new MeshPhysicalMaterial({
    color: "#1a1814",
    roughness: 0.6,
    emissive: "#ffb45a",
    emissiveIntensity: 0.35,
  });
  for (const [x, z] of [
    [-8.6, -8.6],
    [-8.6, 8.6],
    [8.6, -8.6],
    [8.6, 8.6],
  ] as const) {
    const post = new Mesh(new CylinderGeometry(0.04, 0.05, 1.15, 8), lamp);
    post.position.set(x, 0.57, z);
    root.add(post);
    const bulb = new Mesh(
      new SphereGeometry(0.09, 10, 8),
      new MeshBasicMaterial({ color: new Color(4.2, 3.1, 1.6) }),
    );
    bulb.position.set(x, 1.18, z);
    root.add(bulb);
  }

  const moon = new Mesh(
    new SphereGeometry(0.55, 24, 18),
    new MeshBasicMaterial({ color: "#f4f0d8" }),
  );
  moon.position.set(6.5, 7.2, -8.4);
  root.add(moon);

  const starGeom = new BufferGeometry();
  const starPos = new Float32Array(240);
  for (let i = 0; i < 80; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 36;
    starPos[i * 3 + 1] = 6 + Math.random() * 10;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  starGeom.setAttribute("position", new BufferAttribute(starPos, 3));
  root.add(
    new Points(
      starGeom,
      new PointsMaterial({ color: new Color("#dce6ff"), size: 0.05 }),
    ),
  );

  const returnGlow = new Mesh(
    new PlaneGeometry(2.4, 3.5),
    new MeshBasicMaterial({
      color: "#e8c888",
      transparent: true,
      opacity: 0.32,
    }),
  );
  returnGlow.position.set(WINDOW_X, 3.15, WINDOW_Z);
  returnGlow.rotation.y = Math.PI / 2;
  root.add(returnGlow);

  const returnPick = new Mesh(
    new PlaneGeometry(3.2, 4.2),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  returnPick.position.set(WINDOW_X + 0.04, 3.15, WINDOW_Z);
  returnPick.rotation.y = Math.PI / 2;
  returnPick.name = "returnWindow";
  root.add(returnPick);

  return root;
}

export const PORTAL = {
  x: WINDOW_X,
  y: 3.15,
  z: WINDOW_Z,
  halfW: 1.2,
  halfH: 1.75,
};
