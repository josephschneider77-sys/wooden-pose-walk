import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createFootLock, updateFootLockingState } from "./footLock";
import {
  createWalker,
  poseMannequin,
  setDestination,
  steerWalker,
} from "./locomotion";
import { ClothCape } from "./cape";
import { FurHat } from "./furHat";
import { SandFloor } from "./sandFloor";
import {
  isArm,
  LEG_REACH,
  limbAnchor,
  limbEndBone,
  limbIdOf,
  limbLabel,
  limbSide,
  type LimbId,
  WoodenMannequin,
} from "./mannequin";
import { clamp } from "./math";
import { attachRealisticFace } from "./face";
import { createImagePipeline } from "./pipeline";
import { ToyShelf } from "./collectibles";
import { createGrassBlades, createGrassGround } from "./grass";
import { debugMode, graphicsTier } from "./quality";
import type { SandStroke } from "./sandFloor";
import { createPlasterMaterial, createWoodMaterial } from "./wood";

const ROOM = 8.4;
const SOFTENING = 0.012;
const UNLOCK_DISTANCE = 0.2;
const LOCK_DISTANCE = 0.09;
const BLEND_TIME = 0.14;

interface Grab {
  id: LimbId;
  pointerId: number;
  originHit: Vector3;
  originEnd: Vector3;
  plane: Plane;
}

export function startStudio(canvas: HTMLCanvasElement): void {
  const hint = document.querySelector("#hint") as HTMLParagraphElement;
  const collectHud = document.querySelector("#collect");

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color("#efe2c8");
  scene.fog = new Fog("#efe2c8", 14, 32);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 60);
  camera.position.set(3.4, 2.15, 4.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.target.set(0, 0.95, 0);

  const sand = new SandFloor();
  const toys = new ToyShelf(sand);
  scene.add(toys.group);
  let onLawn = false;
  const key = buildRoom(scene, sand);
  const showCollect = (): void => {
    if (collectHud instanceof HTMLElement) collectHud.textContent = toys.label();
  };
  showCollect();
  const enterLawn = (): void => {
    if (onLawn) return;
    onLawn = true;
    sand.mesh.visible = false;
    toys.group.visible = false;
    const tier = graphicsTier();
    scene.add(createGrassGround());
    const blades = createGrassBlades(tier === "mobile" ? 900 : 2400, 8.5);
    blades.castShadow = false;
    blades.receiveShadow = false;
    scene.add(blades);
    showCollect();
    hint.textContent = "Level 2 — the lawn";
  };

  const figure = new WoodenMannequin();
  scene.add(figure.root);
  void attachRealisticFace(figure);
  const cape = new ClothCape(figure);
  scene.add(cape.mesh);
  const hat = new FurHat(figure);
  const pickList = figure.pickables();

  const walker = createWalker();
  figure.refreshWorld();
  const leftLock = createFootLock(figure.worldPos("leftToe"));
  const rightLock = createFootLock(figure.worldPos("rightToe"));
  const holds = new Map<LimbId, Vector3>();

  const highlight = new Mesh(
    new SphereGeometry(0.034, 16, 12),
    new MeshPhysicalMaterial({
      color: "#d7a441",
      roughness: 0.28,
      metalness: 0.08,
      emissive: "#c4842a",
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.92,
    }),
  );
  highlight.visible = false;
  highlight.renderOrder = 2;
  scene.add(highlight);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floorPoint = new Vector3();
  const planeHit = new Vector3();
  const worldTarget = new Vector3();
  const cameraDir = new Vector3();
  const pointerState = { x: 0, y: 0, moved: false };
  let grab: Grab | null = null;
  let hover: LimbId | null = null;
  let presentDirect = false;

  const setPointer = (event: PointerEvent): void => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  };

  const pickLimb = (event: PointerEvent): LimbId | null => {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickList, false)[0];
    return hit ? limbIdOf(hit.object) : null;
  };

  const intersectGrabPlane = (event: PointerEvent, plane: Plane): boolean => {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(plane, planeHit) !== null;
  };

  const storeHold = (id: LimbId, world: Vector3): void => {
    const local = world.clone();
    if (!isArm(id)) local.y = Math.max(local.y, figure.toeMinHeight);
    figure.bone(limbAnchor(id)).worldToLocal(local);
    holds.set(id, local);
  };

  canvas.addEventListener("pointerdown", (event) => {
    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.moved = false;

    const id = pickLimb(event);
    if (!id) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const plane = new Plane();
    camera.getWorldDirection(cameraDir);
    figure.worldPos(limbEndBone(id), worldTarget);
    plane.setFromNormalAndCoplanarPoint(cameraDir, worldTarget);
    const originHit = intersectGrabPlane(event, plane)
      ? planeHit.clone()
      : worldTarget.clone();
    grab = {
      id,
      pointerId: event.pointerId,
      originHit,
      originEnd: worldTarget.clone(),
      plane,
    };
    storeHold(id, worldTarget);
    walker.destination = null;
    walker.speed = 0;
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    hint.textContent = `Posing the ${limbLabel(id)}`;
  },
  true,
  );

  canvas.addEventListener("pointermove", (event) => {
    if (
      Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y) > 8
    ) {
      pointerState.moved = true;
    }

    if (grab && event.pointerId === grab.pointerId) {
      camera.getWorldDirection(cameraDir);
      grab.plane.setFromNormalAndCoplanarPoint(cameraDir, grab.originEnd);
      if (!intersectGrabPlane(event, grab.plane)) return;
      worldTarget.copy(grab.originEnd).add(planeHit).sub(grab.originHit);
      storeHold(grab.id, worldTarget);
      return;
    }

    hover = pickLimb(event);
    canvas.style.cursor = hover ? "grab" : "";
    if (!grab) {
      hint.textContent = hover
        ? `Drag the ${limbLabel(hover)} to pose it`
        : "Grab an arm or a leg — tap the sand to walk";
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (grab && event.pointerId === grab.pointerId) {
      hint.textContent = `Holding the ${limbLabel(grab.id)}`;
      grab = null;
      controls.enabled = true;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // capture may already be released
      }
      canvas.style.cursor = hover ? "grab" : "";
      return;
    }

    if (pointerState.moved) return;
    if (pickFloor(event, camera, raycaster, pointer, floorPoint)) {
      floorPoint.x = clamp(floorPoint.x, -ROOM, ROOM);
      floorPoint.z = clamp(floorPoint.z, -ROOM, ROOM);
      floorPoint.y = 0;
      if (!onLawn && toys.collectNear(floorPoint.x, floorPoint.z, 1.05)) {
        showCollect();
        if (toys.remaining === 0) enterLawn();
      }
      setDestination(walker, floorPoint);
      if (!onLawn) hint.textContent = "Walking there";
    }
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (grab && event.pointerId === grab.pointerId) {
      grab = null;
      controls.enabled = true;
    }
  });

  const pipeline = createImagePipeline(renderer, scene, camera);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    pipeline.setSize(window.innerWidth, window.innerHeight);
  });

  const follow = new Vector3();
  const leftToe = new Vector3();
  const rightToe = new Vector3();
  const leftHeel = new Vector3();
  const rightHeel = new Vector3();
  const strokes: SandStroke[] = [
    { x: 0, z: 0, px: 0, pz: 0, pressure: 0, radius: 0.24 },
    { x: 0, z: 0, px: 0, pz: 0, pressure: 0, radius: 0.2 },
    { x: 0, z: 0, px: 0, pz: 0, pressure: 0, radius: 0.24 },
    { x: 0, z: 0, px: 0, pz: 0, pressure: 0, radius: 0.2 },
    { x: 0, z: 0, px: 0, pz: 0, pressure: 0, radius: 0.46 },
  ];
  const strokePrev = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let strokeReady = false;
  const holdWorld = new Vector3();
  // Seed from the animation clock, not performance.now(). Those clocks disagree
  // after a long startup, and a negative step sends the camera under the sand.
  let last = -1;
  let startupFrames = 0;

  const applyHolds = (walkWeight: number): void => {
    for (const [id, local] of holds) {
      if (!isArm(id) && walkWeight > 0.22 && grab?.id !== id) continue;
      holdWorld.copy(local);
      figure.bone(limbAnchor(id)).localToWorld(holdWorld);
      if (isArm(id)) {
        figure.solveArm(limbSide(id), holdWorld, SOFTENING);
      } else {
        figure.solveLeg(limbSide(id), holdWorld, {
          enableHeightClamp: true,
          enableHeelLookAt: true,
          enableToeLookAt: true,
          softening: SOFTENING,
          maxReach: LEG_REACH,
        });
      }
    }
  };

  const presentScene = (): void => {
    const post = !presentDirect && debugMode("post") !== "off";
    try {
      pipeline.render(post, post, post, debugMode("ao") === "debug");
    } catch (error) {
      presentDirect = true;
      console.warn("Post processing failed; drawing the scene directly.", error);
      renderer.render(scene, camera);
    }
    // A fresh load that stays on the beige clear is the reported failure.
    // Snap back to the standing view and draw it directly.
    if (startupFrames < 6) {
      startupFrames += 1;
      if (frameIsFlatBeige(renderer)) {
        startupFrames = 6;
        presentDirect = true;
        camera.position.set(3.4, 2.15, 4.6);
        controls.target.set(0, 0.95, 0);
        renderer.render(scene, camera);
      }
    }
  };

  const tick = (now: number) => {
    if (last < 0) {
      last = now;
      presentScene();
      requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    const time = now / 1000;
    if (dt === 0) {
      presentScene();
      requestAnimationFrame(tick);
      return;
    }

    const { walkWeight } = steerWalker(walker, figure.root.position, dt);
    const contacts = poseMannequin(figure, walker, walkWeight, time, {
      leftArm: holds.has("leftArm"),
      rightArm: holds.has("rightArm"),
    });
    figure.worldPos("leftToe", leftToe);
    figure.worldPos("rightToe", rightToe);

    const leftTarget = leftToe.clone();
    const rightTarget = rightToe.clone();

    updateFootLockingState(
      leftLock,
      leftToe,
      contacts.leftContact && !holds.has("leftLeg"),
      figure.toeMinHeight,
      dt,
      UNLOCK_DISTANCE,
      LOCK_DISTANCE,
      BLEND_TIME,
    );
    updateFootLockingState(
      rightLock,
      rightToe,
      contacts.rightContact && !holds.has("rightLeg"),
      figure.toeMinHeight,
      dt,
      UNLOCK_DISTANCE,
      LOCK_DISTANCE,
      BLEND_TIME,
    );
    if (!holds.has("leftLeg")) leftTarget.copy(leftLock.position);
    if (!holds.has("rightLeg")) rightTarget.copy(rightLock.position);

    if (!holds.has("leftLeg")) {
      figure.solveLeg("left", leftTarget, {
        enableHeightClamp: true,
        enableHeelLookAt: true,
        enableToeLookAt: true,
        softening: SOFTENING,
      });
    }
    if (!holds.has("rightLeg")) {
      figure.solveLeg("right", rightTarget, {
        enableHeightClamp: true,
        enableHeelLookAt: true,
        enableToeLookAt: true,
        softening: SOFTENING,
      });
    }

    applyHolds(walkWeight);

    const focus = grab?.id ?? hover;
    if (focus) {
      figure.worldPos(limbEndBone(focus), highlight.position);
      highlight.visible = true;
    } else {
      highlight.visible = false;
    }

    cape.update(dt, time, walker.speed, walker.yaw, (x, z) => (onLawn ? 0 : sand.heightAt(x, z)));
    hat.update(dt, time, camera, walker.speed, walker.yaw);
    figure.worldPos("leftHeel", leftHeel);
    figure.worldPos("leftToe", leftToe);
    figure.worldPos("rightHeel", rightHeel);
    figure.worldPos("rightToe", rightToe);
    const leftPlanted = contacts.leftContact && !holds.has("leftLeg");
    const rightPlanted = contacts.rightContact && !holds.has("rightLeg");
    const trail = [
      leftHeel.x,
      leftHeel.z,
      leftToe.x,
      leftToe.z,
      rightHeel.x,
      rightHeel.z,
      rightToe.x,
      rightToe.z,
      figure.root.position.x,
      figure.root.position.z,
    ];
    const pressures = [
      leftPlanted ? 1 : 0,
      leftPlanted ? 0.85 : 0,
      rightPlanted ? 1 : 0,
      rightPlanted ? 0.85 : 0,
      walker.speed > 0.12 ? 0.9 : 0,
    ];
    if (!onLawn) {
      if (!strokeReady) {
        trail.forEach((value, index) => {
          strokePrev[index] = value;
        });
        strokeReady = true;
      }
      for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i]!;
        stroke.px = strokePrev[i * 2] ?? stroke.x;
        stroke.pz = strokePrev[i * 2 + 1] ?? stroke.z;
        stroke.x = trail[i * 2] ?? stroke.x;
        stroke.z = trail[i * 2 + 1] ?? stroke.z;
        stroke.pressure = pressures[i] ?? 0;
      }
      sand.step(strokes, dt);
      trail.forEach((value, index) => {
        strokePrev[index] = value;
      });
      toys.update(dt, time);
      if (toys.collectNear(figure.root.position.x, figure.root.position.z, 0.62)) {
        showCollect();
        if (toys.remaining === 0) enterLawn();
      }
    }

    figure.worldPos("chest", follow);
    follow.y += 0.08;
    if (!Number.isFinite(follow.y) || follow.y < 0.45 || follow.y > 2.4) {
      follow.set(0, 1.03, 0);
    }
    controls.target.lerp(follow, 1 - Math.exp(-3.2 * dt));
    controls.update();
    if (camera.position.y < 0.45 || controls.target.y < 0.45) {
      camera.position.set(3.4, 2.15, 4.6);
      controls.target.set(0, 0.95, 0);
    }
    snapKeyShadow(key, follow);

    presentScene();
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

/** True when the framebuffer is the empty beige clear (or fully transparent). */
function frameIsFlatBeige(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width < 2 || height < 2) return false;
  const pixel = new Uint8Array(4);
  const samples = [
    [0.5, 0.5],
    [0.5, 0.62],
    [0.44, 0.48],
    [0.56, 0.52],
  ] as const;
  for (const [fx, fy] of samples) {
    gl.readPixels((width * fx) | 0, (height * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const r = pixel[0] ?? 0;
    const g = pixel[1] ?? 0;
    const b = pixel[2] ?? 0;
    const a = pixel[3] ?? 0;
    if (a < 8) return true;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // The standing figure puts wood or cloth on these samples. The clear is a
    // light, low-saturation beige (about #efe2c8).
    if (!(max > 185 && max - min < 48)) return false;
  }
  return true;
}

function pickFloor(
  event: PointerEvent,
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  pointer: Vector2,
  out: Vector3,
): boolean {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const denom = raycaster.ray.direction.y;
  if (Math.abs(denom) < 1e-5) return false;
  const t = -raycaster.ray.origin.y / denom;
  if (t < 0.05) return false;
  out.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, t);
  return Math.abs(out.x) <= ROOM + 0.4 && Math.abs(out.z) <= ROOM + 0.4;
}

function buildRoom(scene: Scene, sand: SandFloor): DirectionalLight {
  scene.add(sand.mesh);

  const wallMat = createPlasterMaterial();
  const back = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  back.position.set(0, 3.1, -10);
  back.receiveShadow = true;
  scene.add(back);
  const left = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  left.position.set(-10, 3.1, 0);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  scene.add(left);

  const windowGlow = new Mesh(
    new PlaneGeometry(2.4, 3.5),
    new MeshBasicMaterial({
      color: new Color(3.1, 2.7, 2.15),
    }),
  );
  windowGlow.position.set(-9.94, 3.15, 1.15);
  windowGlow.rotation.y = Math.PI / 2;
  scene.add(windowGlow);

  const frame = createWoodMaterial({ kind: "ebony", seed: 8, size: 256 });
  const sash = new Mesh(new PlaneGeometry(2.62, 3.72), frame);
  sash.position.set(-9.97, 3.15, 1.15);
  sash.rotation.y = Math.PI / 2;
  sash.receiveShadow = true;
  scene.add(sash);

  const sky = new HemisphereLight("#f7f1e6", "#b08958", 0.7);
  scene.add(sky);

  const key = new DirectionalLight("#fff4d8", 1.48);
  key.position.set(5.1, 7.4, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.8;
  key.shadow.camera.far = 24;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.00028;
  key.shadow.normalBias = 0.022;
  scene.add(key);
  scene.add(key.target);

  const fill = new DirectionalLight("#cfe4ff", 0.28);
  fill.position.set(-5.4, 3.4, -2.2);
  scene.add(fill);

  const rim = new DirectionalLight("#ffe4b8", 0.42);
  rim.position.set(-2.2, 4.6, -5.4);
  scene.add(rim);

  return key;
}

function snapKeyShadow(key: DirectionalLight, follow: Vector3): void {
  const extent = 6;
  const texel = (extent * 2) / key.shadow.mapSize.x;
  const x = Math.round(follow.x / texel) * texel;
  const z = Math.round(follow.z / texel) * texel;
  key.target.position.set(x, 0.15, z);
  key.position.set(x + 5.1, 7.4, z + 3.2);
  key.target.updateMatrixWorld();
}
