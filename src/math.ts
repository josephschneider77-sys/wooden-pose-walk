import { Quaternion, Vector3 } from "three";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / Math.max(edge1 - edge0, 1e-8));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function wrap01(value: number): number {
  return value - Math.floor(value);
}

export function shortestAngle(from: number, to: number): number {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function quaternionExp(v: Vector3, out = new Quaternion()): Quaternion {
  const halfAngle = v.length();
  if (halfAngle < 1e-4) {
    return out.set(v.x, v.y, v.z, 1).normalize();
  }
  const c = Math.cos(halfAngle);
  const s = Math.sin(halfAngle) / halfAngle;
  return out.set(s * v.x, s * v.y, s * v.z, c);
}

export function quaternionFromScaledAngleAxis(
  axisTimesAngle: Vector3,
  out = new Quaternion(),
): Quaternion {
  return quaternionExp(axisTimesAngle.clone().multiplyScalar(0.5), out);
}

/** Raylib-style QuaternionBetween: shortest rotation taking p onto q. */
export function quaternionBetween(
  p: Vector3,
  q: Vector3,
  out = new Quaternion(),
): Quaternion {
  const c = new Vector3().crossVectors(p, q);
  const w = Math.sqrt(p.lengthSq() * q.lengthSq()) + p.dot(q);
  out.set(c.x, c.y, c.z, w);
  if (out.length() < 1e-8) {
    return out.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  }
  return out.normalize();
}
