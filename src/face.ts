import {
  Box3,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WoodenMannequin } from "./mannequin";

const HEAD_HEIGHT = 0.236;

function loadTexture(url: string, color: boolean): Promise<Texture> {
  return new TextureLoader().loadAsync(url).then((texture) => {
    texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  });
}

function specToRoughness(spec: Texture): CanvasTexture {
  const image = spec.image as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not invert specular map");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const speckle = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const rough = Math.max(40, 255 - speckle * 0.82);
    data[i] = rough;
    data[i + 1] = rough;
    data[i + 2] = rough;
  }
  ctx.putImageData(pixels, 0, 0);
  const roughness = new CanvasTexture(canvas);
  roughness.colorSpace = NoColorSpace;
  roughness.flipY = spec.flipY;
  roughness.anisotropy = 8;
  roughness.needsUpdate = true;
  return roughness;
}

function firstMesh(root: Group): Mesh {
  let found: Mesh | null = null;
  root.traverse((object) => {
    if (!found && (object as Mesh).isMesh) found = object as Mesh;
  });
  if (!found) throw new Error("Face mesh missing from scan");
  return found;
}

/**
 * Lee Perry-Smith Infinite 3D Head Scan (CC BY 3.0).
 * Fitted onto the mannequin neck in place of the wooden skull.
 */
export async function attachRealisticFace(figure: WoodenMannequin): Promise<Group> {
  const base = import.meta.env.BASE_URL;
  const [gltf, color, spec, normal, displacement] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}models/face/LeePerrySmith.glb`),
    loadTexture(`${base}models/face/color.jpg`, true),
    loadTexture(`${base}models/face/spec.jpg`, false),
    loadTexture(`${base}models/face/normal.jpg`, false),
    loadTexture(`${base}models/face/displacement.jpg`, false),
  ]);

  const scan = firstMesh(gltf.scene);
  const roughnessMap = specToRoughness(spec);
  scan.material = new MeshPhysicalMaterial({
    name: "skin",
    map: color,
    normalMap: normal,
    normalScale: new Vector2(1.05, 1.05),
    roughnessMap,
    roughness: 0.42,
    metalness: 0,
    displacementMap: displacement,
    displacementScale: 0.0045,
    displacementBias: -0.0015,
    sheen: 0.55,
    sheenColor: new Color("#c47a5a"),
    sheenRoughness: 0.38,
    clearcoat: 0.16,
    clearcoatRoughness: 0.48,
    envMapIntensity: 0.7,
  });
  scan.castShadow = true;
  scan.receiveShadow = true;

  gltf.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  scan.position.sub(center);
  scan.position.y += size.y * 0.06;

  const wrapper = new Group();
  wrapper.name = "face";
  wrapper.add(gltf.scene);
  wrapper.scale.setScalar(HEAD_HEIGHT / Math.max(size.y, 1e-5));
  wrapper.position.set(0, 0.068, 0.012);

  if (figure.skull) figure.skull.visible = false;
  figure.bone("head").add(wrapper);
  figure.refreshWorld();
  return wrapper;
}
