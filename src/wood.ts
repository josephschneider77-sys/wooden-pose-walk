import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

function shade(hex: string, amount: number): string {
  const c = new Color(hex);
  if (amount >= 0) {
    c.lerp(new Color("#fff6e8"), amount);
  } else {
    c.lerp(new Color("#2a160c"), -amount);
  }
  return `#${c.getHexString()}`;
}

function paintGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: string,
  seed: number,
): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 48; i++) {
    const x = ((seed * 37 + i * 53) % width) + (i % 7) * 3;
    const wobble = 8 + ((seed + i * 13) % 18);
    ctx.strokeStyle = shade(base, i % 2 === 0 ? -0.18 : 0.12);
    ctx.globalAlpha = 0.18 + ((i * 7) % 10) / 70;
    ctx.lineWidth = 1 + (i % 4);
    ctx.beginPath();
    ctx.moveTo(x, -10);
    for (let y = 0; y <= height + 10; y += 12) {
      ctx.lineTo(x + Math.sin((y + seed) * 0.035 + i) * wobble, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 30; i++) {
    const y = (i * 97 + seed) % height;
    ctx.fillStyle = shade(base, i % 3 === 0 ? 0.2 : -0.22);
    ctx.fillRect(0, y, width, 2);
  }

  ctx.globalAlpha = 0.09;
  for (let i = 0; i < 12; i++) {
    const x = (i * 41 + seed * 3) % width;
    const y = (i * 73 + seed) % height;
    ctx.fillStyle = shade(base, -0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createWoodTexture(
  base = "#c08a4a",
  seed = 11,
  size = 512,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create wood grain canvas");
  }
  paintGrain(ctx, size, size, base, seed);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export function createWoodMaterial(
  options: {
    base?: string;
    seed?: number;
    repeatX?: number;
    repeatY?: number;
    roughness?: number;
    clearcoat?: number;
  } = {},
): MeshPhysicalMaterial {
  const map = createWoodTexture(options.base ?? "#c08a4a", options.seed ?? 11);
  map.repeat.set(options.repeatX ?? 1.4, options.repeatY ?? 2.2);
  return new MeshPhysicalMaterial({
    map,
    color: "#e8c089",
    roughness: options.roughness ?? 0.42,
    metalness: 0,
    clearcoat: options.clearcoat ?? 0.38,
    clearcoatRoughness: 0.28,
    sheen: 0.12,
    sheenColor: new Color("#d7a05a"),
  });
}

export function createJointMaterial(): MeshPhysicalMaterial {
  return createWoodMaterial({
    base: "#8f5a2b",
    seed: 29,
    repeatX: 0.8,
    repeatY: 0.8,
    roughness: 0.32,
    clearcoat: 0.55,
  });
}

function paintBlackCloth(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? "#111111" : "#070707";
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, y, width, 1);
  }
  for (let x = 0; x < width; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? "#121212" : "#080808";
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, 0, 1, height);
  }

  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 52;
    const grad = ctx.createLinearGradient(x - 18, 0, x + 18, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.85)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 18, 0, 36, height);
  }

  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1a1a1a" : "#000000";
    ctx.fillRect((i * 37) % width, (i * 61) % height, 3, 8);
  }
  ctx.globalAlpha = 1;
}

export function createCloakMaterial(): MeshPhysicalMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create cloak cloth canvas");
  }
  paintBlackCloth(ctx, 512, 512);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(2.2, 3.1);
  map.anisotropy = 8;
  return new MeshPhysicalMaterial({
    map,
    color: "#0d0d0d",
    roughness: 0.98,
    metalness: 0,
    clearcoat: 0,
    sheen: 0,
    side: DoubleSide,
  });
}
