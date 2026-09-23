# Mannequin Walk

A playable figure-study demo: a **wooden artist’s pose mannequin** in a charcoal cloak and a cozy fur hat walks across a sand floor when you tap or click. Legs are solved with Daniel Holden’s two-bone IK and runtime **toe** foot locking (inertialization), so planted feet stay put instead of skating with raw root motion.

Built for the browser with Vite, TypeScript, and Three.js. The figure is procedural (wood-grain segments and ball joints) — no downloaded character mesh.

## Controls

- **Grab an arm or a leg** — drag it to pose; the limb stays where you put it
- **Tap / click the sand** — walk there
- **Walk into a wooden toy, or tap it** — pick it up. Five toys open the lawn (level 2)
- **Drag empty space** — orbit the camera
- **Scroll / pinch** — zoom

Posed arms stay while walking. Posed legs return when the figure is idle. Refresh the page to reset the pose.

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

### CoS / github.io tip

If project Pages lags, copy the production payload onto the user site at `wooden-pose-walk/`:

- Folder (already the `dist/` contents): [`pages-export/`](pages-export/)
- Zip of that folder: [`wooden-pose-walk-pages.zip`](wooden-pose-walk-pages.zip)

Unzip so files land at `josephschneider77-sys.github.io/wooden-pose-walk/index.html` (not a nested extra `dist/` directory). Include `.nojekyll`.

## How the feet work

The walk cycle is a source pose (procedural). Inverse kinematics is applied as a **modification**, not a replacement:

1. Compute a heel target from the desired toe (preserve the current heel–toe offset).
2. Two-bone IK places the heel, with a soft clamp so the leg never extends past the source pose (avoids a T-rex hip pull-down).
3. Orient the heel toward the toe target, then the toe toward the toe-end, with a ground-height clamp.
4. While a foot is in contact, lock the **toe** (not the heel) to the contact point and blend with cubic inertialization.

Recipes follow [Inverse Kinematics and Foot Locking](https://theorangeduck.com/page/inverse-kinematics-foot-locking) by Daniel Holden / Orange Duck. Offline PBD locking and organ-label anatomy quiz are out of scope for this slice.

## Look

Level 1 is the sand room. The cloak, fur hat, and sand all follow [scottstts/Threejs-Awesome-Graphics-Agent-Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills) (`threejs-procedural-materials`), scaled down so the page stays on WebGL2:

- **Cloak** — plain-weave maps plus a CPU sheet with the simulated-cloth mechanisms: inextensible warp/weft, shear that locks as yarns rotate, soft bending, air drag, and frictional contact on the wooden torso and sand. The gallery solver is a 96×96 WebGPU sheet with a large self-contact hash; this demo uses a 26×32 sheet on desktop and 16×20 on mobile.
- **Fur hat** — shell layers for the dense coat, plus head-local strands that use the simulated-fur Verlet groom and two-lobe ribbon shading. The gallery field is about 420,000 GPU strands; this hat uses 1,500 strands on desktop and 720 on mobile, parented to the head so walk and IK do not tear it off.
- **Sand** — mineral-grain albedo, normal, and roughness from the deformable-sand example, on a CPU heightfield. Walking drags a contact stroke (the skill’s tool segment): the foot and the path excavate, push a berm in the direction of motion, and slump at the dynamic repose slope (0.48 while fresh, 0.625 once it settles). A small pool of kicked grains follows the stroke. Desktop runs a finer grid and more slump sweeps than mobile. The gallery path (512² WebGPU transport, 16k airborne grains, and the wave reset) is not shipped. Grain pitch is about 6 mm so the speckle still reads from the orbit camera.
- **Level 1 toys** — five wooden toys on the sand. Collecting all of them hides the sand and opens level 2, the grass lawn from `src/grass.ts`.

Query flags for the controlling fields: `?cloth=wire`, `?fur=base`, `?fur=strands`, `?sand=height`.

Phones and narrow windows take the mobile tier (coarser cloth, fewer fur shells, smaller sand grid).

## Credits

- Animation / IK methods: [Daniel Holden](https://theorangeduck.com/page/inverse-kinematics-foot-locking) (Orange Duck)
- Engine: [Three.js](https://threejs.org/) (MIT)
- Cloak, fur hat, and sand: adapted from [Three.js Awesome Graphics Agent Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills) by Scott Sun (MIT). Copyright (c) 2026 Scott Sun. The pack license is MIT, with GPL-3.0-only applying to the optional deformable-sand `coconut_tree.glb` gallery asset — that model is **not** included here. Mechanisms used:
  - `skills/threejs-procedural-materials/examples/simulated-cloth/` and `references/simulated-cloth-system.md`
  - `skills/threejs-procedural-materials/examples/simulated-fur/` and `references/simulated-fur-system.md`
  - `skills/threejs-procedural-materials/examples/deformable-sand/` (grain shading, contact stroke, repose flux; not the GPL coconut or the full WebGPU solver)
- Earlier cloak contact ideas also drew on the [three.js cloth example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_animation_cloth.html) (MIT) and [Drape](https://github.com/aatishb/drape) (MIT). The live cloak is the woven skill sheet, not the Fabric008 texture.
- Body: original procedural wooden mannequin in this repo (no third-party mesh)
- Face: [Infinite 3D Head Scan](https://www.ir-ltd.net/) by Lee Perry-Smith / Infinite Realities (CC BY 3.0), via the [three.js LeePerrySmith example](https://github.com/mrdoob/three.js/tree/r182/examples/models/gltf/LeePerrySmith)
- Wood, plaster, shadows, and the image pipeline: the same skills pack (`threejs-procedural-materials`, `threejs-shadow-systems`, `threejs-image-pipeline`)
- Level 2 lawn: [ambientCG Grass001](https://ambientcg.com/view?id=Grass001) (CC0), via `src/grass.ts`
