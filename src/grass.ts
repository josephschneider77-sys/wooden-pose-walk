import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";

const BLADE_ROOT = new Color("#3f6d28");
const BLADE_TIP = new Color("#8fb54a");

function configureMap(
  texture: ReturnType<TextureLoader["load"]>,
  color: boolean,
  repeat: number,
): void {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
}

/** Top-down lawn using ambientCG Grass001 (CC0). */
export function createGrassGround(): Mesh {
  const repeat = 12;
  const loader = new TextureLoader();
  const base = import.meta.env.BASE_URL;
  const map = loader.load(`${base}textures/grass/color.jpg`);
  const normalMap = loader.load(`${base}textures/grass/normal.jpg`);
  const roughnessMap = loader.load(`${base}textures/grass/roughness.jpg`);
  const aoMap = loader.load(`${base}textures/grass/ao.jpg`);
  configureMap(map, true, repeat);
  configureMap(normalMap, false, repeat);
  configureMap(roughnessMap, false, repeat);
  configureMap(aoMap, false, repeat);

  const geometry = new PlaneGeometry(28, 28);
  geometry.setAttribute("uv2", geometry.getAttribute("uv").clone());

  const material = new MeshPhysicalMaterial({
    name: "lawn",
    map,
    normalMap,
    roughnessMap,
    aoMap,
    aoMapIntensity: 0.85,
    color: "#d8e8b8",
    roughness: 0.92,
    metalness: 0,
    sheen: 0.28,
    sheenColor: new Color("#6f9a3c"),
    sheenRoughness: 0.7,
    envMapIntensity: 0.35,
  });

  const floor = new Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

/**
 * Short lawn blades from the stylized meadow-grass skill,
 * scaled to a walkable turf instead of a tall meadow.
 */
export function createGrassBladeGeometry(
  height = 0.055,
  width = 0.011,
  segments = 4,
  planes = 3,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let plane = 0; plane < planes; plane++) {
    const angle = (plane / planes) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const normal = new Vector3(sin, 0.42, cos).normalize();
    const base = positions.length / 3;

    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const taper = (1 - t) ** 1.35;
      const lean = t ** 1.8 * 0.14;
      const y = t * height;
      const halfWidth = width * (0.2 + 0.8 * taper);
      for (const side of [-1, 1]) {
        const localX = side * halfWidth;
        const localZ = lean;
        positions.push(localX * cos - localZ * sin, y, localX * sin + localZ * cos);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(side < 0 ? 0 : 1, t);
      }
    }

    for (let segment = 0; segment < segments; segment++) {
      const row = base + segment * 2;
      indices.push(row, row + 1, row + 2, row + 1, row + 3, row + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGrassBlades(count = 6200, radius = 10.5): InstancedMesh {
  const material = new MeshPhysicalMaterial({
    name: "grass-blades",
    color: "#ffffff",
    roughness: 0.86,
    metalness: 0,
    sheen: 0.45,
    sheenColor: new Color("#7aaa3a"),
    sheenRoughness: 0.62,
    side: DoubleSide,
    envMapIntensity: 0.28,
  });

  const mesh = new InstancedMesh(createGrassBladeGeometry(), material, count);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const dummy = new Object3D();
  const tint = new Color();
  for (let i = 0; i < count; i++) {
    const u = hash(i * 19.17 + 3.1);
    const v = hash(i * 7.33 + 11.8);
    const r = Math.sqrt(u) * radius;
    const a = v * Math.PI * 2;
    dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    dummy.rotation.set(0, hash(i * 4.2) * Math.PI * 2, (hash(i * 9.1) - 0.5) * 0.18);
    const scale = 0.65 + hash(i * 13.7) * 0.7;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tint.copy(BLADE_ROOT).lerp(BLADE_TIP, hash(i * 21.4));
    mesh.setColorAt(i, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
