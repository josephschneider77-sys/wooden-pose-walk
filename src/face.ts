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
import type { WebGLProgramParametersWithUniforms } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WoodenMannequin } from "./mannequin";
import { createWoodMaps } from "./wood";

const HEAD_HEIGHT = 0.228;

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
): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.woodMap = { value: woodMap };
    shader.uniforms.neckClip = { value: new Vector2(clipBottom, skinStart) };

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
        varying vec3 vFacePos;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        float neckBand = smoothstep(neckClip.x, neckClip.y, vFacePos.y);
        float nape = smoothstep(0.05, -0.03, vFacePos.z) * (1.0 - smoothstep(neckClip.y, neckClip.y + 0.05, vFacePos.y));
        float keepSkin = clamp(neckBand * (1.0 - nape * 0.88), 0.0, 1.0);
        if (keepSkin < 0.045) discard;
        vec3 woodC = texture2D(woodMap, vFacePos.xz * 3.4 + 0.5).rgb;
        gl_FragColor.rgb = mix(woodC, gl_FragColor.rgb, keepSkin);
        `,
      );
  };
  material.customProgramCacheKey = () => "face-neck-blend";
}

/**
 * Lee Perry-Smith Infinite 3D Head Scan (CC BY 3.0).
 * Seated in a wooden neck socket; the lower neck fades into walnut.
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
  const wood = createWoodMaps("#c08a4a", 14, "walnut", 256);
  const material = new MeshPhysicalMaterial({
    name: "skin",
    map: color,
    normalMap: normal,
    normalScale: new Vector2(0.95, 0.95),
    roughnessMap,
    roughness: 0.44,
    metalness: 0,
    displacementMap: displacement,
    displacementScale: 0.0032,
    displacementBias: -0.001,
    sheen: 0.42,
    sheenColor: new Color("#c47a5a"),
    sheenRoughness: 0.4,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.62,
  });
  scan.material = material;
  scan.castShadow = true;
  scan.receiveShadow = true;

  gltf.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  scan.position.sub(center);
  scan.position.y += size.y * 0.015;

  const local = new Box3().setFromCenterAndSize(
    new Vector3(0, size.y * 0.015, 0),
    size,
  );
  const yMin = local.min.y;
  const span = size.y;
  blendNeckIntoWood(material, wood.map, yMin + span * 0.06, yMin + span * 0.3);

  const wrapper = new Group();
  wrapper.name = "face";
  wrapper.add(gltf.scene);
  wrapper.scale.setScalar(HEAD_HEIGHT / Math.max(size.y, 1e-5));
  wrapper.position.set(0, 0.05, 0.008);

  if (figure.skull) figure.skull.visible = false;
  figure.bone("head").add(wrapper);
  figure.refreshWorld();
  return wrapper;
}
