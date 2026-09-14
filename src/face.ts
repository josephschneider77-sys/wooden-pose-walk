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
} from "three";
import type { WebGLProgramParametersWithUniforms } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WoodenMannequin } from "./mannequin";
import { createWoodMaps } from "./wood";

/** Chin-to-crown on the mannequin, in meters. */
const FACE_HEIGHT = 0.2;

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

function blendNeckIntoWood(
  material: MeshPhysicalMaterial,
  woodMap: Texture,
  clipBottom: number,
  skinStart: number,
  neckRadius: number,
): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.woodMap = { value: woodMap };
    shader.uniforms.neckClip = { value: new Vector2(clipBottom, skinStart) };
    shader.uniforms.neckRadius = { value: neckRadius };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vFacePos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFacePos = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D woodMap;
        uniform vec2 neckClip;
        uniform float neckRadius;
        varying vec3 vFacePos;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        float neckBand = smoothstep(neckClip.x, neckClip.y, vFacePos.y);
        float radial = length(vFacePos.xz);
        float maxR = mix(neckRadius * 0.92, neckRadius * 2.6, neckBand);
        if (vFacePos.y < neckClip.x || radial > maxR) discard;
        float nape = smoothstep(0.35, -0.15, vFacePos.z) * (1.0 - neckBand);
        float keepSkin = clamp(neckBand * (1.0 - nape * 0.9), 0.0, 1.0);
        if (keepSkin < 0.05) discard;
        vec3 woodC = texture2D(woodMap, vFacePos.xz * 0.35 + 0.5).rgb;
        gl_FragColor.rgb = mix(woodC, gl_FragColor.rgb, keepSkin);
        `,
      );
  };
  material.customProgramCacheKey = () => "face-neck-blend-v2";
}

/**
 * Lee Perry-Smith Infinite 3D Head Scan (CC BY 3.0).
 * Shoulders and extra bust are clipped. The remaining neck fades
 * into walnut inside the mannequin socket.
 */
interface FaceAssets {
  mesh: Mesh;
  color: Texture;
  normal: Texture;
  displacement: Texture;
  roughness: CanvasTexture;
  woodMap: Texture;
}

let faceAssets: Promise<FaceAssets> | null = null;

function loadFaceAssets(): Promise<FaceAssets> {
  if (!faceAssets) {
    const base = import.meta.env.BASE_URL;
    faceAssets = Promise.all([
      new GLTFLoader().loadAsync(`${base}models/face/LeePerrySmith.glb`),
      loadTexture(`${base}models/face/color.jpg`, true),
      loadTexture(`${base}models/face/spec.jpg`, false),
      loadTexture(`${base}models/face/normal.jpg`, false),
      loadTexture(`${base}models/face/displacement.jpg`, false),
    ]).then(([gltf, color, spec, normal, displacement]) => ({
      mesh: firstMesh(gltf.scene),
      color,
      normal,
      displacement,
      roughness: specToRoughness(spec),
      woodMap: createWoodMaps("#c08a4a", 14, "walnut", 256).map,
    }));
  }
  return faceAssets;
}

export async function attachRealisticFace(figure: WoodenMannequin): Promise<Group> {
  const pack = await loadFaceAssets();
  const scan = pack.mesh.clone();
  scan.position.set(0, 0, 0);
  scan.rotation.set(0, 0, 0);
  scan.scale.set(1, 1, 1);
  scan.geometry.computeBoundingBox();
  const bbox = scan.geometry.boundingBox ?? new Box3();
  const ymin = bbox.min.y;
  const ymax = bbox.max.y;
  const span = Math.max(ymax - ymin, 1e-5);
  const xExtent = Math.max(bbox.max.x - bbox.min.x, 1e-5);

  // Drop the lower ~40% (wide neck stump / bust cut). Fade through the throat.
  const clipBottom = ymin + span * 0.4;
  const skinStart = ymin + span * 0.56;
  const visible = ymax - clipBottom;

  const material = new MeshPhysicalMaterial({
    name: "skin",
    map: pack.color,
    normalMap: pack.normal,
    normalScale: new Vector2(0.95, 0.95),
    roughnessMap: pack.roughness,
    roughness: 0.44,
    metalness: 0,
    displacementMap: pack.displacement,
    displacementScale: 0.0024,
    displacementBias: -0.0008,
    sheen: 0.42,
    sheenColor: new Color("#c47a5a"),
    sheenRoughness: 0.4,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.62,
  });
  blendNeckIntoWood(material, pack.woodMap, clipBottom, skinStart, xExtent * 0.38);
  scan.material = material;
  scan.castShadow = true;
  scan.receiveShadow = true;

  const scale = FACE_HEIGHT / visible;
  const wrapper = new Group();
  wrapper.name = "face";
  wrapper.add(scan);
  wrapper.scale.setScalar(scale);
  // Collar lip sits near head y = 0.018. Put the fade band in that cup.
  wrapper.position.set(0, 0.018 - skinStart * scale, 0.006);

  if (figure.skull) figure.skull.visible = false;
  figure.bone("head").add(wrapper);
  figure.refreshWorld();
  return wrapper;
}
