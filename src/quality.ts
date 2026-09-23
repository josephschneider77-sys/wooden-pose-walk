export type GraphicsTier = "mobile" | "desktop";

/**
 * WebGL2 quality tier. The skills pack's cloth, fur, and sand examples are
 * WebGPU-only at gallery resolution; this demo keeps their mechanisms and
 * drops the resolution so a phone-class GPU stays interactive.
 */
export function graphicsTier(): GraphicsTier {
  const cores = navigator.hardwareConcurrency || 8;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 760;
  if (coarse || narrow || cores <= 4) return "mobile";
  return "desktop";
}

/** Visual debug from the query string: `?cloth=wire`, `?fur=base`, `?sand=height`. */
export function debugMode(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}
