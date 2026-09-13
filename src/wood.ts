import {
  CanvasTexture,
  Color,
  LinearFilter,
  MeshPhysicalMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { lerp, saturate, smootherstep } from "./math";

export type WoodKind = "walnut" | "ebony" | "beech" | "floor";

/** Gallery-frame response bundles from the Three.js graphics skills. */
const IDENTITY: Record<
  WoodKind,
  {
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    bump: number;
    sheen: number;
  }
> = {
  walnut: {
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.62,
    clearcoatRoughness: 0.28,
    bump: 0.022,
    sheen: 0.16,
  },
  ebony: {
    roughness: 0.4,
    metalness: 0.03,
    clearcoat: 0.7,
    clearcoatRoughness: 0.24,
    bump: 0.018,
    sheen: 0.1,
  },
  beech: {
    roughness: 0.48,
    metalness: 0.02,
    clearcoat: 0.38,
    clearcoatRoughness: 0.34,
    bump: 0.016,
    sheen: 0.12,
  },
  floor: {
    roughness: 0.68,
    metalness: 0.02,
    clearcoat: 0.18,
    clearcoatRoughness: 0.42,
    bump: 0.012,
    sheen: 0.06,
  },
};

function shadeHex(hex: string, amount: number): Color {
  const c = new Color(hex);
  if (amount >= 0) c.lerp(new Color("#fff6e8"), amount);
  else c.lerp(new Color("#1c0e08"), -amount);
  return c;
}

function hash2(ix: number, iy: number, seed: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), u),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), u),
    v,
  );
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 19) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

interface Sample {
  height: number;
  latewood: number;
  pore: number;
  seam: number;
  tint: number;
}

function sampleField(
  x: number,
  y: number,
  size: number,
  seed: number,
  kind: WoodKind,
): Sample {
  const warp =
    fbm(x * 0.018, y * 0.046, seed, 4) * 22 +
    fbm(x * 0.07, y * 0.02, seed + 5, 3) * 7;
  const ring = 0.5 + 0.5 * Math.sin((x + warp) * 0.11 + seed * 0.17);
  const latewood = smootherstep(0.52, 0.93, ring);
  const pore = smootherstep(0.74, 0.96, valueNoise(x * 0.42, y * 0.95, seed + 11));

  let seam = 0;
  let tint = 0;
  if (kind === "floor") {
    const plankW = size / 7;
    const local = ((x % plankW) + plankW) % plankW;
    const edge = Math.min(local, plankW - local);
    seam = 1 - smootherstep(1.2, 6, edge);
    tint = (hash2(Math.floor(x / plankW), 0, seed) - 0.5) * 0.16;
  }

  const fiber = fbm(x * 0.09, y * 0.28, seed + 17, 3);
  const height = saturate(
    0.5 +
      (1 - latewood) * 0.2 -
      latewood * 0.06 -
      pore * 0.14 -
      seam * 0.32 +
      (fiber - 0.5) * 0.08,
  );

  return { height, latewood, pore, seam, tint };
}

function canvasTexture(
  canvas: HTMLCanvasElement,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export function createWoodMaps(
  base: string,
  seed: number,
  kind: WoodKind,
  size = 512,
): { map: CanvasTexture; roughnessMap: CanvasTexture; normalMap: CanvasTexture } {
  const albedo = document.createElement("canvas");
  const rough = document.createElement("canvas");
  const normal = document.createElement("canvas");
  albedo.width = rough.width = normal.width = size;
  albedo.height = rough.height = normal.height = size;
  const aCtx = albedo.getContext("2d");
  const rCtx = rough.getContext("2d");
  const nCtx = normal.getContext("2d");
  if (!aCtx || !rCtx || !nCtx) {
    throw new Error("Could not create wood canvases");
  }

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const nImg = nCtx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const identity = IDENTITY[kind];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sample = sampleField(x, y, size, seed, kind);
      heights[y * size + x] = sample.height;

      const color = shadeHex(base, sample.tint + (1 - sample.latewood) * 0.1 - sample.latewood * 0.2);
      color.lerp(shadeHex(base, -0.38), sample.pore * 0.45);
      color.lerp(new Color("#2a160c"), sample.seam * 0.55);

      const i = (y * size + x) * 4;
      aImg.data[i] = Math.round(color.r * 255);
      aImg.data[i + 1] = Math.round(color.g * 255);
      aImg.data[i + 2] = Math.round(color.b * 255);
      aImg.data[i + 3] = 255;

      const roughness = saturate(
        identity.roughness +
          sample.latewood * 0.16 +
          sample.pore * 0.22 +
          sample.seam * 0.2 -
          (1 - sample.latewood) * 0.07,
      );
      const byte = Math.round(roughness * 255);
      rImg.data[i] = byte;
      rImg.data[i + 1] = byte;
      rImg.data[i + 2] = byte;
      rImg.data[i + 3] = 255;
    }
  }

  const strength = 4.8 * (identity.bump / 0.02);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = heights[y * size + ((x + size - 1) % size)];
      const right = heights[y * size + ((x + 1) % size)];
      const up = heights[((y + size - 1) % size) * size + x];
      const down = heights[((y + 1) % size) * size + x];
      const dx = (right - left) * strength;
      const dy = (down - up) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nImg.data[i] = Math.round((-dx * inv) * 127.5 + 127.5);
      nImg.data[i + 1] = Math.round((-dy * inv) * 127.5 + 127.5);
      nImg.data[i + 2] = Math.round(inv * 127.5 + 127.5);
      nImg.data[i + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);

  return {
    map: canvasTexture(albedo, SRGBColorSpace),
    roughnessMap: canvasTexture(rough, NoColorSpace),
    normalMap: canvasTexture(normal, NoColorSpace),
  };
}

export function createWoodMaterial(
  options: {
    kind?: WoodKind;
    base?: string;
    seed?: number;
    repeatX?: number;
    repeatY?: number;
    roughness?: number;
    clearcoat?: number;
    size?: number;
  } = {},
): MeshPhysicalMaterial {
  const kind = options.kind ?? "walnut";
  const identity = IDENTITY[kind];
  const base =
    options.base ??
    (kind === "ebony" ? "#5c3518" : kind === "floor" ? "#b07a42" : "#c08a4a");
  const maps = createWoodMaps(base, options.seed ?? 11, kind, options.size ?? 512);
  const repeatX = options.repeatX ?? 1.4;
  const repeatY = options.repeatY ?? 2.2;
  maps.map.repeat.set(repeatX, repeatY);
  maps.roughnessMap.repeat.set(repeatX, repeatY);
  maps.normalMap.repeat.set(repeatX, repeatY);

  return new MeshPhysicalMaterial({
    name: `wood-${kind}`,
    map: maps.map,
    roughnessMap: maps.roughnessMap,
    normalMap: maps.normalMap,
    color: "#ffffff",
    roughness: options.roughness ?? identity.roughness,
    metalness: identity.metalness,
    clearcoat: options.clearcoat ?? identity.clearcoat,
    clearcoatRoughness: identity.clearcoatRoughness,
    sheen: identity.sheen,
    sheenRoughness: 0.55,
    sheenColor: shadeHex(base, -0.05),
    envMapIntensity: 0.85,
  });
}

export function createJointMaterial(): MeshPhysicalMaterial {
  return createWoodMaterial({
    kind: "ebony",
    seed: 29,
    repeatX: 0.85,
    repeatY: 0.85,
    size: 256,
  });
}

export function createPlasterMaterial(seed = 3): MeshPhysicalMaterial {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create plaster canvas");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.07, y * 0.07, seed, 4);
      const speckle = hash2(x, y, seed + 4);
      const tone = saturate(0.9 + (n - 0.5) * 0.08 + (speckle > 0.97 ? -0.06 : 0));
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(243 * tone);
      img.data[i + 1] = Math.round(226 * tone);
      img.data[i + 2] = Math.round(198 * tone);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = canvasTexture(canvas, SRGBColorSpace);
  map.repeat.set(2.2, 1.4);
  return new MeshPhysicalMaterial({
    name: "studio-plaster",
    map,
    bumpMap: map,
    bumpScale: 0.024,
    color: "#fff6ea",
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.25,
  });
}
