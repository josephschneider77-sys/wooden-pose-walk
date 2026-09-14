import { Vector3 } from "three";

export interface Disc {
  x: number;
  z: number;
  r: number;
}

/** Keep the figure outside solid props so meshes do not occupy the same spot. */
export function keepOffDiscs(pos: Vector3, discs: readonly Disc[], pad = 0.32): void {
  for (const disc of discs) {
    const dx = pos.x - disc.x;
    const dz = pos.z - disc.z;
    const need = disc.r + pad;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6) {
      pos.x += need;
      continue;
    }
    if (d2 < need * need) {
      const d = Math.sqrt(d2);
      pos.x = disc.x + (dx / d) * need;
      pos.z = disc.z + (dz / d) * need;
    }
  }
}
