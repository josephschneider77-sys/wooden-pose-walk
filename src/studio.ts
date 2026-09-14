import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
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
  poseHover,
  poseMannequin,
  setDestination,
  steerWalker,
} from "./locomotion";
import { ClothCape } from "./cape";
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
import { createGrassBlades, createGrassGround } from "./grass";
import { createImagePipeline } from "./pipeline";
import { MelonBoard } from "./melons";
import { createRooftop, PORTAL } from "./rooftop";
import { CELLAR_Y, Stairwell } from "./stairwell";
import { LawnWardrobe } from "./wearables";
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

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color("#c5d4ae");
  scene.fog = new Fog("#c5d4ae", 13, 30);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 80);
  camera.position.set(3.4, 2.15, 4.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.86;
  controls.minDistance = 1.6;
  controls.maxDistance = 12;
  controls.target.set(0, 0.95, 0);

  const rooms = buildRooms(scene);
  const key = rooms.key;
  let world: "lawn" | "roof" = "lawn";

  const figure = new WoodenMannequin();
  scene.add(figure.root);
  void attachRealisticFace(figure);
  const cape = new ClothCape(figure);
  scene.add(cape.mesh);
  const wardrobe = new LawnWardrobe(rooms.lawn, figure);
  if (import.meta.env.DEV) {
    const wear = new URLSearchParams(window.location.search).get("wear");
    if (wear) {
      for (const id of wear.split(",")) {
        if (id === "jetpack" || id === "sword") wardrobe.forceWear(id as "jetpack" | "sword");
      }
      cape.setPack(wardrobe.isWorn("jetpack"));
    }
  }
  const pickList = figure.pickables();
  const restHint =
    "Collect every find on the lawn · tap the grass to walk · posed limbs reset when he steps off";

  const walker = createWalker();
  let lastPortal = -10;
  let windowsGone = false;
  const DOUBLE_MS = 320;
  let pendingGo: { at: number; point: Vector3 } | null = null;
  const leftToe = new Vector3();
  const rightToe = new Vector3();

  const activeWindow = (): Mesh => (world === "lawn" ? rooms.window : rooms.returnWindow);

  const vanishWindow = (): void => {
    windowsGone = true;
    rooms.window.visible = false;
    rooms.windowGlow.visible = false;
    rooms.windowFrame.visible = false;
    rooms.nightView.visible = false;
    rooms.roofWindow.visible = false;
    rooms.returnWindow.visible = false;
  };

  const openStairwell = (): void => {
    vanishWindow();
    rooms.stairs.reveal();
    rooms.floorPlug.visible = false;
    controls.maxPolarAngle = Math.PI * 0.94;
    controls.maxDistance = 18;
    hint.textContent = "The window is gone. A stairwell tore open in the slate — walk down.";
  };

  const syncWindowLook = (): void => {
    if (windowsGone) return;
    const open = wardrobe.allWorn();
    rooms.windowFrame.visible = !open;
    const glow = rooms.windowGlow.material as MeshBasicMaterial;
    if (open) {
      glow.color.setRGB(3.1, 2.7, 2.15);
      glow.transparent = false;
      glow.opacity = 1;
    } else {
      glow.color.set("#e8c888");
      glow.transparent = true;
      glow.opacity = 0.28;
    }
  };
  syncWindowLook();
  figure.refreshWorld();
  const leftLock = createFootLock(figure.worldPos("leftToe"));
  const rightLock = createFootLock(figure.worldPos("rightToe"));
  const holds = new Map<LimbId, Vector3>();
  let grab: Grab | null = null;

  const snapFeet = (): void => {
    figure.resetPose();
    figure.bone("root").rotation.set(0, walker.yaw, 0);
    figure.refreshWorld();
    figure.worldPos("leftToe", leftToe);
    figure.worldPos("rightToe", rightToe);
    for (const lock of [leftLock, rightLock]) {
      const toe = lock === leftLock ? leftToe : rightToe;
      lock.position.copy(toe);
      lock.velocity.set(0, 0, 0);
      lock.inputPosition.copy(toe);
      lock.inputVelocity.set(0, 0, 0);
      lock.offsetPosition.set(0, 0, 0);
      lock.offsetVelocity.set(0, 0, 0);
      lock.time = 10;
      lock.contact.copy(toe);
      lock.locked = false;
    }
  };

  const releasePose = (): void => {
    holds.clear();
    snapFeet();
  };

  const goTo = (point: Vector3, fly: boolean): void => {
    if (!grab) releasePose();
    setDestination(walker, point, fly);
    const down =
      world === "roof" &&
      rooms.stairs.open &&
      point.distanceTo(rooms.stairs.walkIn) < 0.35;
    hint.textContent = fly ? "Flying there" : down ? "Walking down the stairwell" : "Walking there";
  };

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
  let hover: LimbId | null = null;

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("cellar")) {
    wardrobe.forceWear("jetpack");
    wardrobe.forceWear("sword");
    rooms.melons.chop();
    world = "roof";
    applyWorld(scene, rooms, world, hint);
    openStairwell();
    figure.root.position.set(-2.4, 0, 1.15);
    figure.refreshWorld();
    cape.snap();
  }

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
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const wearHover = wardrobe.hit(raycaster);
    const onWindow = !windowsGone && pickWindow(raycaster, activeWindow());
    const onMelons = world === "roof" && rooms.melons.hit(raycaster);
    canvas.style.cursor = hover ? "grab" : wearHover || onWindow || onMelons ? "pointer" : "";
    if (!grab) {
      if (hover) {
        hint.textContent = `Drag the ${limbLabel(hover)} to pose it`;
      } else if (wearHover?.worn) {
        hint.textContent = `Tap to take off the ${wearHover.title}`;
      } else if (wearHover) {
        hint.textContent = `Walk over to put on the ${wearHover.title}`;
      } else if (onMelons && rooms.melons.chopped) {
        hint.textContent = "Watermelons chopped — nice and ready";
      } else if (onMelons && wardrobe.isWorn("sword")) {
        hint.textContent = "Drag the right arm — the knife — through the fruit";
      } else if (onMelons) {
        hint.textContent = "Pick up the knife on the table, then swing the right arm";
      } else if (onWindow && (wardrobe.isWorn("jetpack") || world === "roof")) {
        hint.textContent = wardrobe.allWorn()
          ? "Tap the light to fly through"
          : "Tap to fly through the window";
      } else if (onWindow) {
        hint.textContent = "The jetpack is by the window — walk to it first";
      } else if (windowsGone && world === "roof") {
        hint.textContent = rooms.stairs.open
          ? "Walk into the stairwell — it drops to a lower level"
          : restHint;
      } else {
        hint.textContent = wardrobe.allWorn()
          ? "The frame is gone — fly through the light"
          : restHint;
      }
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (grab && event.pointerId === grab.pointerId) {
      if (!pointerState.moved) {
        setPointer(event);
        raycaster.setFromCamera(pointer, camera);
        const tapWear = wardrobe.hit(raycaster);
        if (tapWear?.worn) {
          hint.textContent = wardrobe.takeOff(tapWear.id) ?? restHint;
          syncWindowLook();
          grab = null;
          controls.enabled = true;
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch {
            // capture may already be released
          }
          return;
        }
      }
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
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const wearHit = wardrobe.hit(raycaster);
    if (wearHit?.worn) {
      hint.textContent = wardrobe.takeOff(wearHit.id) ?? restHint;
      syncWindowLook();
      return;
    }
    if (wearHit) {
      wardrobe.walkTarget(wearHit.id, floorPoint);
      floorPoint.y = 0;
      goTo(floorPoint, false);
      hint.textContent = `Walking to the ${wearHit.title}`;
      return;
    }
    if (world === "roof" && rooms.melons.hit(raycaster)) {
      hint.textContent =
        rooms.melons.takeKnife(wardrobe) ??
        (rooms.melons.chopped
          ? "Watermelons chopped — nice and ready"
          : "Drag the right arm — the knife — through the fruit");
      return;
    }
    if (!windowsGone && pickWindow(raycaster, activeWindow())) {
      if (wardrobe.isWorn("jetpack")) {
        if (!grab) releasePose();
        setDestination(walker, rooms.portalApproach, true, 2.55);
        hint.textContent = "Flying through the window";
      } else if (world === "roof") {
        enterWorld("lawn");
      } else {
        wardrobe.walkTarget("jetpack", floorPoint);
        floorPoint.y = 0;
        goTo(floorPoint, false);
        hint.textContent = "Walking to the jetpack — then tap the window";
      }
      return;
    }
    const reach = world === "roof" ? 10.2 : ROOM + 0.4;
    if (
      pickGround(
        event,
        camera,
        raycaster,
        pointer,
        floorPoint,
        reach,
        world === "roof" && rooms.stairs.open ? rooms.stairs : null,
      )
    ) {
      const pad = world === "roof" ? 10 : ROOM;
      floorPoint.x = clamp(floorPoint.x, -pad, pad);
      floorPoint.z = clamp(floorPoint.z, -pad, pad);
      if (world === "roof" && rooms.stairs.open && rooms.stairs.inPit(floorPoint.x, floorPoint.z)) {
        floorPoint.copy(rooms.stairs.walkIn);
      }
      floorPoint.y = 0;
      const now = performance.now();
      if (wardrobe.isWorn("jetpack") && pendingGo && now - pendingGo.at < DOUBLE_MS) {
        goTo(floorPoint, true);
        pendingGo = null;
        return;
      }
      if (wardrobe.isWorn("jetpack")) {
        pendingGo = { at: now, point: floorPoint.clone() };
        return;
      }
      pendingGo = null;
      goTo(floorPoint, false);
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
  const holdWorld = new Vector3();
  const knifeHand = new Vector3();
  const knifeMid = new Vector3();
  const knifeTip = new Vector3();
  let last = performance.now();

  const applyHolds = (): void => {
    if (!grab) return;
    const local = holds.get(grab.id);
    if (!local) return;
    holdWorld.copy(local);
    figure.bone(limbAnchor(grab.id)).localToWorld(holdWorld);
    if (isArm(grab.id)) {
      figure.solveArm(limbSide(grab.id), holdWorld, SOFTENING);
    } else {
      figure.solveLeg(limbSide(grab.id), holdWorld, {
        enableHeightClamp: true,
        enableHeelLookAt: true,
        enableToeLookAt: true,
        softening: SOFTENING,
        maxReach: LEG_REACH,
        groundY:
          world === "roof" ? rooms.stairs.heightAt(figure.root.position.x, figure.root.position.z) : 0,
      });
    }
  };

  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const time = now / 1000;

    if (pendingGo && now - pendingGo.at >= DOUBLE_MS) {
      goTo(pendingGo.point, false);
      pendingGo = null;
    }

    const jet = wardrobe.isWorn("jetpack");
    const groundY =
      world === "roof" ? rooms.stairs.heightAt(figure.root.position.x, figure.root.position.z) : 0;
    const { walkWeight, flying } = steerWalker(walker, figure.root.position, dt, jet, groundY);
    if (
      !windowsGone &&
      flying &&
      time - lastPortal > 1.3 &&
      throughPortal(figure.root.position)
    ) {
      enterWorld(world === "lawn" ? "roof" : "lawn");
    }
    if (flying) {
      poseHover(figure, walker, time);
      applyHolds();
    } else {
      const contacts = poseMannequin(figure, walker, walkWeight, time, {
        leftArm: grab?.id === "leftArm",
        rightArm: grab?.id === "rightArm",
      });
      figure.worldPos("leftToe", leftToe);
      figure.worldPos("rightToe", rightToe);

      const leftTarget = leftToe.clone();
      const rightTarget = rightToe.clone();
      const toeFloor = figure.toeMinHeight + groundY;
      const leftHeld = grab?.id === "leftLeg";
      const rightHeld = grab?.id === "rightLeg";

      updateFootLockingState(
        leftLock,
        leftToe,
        contacts.leftContact && !leftHeld,
        toeFloor,
        dt,
        UNLOCK_DISTANCE,
        LOCK_DISTANCE,
        BLEND_TIME,
      );
      updateFootLockingState(
        rightLock,
        rightToe,
        contacts.rightContact && !rightHeld,
        toeFloor,
        dt,
        UNLOCK_DISTANCE,
        LOCK_DISTANCE,
        BLEND_TIME,
      );
      if (!leftHeld) leftTarget.copy(leftLock.position);
      if (!rightHeld) rightTarget.copy(rightLock.position);

      if (!leftHeld) {
        figure.solveLeg("left", leftTarget, {
          enableHeightClamp: true,
          enableHeelLookAt: true,
          enableToeLookAt: true,
          softening: SOFTENING,
          groundY,
        });
      }
      if (!rightHeld) {
        figure.solveLeg("right", rightTarget, {
          enableHeightClamp: true,
          enableHeelLookAt: true,
          enableToeLookAt: true,
          softening: SOFTENING,
          groundY,
        });
      }

      applyHolds();
    }
    wardrobe.setThrust(flying, time);
    cape.setPack(jet);

    const focus = grab?.id ?? hover;
    if (focus) {
      figure.worldPos(limbEndBone(focus), highlight.position);
      highlight.visible = true;
    } else {
      highlight.visible = false;
    }

    cape.update(dt, time, walker.speed, walker.yaw);
    const found = wardrobe.update(time);
    if (found) syncWindowLook();
    if (found && !grab) {
      hint.textContent = wardrobe.allWorn()
        ? "Every find is on — tap the window when you want to fly through"
        : found;
    }
    rooms.melons.showLooseKnife(world === "roof" && !wardrobe.isWorn("sword"));
    if (
      world === "roof" &&
      !wardrobe.isWorn("sword") &&
      rooms.melons.inRange(figure.root.position.x, figure.root.position.z)
    ) {
      const took = rooms.melons.takeKnife(wardrobe);
      if (took) hint.textContent = took;
    }
    if (
      world === "roof" &&
      !rooms.melons.chopped &&
      wardrobe.isWorn("sword") &&
      grab?.id === "rightArm"
    ) {
      figure.refreshWorld();
      const hand = figure.bone("rightHand");
      hand.getWorldPosition(knifeHand);
      knifeMid.set(0, -0.16, 0.01);
      hand.localToWorld(knifeMid);
      knifeTip.set(0, -0.3, 0.01);
      hand.localToWorld(knifeTip);
      if (rooms.melons.bladeHits([knifeHand, knifeMid, knifeTip])) {
        rooms.melons.chop();
        openStairwell();
      }
    }

    figure.worldPos("chest", follow);
    follow.y += 0.08;
    controls.target.lerp(follow, 1 - Math.exp(-3.2 * dt));
    controls.update();
    snapKeyShadow(key, follow);

    pipeline.render(true, true, true, false);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);

  function enterWorld(next: "lawn" | "roof"): void {
    lastPortal = performance.now() / 1000;
    world = next;
    applyWorld(scene, rooms, world, hint);
    const offset = camera.position.clone().sub(controls.target);
    figure.root.position.set(-6.1, wardrobe.isWorn("jetpack") ? 1.35 : 0, PORTAL.z);
    figure.refreshWorld();
    cape.snap();
    figure.worldPos("chest", follow);
    follow.y += 0.08;
    controls.target.copy(follow);
    camera.position.copy(follow).add(offset);
    if (wardrobe.isWorn("jetpack")) {
      walker.destination = new Vector3(-2.0, 0, PORTAL.z);
      walker.fly = true;
      walker.climb = 1.58;
    } else {
      walker.destination = null;
      walker.fly = false;
      walker.speed = 0;
    }
    hint.textContent =
      world === "roof"
        ? "Night terrace — pick up the knife, then drag the right arm through the fruit"
        : restHint;
  }
}

function pickFloor(
  event: PointerEvent,
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  pointer: Vector2,
  out: Vector3,
  limit = ROOM + 0.4,
  planeY = 0,
): boolean {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const denom = raycaster.ray.direction.y;
  if (Math.abs(denom) < 1e-5) return false;
  const t = (planeY - raycaster.ray.origin.y) / denom;
  if (t < 0.05) return false;
  out.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, t);
  return Math.abs(out.x) <= limit && Math.abs(out.z) <= limit;
}

function pickGround(
  event: PointerEvent,
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  pointer: Vector2,
  out: Vector3,
  limit: number,
  stairs: Stairwell | null,
): boolean {
  if (pickFloor(event, camera, raycaster, pointer, out, limit, 0)) return true;
  if (!stairs?.open) return false;
  return pickFloor(event, camera, raycaster, pointer, out, limit, CELLAR_Y);
}

function pickWindow(raycaster: Raycaster, pane: Mesh): boolean {
  if (!pane.visible) return false;
  let parent = pane.parent;
  while (parent) {
    if (!parent.visible) return false;
    parent = parent.parent;
  }
  return raycaster.intersectObject(pane, false).length > 0;
}

function throughPortal(pos: Vector3): boolean {
  return pos.x < PORTAL.x + 0.7 && Math.abs(pos.z - PORTAL.z) < PORTAL.halfW && pos.y > 0.4;
}

function applyWorld(
  scene: Scene,
  rooms: ReturnType<typeof buildRooms>,
  world: "lawn" | "roof",
  hint: HTMLElement,
): void {
  rooms.lawn.visible = world === "lawn";
  rooms.roof.visible = world === "roof";
  document.body.classList.toggle("night", world === "roof");
  hint.classList.toggle("night", world === "roof");
  if (world === "lawn") {
    scene.background = new Color("#c5d4ae");
    scene.fog = new Fog("#c5d4ae", 13, 30);
    rooms.sky.color.set("#eef6ff");
    rooms.sky.groundColor.set("#4a6b32");
    rooms.sky.intensity = 0.62;
    rooms.key.color.set("#fff4d8");
    rooms.key.intensity = 1.48;
  } else {
    scene.background = new Color("#0b1220");
    scene.fog = new Fog("#0b1220", 16, 36);
    rooms.sky.color.set("#1a2740");
    rooms.sky.groundColor.set("#0a0c10");
    rooms.sky.intensity = 0.38;
    rooms.key.color.set("#c8d4f0");
    rooms.key.intensity = 0.7;
  }
}

function buildRooms(scene: Scene): {
  key: DirectionalLight;
  sky: HemisphereLight;
  lawn: Group;
  roof: Group;
  window: Mesh;
  windowGlow: Mesh;
  windowFrame: Group;
  nightView: Mesh;
  returnWindow: Mesh;
  roofWindow: Group;
  portalApproach: Vector3;
  melons: MelonBoard;
  stairs: Stairwell;
  floorPlug: Mesh;
} {
  const lawn = new Group();
  lawn.name = "lawn";
  lawn.add(createGrassGround());
  lawn.add(createGrassBlades());

  const wallMat = createPlasterMaterial();
  const back = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  back.position.set(0, 3.1, -10);
  back.receiveShadow = true;
  lawn.add(back);
  const wallPane = (w: number, h: number, x: number, y: number, z: number) => {
    const pane = new Mesh(new PlaneGeometry(w, h), wallMat);
    pane.position.set(x, y, z);
    pane.rotation.y = Math.PI / 2;
    pane.receiveShadow = true;
    lawn.add(pane);
  };
  wallPane(20, 1.55, -10, 0.775, 0);
  wallPane(20, 1.55, -10, 5.575, 0);
  wallPane(9.95, 3.5, -10, 3.15, -5.025);
  wallPane(7.65, 3.5, -10, 3.15, 6.175);

  const nightView = new Mesh(
    new PlaneGeometry(2.4, 3.5),
    new MeshBasicMaterial({ color: "#0b1220" }),
  );
  nightView.name = "nightView";
  nightView.position.set(PORTAL.x - 0.08, PORTAL.y, PORTAL.z);
  nightView.rotation.y = Math.PI / 2;
  lawn.add(nightView);

  const windowGlow = new Mesh(
    new PlaneGeometry(2.4, 3.5),
    new MeshBasicMaterial({
      color: "#e8c888",
      transparent: true,
      opacity: 0.28,
    }),
  );
  windowGlow.position.set(PORTAL.x, PORTAL.y, PORTAL.z);
  windowGlow.rotation.y = Math.PI / 2;
  lawn.add(windowGlow);

  const windowPick = new Mesh(
    new PlaneGeometry(3.2, 4.2),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  windowPick.position.set(PORTAL.x + 0.04, PORTAL.y, PORTAL.z);
  windowPick.rotation.y = Math.PI / 2;
  windowPick.name = "studioWindow";
  lawn.add(windowPick);

  const windowFrame = new Group();
  windowFrame.name = "windowFrame";
  lawn.add(windowFrame);

  const mullion = createWoodMaterial({ kind: "ebony", seed: 11, size: 128 });
  const bar = (w: number, h: number, y: number, z: number) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), mullion);
    mesh.position.set(PORTAL.x + 0.01, y, z);
    mesh.rotation.y = Math.PI / 2;
    windowFrame.add(mesh);
  };
  bar(2.4, 0.07, PORTAL.y, PORTAL.z);
  bar(0.07, 3.5, PORTAL.y, PORTAL.z);

  const frame = createWoodMaterial({ kind: "ebony", seed: 8, size: 256 });
  const lintel = (w: number, h: number, y: number, z: number) => {
    const board = new Mesh(new PlaneGeometry(w, h), frame);
    board.position.set(PORTAL.x - 0.02, y, z);
    board.rotation.y = Math.PI / 2;
    board.receiveShadow = true;
    windowFrame.add(board);
  };
  lintel(2.72, 0.16, PORTAL.y + 1.83, PORTAL.z);
  lintel(2.72, 0.16, PORTAL.y - 1.83, PORTAL.z);
  lintel(0.16, 3.82, PORTAL.y, PORTAL.z - 1.28);
  lintel(0.16, 3.82, PORTAL.y, PORTAL.z + 1.28);
  scene.add(lawn);

  const roof = createRooftop();
  const stairs = new Stairwell();
  roof.add(stairs.root);
  const melons = new MelonBoard();
  roof.add(melons.root);
  scene.add(roof);
  const returnWindow = roof.getObjectByName("returnWindow") as Mesh;
  const roofWindow = roof.getObjectByName("roofWindow") as Group;
  const floorPlug = roof.getObjectByName("floorPlug") as Mesh;

  const sky = new HemisphereLight("#eef6ff", "#4a6b32", 0.62);
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

  return {
    key,
    sky,
    lawn,
    roof,
    window: windowPick,
    windowGlow,
    windowFrame,
    nightView,
    returnWindow,
    roofWindow,
    portalApproach: new Vector3(-10.5, 0, PORTAL.z),
    melons,
    stairs,
    floorPlug,
  };
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
