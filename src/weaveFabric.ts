import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  Vector2,
} from "three";

/**
 * Plain-weave linen maps from the simulated-cloth skill
 * (scottstts/Threejs-Awesome-Graphics-Agent-Skills, MIT, © 2026 Scott Sun).
 * Yarn crowns, slubs, hem, roughness, and AO share one height field.
 * Dye is charcoal cloak wool instead of the gallery's flax.
 */
const YARNS = 72;

function hash2(i: number, j: number): number {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export interface WeaveMaps {
  albedo: Texture;
  normal: Texture;
  rough: Texture;
  ao: Texture;
  normalScale: Vector2;
}

export function createCloakWeave(size = 512): WeaveMaps {
  const pitch = 1;
  const yarnR = pitch * 0.34;
  const height = new Float32Array(size * size);

  const sampleH = (u: number, v: number): number => {
    const uu = u - Math.floor(u);
    const vv = v - Math.floor(v);
    const fu = uu * YARNS;
    const fv = vv * YARNS;
    const iu = Math.floor(fu);
    const iv = Math.floor(fv);
    const au = fu - iu;
    const av = fv - iv;
    const warpTop = ((iu + iv) & 1) === 0;
    const slubW = 1 + (hash2(iu, 3) - 0.5) * 0.18;
    const slubF = 1 + (hash2(7, iv) - 0.5) * 0.18;
    const profile = (t: number, rad: number): number => {
      const d = (t - 0.5) * pitch;
      const r = yarnR * rad;
      if (Math.abs(d) >= r) return 0;
      const x = d / r;
      return Math.sqrt(Math.max(0, 1 - x * x)) * r;
    };
    const hw = profile(au, slubW);
    const hf = profile(av, slubF);
    const h = warpTop ? Math.max(hw, hf * 0.28) : Math.max(hf, hw * 0.28);
    const fiber =
      (hash2(iu * 13 + Math.floor(au * 48), iv * 17 + Math.floor(av * 48)) - 0.5) * yarnR * 0.08;
    return h + fiber;
  };

  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      height[y * size + x] = sampleH((x + 0.5) / size, v);
    }
  }

  const albedo = document.createElement("canvas");
  const normal = document.createElement("canvas");
  const rough = document.createElement("canvas");
  const ao = document.createElement("canvas");
  for (const canvas of [albedo, normal, rough, ao]) {
    canvas.width = size;
    canvas.height = size;
  }
  const albedoCtx = albedo.getContext("2d", { willReadFrequently: true });
  const normalCtx = normal.getContext("2d", { willReadFrequently: true });
  const roughCtx = rough.getContext("2d", { willReadFrequently: true });
  const aoCtx = ao.getContext("2d", { willReadFrequently: true });
  if (!albedoCtx || !normalCtx || !roughCtx || !aoCtx) {
    throw new Error("Could not bake the cloak weave");
  }
  const ia = albedoCtx.createImageData(size, size);
  const inrm = normalCtx.createImageData(size, size);
  const ir = roughCtx.createImageData(size, size);
  const iao = aoCtx.createImageData(size, size);
  const du = 1 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x + size - 1) % size;
      const xp = (x + 1) % size;
      const ym = (y + size - 1) % size;
      const yp = (y + 1) % size;
      const hL = height[y * size + xm] ?? 0;
      const hR = height[y * size + xp] ?? 0;
      const hD = height[ym * size + x] ?? 0;
      const hU = height[yp * size + x] ?? 0;
      const dHdX = (hR - hL) / (2 * du);
      const dHdZ = (hD - hU) / (2 * du);
      let nx = -dHdX;
      let ny = -dHdZ;
      let nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const h = height[y * size + x] ?? 0;
      const u = (x + 0.5) / size;
      const v = 1 - (y + 0.5) / size;
      const fu = u * YARNS;
      const fv = v * YARNS;
      const iu = Math.floor(fu);
      const iv = Math.floor(fv);
      const warpTop = ((iu + iv) & 1) === 0;
      const nA = hash2(iu, iv);
      const nB = hash2(iu + 19, iv + 5);
      const slow = hash2(iu >> 3, iv >> 3);
      let r = warpTop ? 78 : 52;
      let g = warpTop ? 70 : 48;
      let b = warpTop ? 64 : 44;
      const dye = (nA - 0.5) * 16 + (slow - 0.5) * 10;
      r = Math.min(255, Math.max(0, r + dye));
      g = Math.min(255, Math.max(0, g + dye * 0.82));
      b = Math.min(255, Math.max(0, b + dye * 0.55));
      const hem = Math.min(u, 1 - u, v, 1 - v);
      const hemDark = hem < 0.012 ? 0.72 : 1;
      const shade = 0.62 + 0.38 * Math.min(1, h / (yarnR * 0.95));
      const o = (y * size + x) * 4;
      ia.data[o] = r * shade * hemDark;
      ia.data[o + 1] = g * shade * hemDark;
      ia.data[o + 2] = b * shade * hemDark;
      ia.data[o + 3] = 255;
      inrm.data[o] = (nx * 0.5 + 0.5) * 255;
      inrm.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      inrm.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      inrm.data[o + 3] = 255;
      const crown = Math.min(1, h / (yarnR * 0.9));
      const roughness = 0.93 - crown * 0.34 + (nB - 0.5) * 0.04;
      const rv = Math.min(255, Math.max(0, roughness * 255));
      ir.data[o] = ir.data[o + 1] = ir.data[o + 2] = rv;
      ir.data[o + 3] = 255;
      const aov = Math.min(255, Math.max(0, (0.48 + 0.52 * crown) * 255));
      iao.data[o] = iao.data[o + 1] = iao.data[o + 2] = aov;
      iao.data[o + 3] = 255;
    }
  }

  const upload = (
    canvas: HTMLCanvasElement,
    image: ImageData,
    ctx: CanvasRenderingContext2D,
    colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
  ): Texture => {
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  };

  return {
    albedo: upload(albedo, ia, albedoCtx, SRGBColorSpace),
    normal: upload(normal, inrm, normalCtx, NoColorSpace),
    rough: upload(rough, ir, roughCtx, NoColorSpace),
    ao: upload(ao, iao, aoCtx, NoColorSpace),
    normalScale: new Vector2(0.8, 0.8),
  };
}
