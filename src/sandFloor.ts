import {
  BufferAttribute,
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  NoColorSpace,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { debugMode, graphicsTier } from "./quality";

/**
 * Level-1 sand floor. Grain families, voronoi shape, and roughness follow
 * the deformable-sand skill (MIT, © 2026 Scott Sun). The gallery's WebGPU
 * heightfield (512², airborne grains, wave reset) is too heavy for this
 * walkable room, so this tier bakes the grain PBR and runs a CPU repose
 * heightfield that footprints can push.
 *
 * Grain pitch is enlarged to about 6 mm so the mineral speckle still reads
 * from the orbit camera. The GPL coconut-tree gallery asset is not included.
 */
const TILE = 0.32;
const GRAINS = 48;
const REPOSE = 0.625;
const SIZE = 18;

export interface FootPlant {
  x: number;
  z: number;
  planted: boolean;
}

function hash2(ix: number, iy: number): [number, number] {
  const x = ((ix % GRAINS) + GRAINS) % GRAINS;
  const y = ((iy % GRAINS) + GRAINS) % GRAINS;
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  const a = ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  let m = Math.imul(x + 19, 1274126177) + Math.imul(y + 7, 668265263);
  m = Math.imul(m ^ (m >>> 13), 374761393);
  const b = ((m ^ (m >>> 16)) >>> 0) / 4294967295;
  return [a, b];
}

function materialForGrain(seedX: number, seedY: number, composition: number): {
  albedo: [number, number, number];
  roughness: number;
} {
  const family = (seedX + (composition - 0.5) * 0.085) % 1;
  let albedo: [number, number, number] = [0.67, 0.51, 0.3];
  let roughness = 0.5;
  if (family < 0.36) {
    albedo = [0.72, 0.57, 0.35];
    roughness = 0.38;
  } else if (family < 0.66) {
    albedo = [0.65, 0.48, 0.27];
    roughness = 0.48;
  } else if (family < 0.82) {
    albedo = [0.75, 0.6, 0.38];
    roughness = 0.31;
  } else if (family < 0.92) {
    albedo = [0.54, 0.34, 0.18];
    roughness = 0.58;
  } else if (family < 0.972) {
    albedo = [0.43, 0.27, 0.15];
    roughness = 0.63;
  } else {
    albedo = [0.22, 0.17, 0.12];
    roughness = 0.69;
  }
  const tint = (seedY - 0.5) * 0.1;
  albedo = [
    albedo[0] * (1 + tint),
    albedo[1] * (1 + tint * 0.52),
    albedo[2] * (1 - tint * 0.45),
  ];
  roughness = Math.min(0.76, Math.max(0.24, roughness + (seedY - 0.5) * 0.1));
  return { albedo, roughness };
}

interface GrainLook {
  edge: number;
  roundness: number;
  axisX: number;
  axisY: number;
  shapedX: number;
  shapedY: number;
  seedX: number;
  seedY: number;
  cellX: number;
  cellY: number;
  colorX: number;
}

function grainAppearance(u: number, v: number): GrainLook {
  const coordX = u * GRAINS;
  const coordY = v * GRAINS;
  const tau = Math.PI * 2;
  const waveA = Math.sin(((coordX * 3 + coordY * 5) * tau) / GRAINS + 1.37);
  const waveB = Math.sin(((-coordX * 4 + coordY * 2) * tau) / GRAINS - 0.82);
  const warpedX = coordX + waveA * 0.14;
  const warpedY = coordY + waveB * 0.14;
  const baseX = Math.floor(warpedX);
  const baseY = Math.floor(warpedY);
  let nearest = 100;
  let second = 100;
  let shapedX = 0;
  let shapedY = 0;
  let axisX = 1;
  let axisY = 0;
  let colorX = 0.5;
  let cellX = 0;
  let cellY = 0;
  let seedX = 0.5;
  let seedY = 0.5;
  for (let row = -1; row <= 1; row++) {
    for (let column = -1; column <= 1; column++) {
      const cellXi = baseX + column;
      const cellYi = baseY + row;
      const random = hash2(cellXi, cellYi);
      const centerX = cellXi + (0.16 + 0.68 * random[0]);
      const centerY = cellYi + (0.16 + 0.68 * random[1]);
      const offsetX = warpedX - centerX;
      const offsetY = warpedY - centerY;
      const horizontal = random[0] * 2 - 1;
      const verticalMag = Math.max(0.08, 1 - Math.abs(horizontal));
      const vertical = random[1] >= 0.5 ? verticalMag : -verticalMag;
      const axisLen = Math.hypot(horizontal, vertical) || 1;
      const ax = horizontal / axisLen;
      const ay = vertical / axisLen;
      const px = -ay;
      const py = ax;
      const aspectSeed = (random[0] * 5.37 + random[1] * 7.91) % 1;
      const aspect = 0.78 + (1.27 - 0.78) * aspectSeed;
      const localX = (offsetX * ax + offsetY * ay) / aspect;
      const localY = (offsetX * px + offsetY * py) * aspect;
      const distance = localX * localX + localY * localY;
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        shapedX = localX;
        shapedY = localY;
        axisX = ax;
        axisY = ay;
        colorX = random[0];
        cellX = cellXi;
        cellY = cellYi;
        const materialSeed = hash2(cellXi + 87, cellYi + 31);
        seedX = materialSeed[0];
        seedY = materialSeed[1];
      } else {
        second = Math.min(second, distance);
      }
    }
  }
  const boundary = Math.sqrt(second) - Math.sqrt(nearest);
  const rawRoundness = Math.sqrt(Math.max(0, 1 - Math.min(nearest / 0.44, 1)));
  const angularity = rawRoundness * (1 - seedY * 0.46) + smoothstep(0.04, 0.96, rawRoundness) * seedY * 0.46;
  return {
    edge: smoothstep(0.014, 0.145, boundary),
    roundness: angularity,
    axisX,
    axisY,
    shapedX,
    shapedY,
    seedX,
    seedY,
    cellX,
    cellY,
    colorX,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function bakeSand(size: number): { albedo: CanvasTexture; normal: CanvasTexture; rough: CanvasTexture; ao: CanvasTexture } {
  const albedo = document.createElement("canvas");
  const normal = document.createElement("canvas");
  const rough = document.createElement("canvas");
  const ao = document.createElement("canvas");
  for (const canvas of [albedo, normal, rough, ao]) {
    canvas.width = size;
    canvas.height = size;
  }
  const albedoCtx = albedo.getContext("2d");
  const normalCtx = normal.getContext("2d");
  const roughCtx = rough.getContext("2d");
  const aoCtx = ao.getContext("2d");
  if (!albedoCtx || !normalCtx || !roughCtx || !aoCtx) throw new Error("Could not bake sand");
  const ia = albedoCtx.createImageData(size, size);
  const inrm = normalCtx.createImageData(size, size);
  const ir = roughCtx.createImageData(size, size);
  const iao = aoCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const grain = grainAppearance(u, v);
      const composition = hash2(Math.floor(grain.cellX / 42) + 41, Math.floor(grain.cellY / 42) + 67)[0];
      const material = materialForGrain(grain.seedX, grain.seedY, composition);
      const edge = grain.edge;
      const macro =
        0.94 +
        0.06 * Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI * 6);
      const shade = (0.64 + 0.36 * edge) * macro;
      const o = (y * size + x) * 4;
      ia.data[o] = Math.min(255, material.albedo[0] * shade * 255);
      ia.data[o + 1] = Math.min(255, material.albedo[1] * shade * 255);
      ia.data[o + 2] = Math.min(255, material.albedo[2] * shade * 255);
      ia.data[o + 3] = 255;
      const perpX = -grain.axisY;
      const perpY = grain.axisX;
      const radialX = grain.axisX * grain.shapedX + perpX * grain.shapedY;
      const radialY = grain.axisY * grain.shapedX + perpY * grain.shapedY;
      const facetScale = 0.34 + grain.roundness * 0.46;
      let nx = radialX * facetScale + (grain.seedX - 0.5) * 0.34;
      let nz = radialY * facetScale + (grain.seedY - 0.5) * 0.34;
      let ny = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      inrm.data[o] = (nx * 0.5 + 0.5) * 255;
      inrm.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      inrm.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      inrm.data[o + 3] = 255;
      const rv = Math.min(255, Math.max(0, material.roughness * 255));
      ir.data[o] = ir.data[o + 1] = ir.data[o + 2] = rv;
      ir.data[o + 3] = 255;
      const aov = Math.min(255, Math.max(0, (0.62 + 0.38 * edge) * 255));
      iao.data[o] = iao.data[o + 1] = iao.data[o + 2] = aov;
      iao.data[o + 3] = 255;
    }
  }
  const upload = (
    canvas: HTMLCanvasElement,
    image: ImageData,
    ctx: CanvasRenderingContext2D,
    color: boolean,
  ): CanvasTexture => {
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    const repeat = SIZE / TILE;
    texture.repeat.set(repeat, repeat);
    return texture;
  };
  return {
    albedo: upload(albedo, ia, albedoCtx, true),
    normal: upload(normal, inrm, normalCtx, false),
    rough: upload(rough, ir, roughCtx, false),
    ao: upload(ao, iao, aoCtx, false),
  };
}

function dune(x: number, z: number): number {
  return (
    Math.sin(x * 0.42) * Math.cos(z * 0.36) * 0.01 +
    Math.sin((x + z) * 1.15) * 0.004
  );
}

export class SandFloor {
  readonly mesh: Mesh;
  private readonly segments: number;
  private readonly base: Float32Array;
  private readonly dynamic: Float32Array;
  private readonly wasPlanted: boolean[] = [];
  private settle = 0;
  private readonly heightDebug: boolean;

  constructor() {
    const tier = graphicsTier();
    this.segments = tier === "mobile" ? 110 : 180;
    this.heightDebug = debugMode("sand") === "height";
    const grid = this.segments + 1;
    this.base = new Float32Array(grid * grid);
    this.dynamic = new Float32Array(grid * grid);
    const half = SIZE / 2;
    const cell = SIZE / this.segments;
    for (let iy = 0; iy < grid; iy++) {
      const wz = -half + iy * cell;
      for (let ix = 0; ix < grid; ix++) {
        const wx = -half + ix * cell;
        this.base[iy * grid + ix] = dune(wx, wz);
      }
    }

    const geometry = new PlaneGeometry(SIZE, SIZE, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);
    const maps = bakeSand(tier === "mobile" ? 384 : 512);
    const material = new MeshPhysicalMaterial({
      name: "level-1-sand",
      map: maps.albedo,
      normalMap: maps.normal,
      roughnessMap: maps.rough,
      aoMap: maps.ao,
      aoMapIntensity: 0.8,
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.42,
      vertexColors: this.heightDebug,
    });
    if (this.heightDebug) {
      geometry.setAttribute("color", new BufferAttribute(new Float32Array(grid * grid * 3), 3));
    }
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = "level-1-sand";
    this.mesh.receiveShadow = true;
    const uv = geometry.getAttribute("uv");
    if (uv) geometry.setAttribute("uv2", uv.clone());
    this.writeHeights();
    geometry.computeTangents();
  }

  heightAt(x: number, z: number): number {
    const grid = this.segments + 1;
    const half = SIZE / 2;
    const fx = ((x + half) / SIZE) * this.segments;
    const fz = ((z + half) / SIZE) * this.segments;
    if (fx < 0 || fz < 0 || fx >= this.segments || fz >= this.segments) return 0;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h = (ix: number, iz: number): number => {
      const i = iz * grid + ix;
      return (this.base[i] ?? 0) + (this.dynamic[i] ?? 0);
    };
    const a = h(x0, z0) * (1 - tx) + h(x0 + 1, z0) * tx;
    const b = h(x0, z0 + 1) * (1 - tx) + h(x0 + 1, z0 + 1) * tx;
    return a * (1 - tz) + b * tz;
  }

  /** Planted feet leave a shallow print and a berm that slumps at the repose angle. */
  step(feet: readonly FootPlant[]): void {
    let stamped = false;
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i]!;
      if (foot.planted && !this.wasPlanted[i]) {
        this.stamp(foot.x, foot.z, 0.09, 0.012);
        stamped = true;
      }
      this.wasPlanted[i] = foot.planted;
    }
    if (stamped) this.settle = 10;
    if (this.settle > 0) {
      this.repose();
      this.settle -= 1;
      this.writeHeights();
    }
  }

  private stamp(x: number, z: number, radius: number, depth: number): void {
    const grid = this.segments + 1;
    const half = SIZE / 2;
    const cell = SIZE / this.segments;
    const minX = Math.max(0, Math.floor((x - radius * 1.45 + half) / cell));
    const maxX = Math.min(this.segments, Math.ceil((x + radius * 1.45 + half) / cell));
    const minZ = Math.max(0, Math.floor((z - radius * 1.45 + half) / cell));
    const maxZ = Math.min(this.segments, Math.ceil((z + radius * 1.45 + half) / cell));
    let removed = 0;
    let rim = 0;
    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = -half + ix * cell;
        const wz = -half + iz * cell;
        const d = Math.hypot(wx - x, wz - z) / radius;
        const i = iz * grid + ix;
        if (d < 1) {
          const fall = (1 - d * d) * (1 - d * 0.25);
          const before = this.dynamic[i] ?? 0;
          const next = Math.max(-0.028, before - depth * fall);
          this.dynamic[i] = next;
          removed += before - next;
        } else if (d < 1.4) {
          rim += 1;
        }
      }
    }
    if (rim <= 0 || removed <= 0) return;
    const share = removed / rim;
    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = -half + ix * cell;
        const wz = -half + iz * cell;
        const d = Math.hypot(wx - x, wz - z) / radius;
        if (d >= 1 && d < 1.4) {
          const i = iz * grid + ix;
          const ring = 1 - Math.abs(d - 1.2) / 0.2;
          this.dynamic[i] = Math.min(0.02, (this.dynamic[i] ?? 0) + share * Math.max(ring, 0.25));
        }
      }
    }
  }

  private repose(): void {
    const grid = this.segments + 1;
    const cell = SIZE / this.segments;
    const limit = REPOSE * cell;
    const height = (i: number): number => (this.base[i] ?? 0) + (this.dynamic[i] ?? 0);
    for (let iz = 0; iz < this.segments; iz++) {
      for (let ix = 0; ix < this.segments; ix++) {
        const i = iz * grid + ix;
        const h = height(i);
        for (const [jx, jz] of [
          [ix + 1, iz],
          [ix, iz + 1],
        ] as const) {
          const j = jz * grid + jx;
          const diff = h - height(j);
          if (diff > limit) {
            const transfer = (diff - limit) * 0.25;
            this.dynamic[i] = (this.dynamic[i] ?? 0) - transfer;
            this.dynamic[j] = (this.dynamic[j] ?? 0) + transfer;
          } else if (-diff > limit) {
            const transfer = (-diff - limit) * 0.25;
            this.dynamic[i] = (this.dynamic[i] ?? 0) + transfer;
            this.dynamic[j] = (this.dynamic[j] ?? 0) - transfer;
          }
        }
      }
    }
  }

  private writeHeights(): void {
    const geometry = this.mesh.geometry;
    if (!(geometry instanceof PlaneGeometry)) return;
    const pos = geometry.attributes.position;
    const color = geometry.getAttribute("color");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const y = (this.base[i] ?? 0) + (this.dynamic[i] ?? 0);
      pos.setY(i, y);
      if (color && this.heightDebug) {
        const t = Math.min(1, Math.max(0, (y + 0.028) / 0.05));
        color.setXYZ(i, t, t * t, 1 - t);
      }
    }
    pos.needsUpdate = true;
    if (color) color.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}
