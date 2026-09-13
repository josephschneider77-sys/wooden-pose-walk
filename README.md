# Mannequin Walk

A playable figure-study demo: a **wooden artist’s pose mannequin** walks across a studio floor when you tap or click. Legs are solved with Daniel Holden’s two-bone IK and runtime **toe** foot locking (inertialization), so planted feet stay put instead of skating with raw root motion.

Built for the browser with Vite, TypeScript, and Three.js. The figure is procedural (wood-grain segments and ball joints) — no downloaded character mesh.

## Controls

- **Tap / click the floor** — walk there
- **Drag** — orbit the camera
- **Scroll / pinch** — zoom
- **Two-bone leg IK** — Holden-style heel placement from a toe target (soft max extension, knee side vector, no pole vector)
- **Toe foot lock** — lock the toe to its contact point while the foot is planted; unlock with distance / contact rules; cubic inertialization blends
- **Ground height clamp** — keep heels / toes from sinking
- **Show contact markers** — gold / blue dots on the current toe targets

Turn IK or lock off to compare against the raw procedural walk cycle.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default port **43217**, path `/wooden-pose-walk/`).

```bash
npm run build
npm run preview
```

## Play

https://josephschneider77-sys.github.io/wooden-pose-walk/

Source of truth stays on Origin. The public play link is GitHub Pages from [`josephschneider77-sys/wooden-pose-walk`](https://github.com/josephschneider77-sys/wooden-pose-walk) (`gh-pages` branch + Actions). Vite `base` is `/wooden-pose-walk/`.

## How the feet work

The walk cycle is a source pose (procedural). Inverse kinematics is applied as a **modification**, not a replacement:

1. Compute a heel target from the desired toe (preserve the current heel–toe offset).
2. Two-bone IK places the heel, with a soft clamp so the leg never extends past the source pose (avoids a T-rex hip pull-down).
3. Orient the heel toward the toe target, then the toe toward the toe-end, with a ground-height clamp.
4. While a foot is in contact, lock the **toe** (not the heel) to the contact point and blend with cubic inertialization.

Recipes follow [Inverse Kinematics and Foot Locking](https://theorangeduck.com/page/inverse-kinematics-foot-locking) by Daniel Holden / Orange Duck. Offline PBD locking and organ-label anatomy quiz are out of scope for this slice.

## Credits

- Animation / IK methods: [Daniel Holden](https://theorangeduck.com/page/inverse-kinematics-foot-locking) (Orange Duck)
- Engine: [Three.js](https://threejs.org/) (MIT)
- Character: original procedural wooden mannequin in this repo (no third-party mesh)
