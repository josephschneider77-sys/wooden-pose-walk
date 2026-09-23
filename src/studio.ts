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
import { Bazaar, disposeTree, STALL_FRONT } from "./bazaar";
import { BEACH_SPAWN, Beach } from "./beach";
import { ClothCape } from "./cape";
import { attachRealisticFace } from "./face";
import { createFootLock, updateFootLockingState } from "./footLock";
import { FurHat } from "./furHat";
import {
  createWalker,
  poseHover,
  poseMannequin,
  setDestination,
  steerWalker,
} from "./locomotion";
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
import { MelonBoard } from "./melons";
import { createImagePipeline } from "./pipeline";
import { debugMode } from "./quality";
import { createRooftop, PORTAL } from "./rooftop";
import { SandFloor, type SandStroke } from "./sandFloor";
import { bindShop, type Purse } from "./shop";
import { CELLAR_Y, Stairwell } from "./stairwell";
import { GearShelf, type WearId } from "./wearables";
import { createPlasterMaterial, createWoodMaterial } from "./wood";

type World = "sand" | "roof" | "bazaar" | "vault" | "beach";

const ROOM = 8.4;
const SOFTENING = 0.012;
const UNLOCK_DISTANCE = 0.2;
const LOCK_DISTANCE = 0.09;
const BLEND_TIME = 0.14;
const DOUBLE_MS = 320;

interface Grab {
  id: LimbId;
  pointerId: number;
  originHit: Vector3;
  originEnd: Vector3;
  plane: Plane;
}

interface Rooms {
  key: DirectionalLight;
  sky: HemisphereLight;
  home: Group;
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

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 80);
  camera.position.set(3.4, 2.15, 4.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.target.set(0, 0.95, 0);

  const sand = new SandFloor();
  const rooms = buildRooms(scene, sand);
  const key = rooms.key;
  let world: World = "sand";
  let bazaar: Bazaar | null = null;
  let beach: Beach | null = null;
  let windowsGone = false;
  let upperCleared = false;
  let pendingShop = false;
  let lastPortal = -10;
  let windowFlight = false;
  let floorY = 0;
  let strokeReady = false;

  const ensureBazaar = (): Bazaar => {
    if (!bazaar) {
      bazaar = new Bazaar();
      scene.add(bazaar.root);
      scene.add(bazaar.vault);
    }
    return bazaar;
  };
  const ensureBeach = (): Beach => {
    if (!beach) {
      beach = new Beach();
      scene.add(beach.root);
    }
    return beach;
  };

  const purse: Purse = { coins: 0 };
  const purseEl = document.querySelector("#purse") as HTMLParagraphElement;
  const purseCoins = document.querySelector("#purse-coins") as HTMLElement;
  const shopRoot = document.querySelector("#shop");
  if (!(shopRoot instanceof HTMLElement) || !purseEl || !purseCoins) {
    throw new Error("Missing shop or purse markup");
  }

  const figure = new WoodenMannequin();
  scene.add(figure.root);
  void attachRealisticFace(figure);
  const cape = new ClothCape(figure);
  scene.add(cape.mesh);
  const hat = new FurHat(figure);
  const gear = new GearShelf(sand, figure);
  scene.add(gear.group);
  const pickList = figure.pickables();
  const walker = createWalker();
  const restHint = "Tap the sand to walk. With the jetpack on, fly through the glowing window.";

  const showCollect = (): void => {
    if (!(collectHud instanceof HTMLElement)) return;
    collectHud.hidden = world !== "sand" && world !== "roof";
    collectHud.textContent = gear.label();
  };

  const syncHat = (): void => {
    hat.group.visible = !gear.isWorn("beret");
  };

  const activeWindow = (): Mesh => (world === "sand" ? rooms.window : rooms.returnWindow);

  const syncWindowLook = (): void => {
    if (windowsGone) return;
    const pack = gear.isWorn("jetpack");
    const open = gear.allWorn();
    // Frames stay until every find is worn, so the jetpack still flies through them.
    rooms.windowFrame.visible = !open;
    const glow = rooms.windowGlow.material as MeshBasicMaterial;
    if (open) {
      glow.color.setRGB(3.1, 2.7, 2.15);
      glow.transparent = false;
      glow.opacity = 1;
    } else if (pack) {
      glow.color.set("#f3d7a2");
      glow.transparent = true;
      glow.opacity = 0.62;
    } else {
      glow.color.set("#e8c888");
      glow.transparent = true;
      glow.opacity = 0.28;
    }
  };

  const noteGear = (found: string | null): void => {
    if (!found) return;
    syncHat();
    syncWindowLook();
    showCollect();
    hint.textContent = gear.allWorn()
      ? "Every find is on. Tap the glowing window to fly through."
      : found;
  };

  const params = new URLSearchParams(window.location.search);
  const wear = params.get("wear");
  if (wear) {
    for (const id of wear.split(",")) {
      noteGear(gear.forceWear(id as WearId));
    }
  }
  syncWindowLook();
  showCollect();

  figure.refreshWorld();
  const leftLock = createFootLock(figure.worldPos("leftToe"));
  const rightLock = createFootLock(figure.worldPos("rightToe"));
  const holds = new Map<LimbId, Vector3>();
  const leftToe = new Vector3();
  const rightToe = new Vector3();
  const follow = new Vector3();
  let pendingGo: { at: number; point: Vector3 } | null = null;

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

  const syncPurse = (): void => {
    purseCoins.textContent = String(purse.coins);
    purseEl.hidden = world !== "bazaar";
  };

  const shop = bindShop(shopRoot, gear, purse, (message) => {
    syncHat();
    syncPurse();
    hint.textContent = message;
  });

  const paintLook = (): void => {
    document.body.classList.toggle("night", world === "roof");
    document.body.classList.toggle("bazaar", world === "bazaar" || world === "vault");
    document.body.classList.toggle("beach", world === "beach");
    hint.classList.toggle("night", world === "roof");
    hint.classList.toggle("bazaar", world === "bazaar" || world === "vault");
    hint.classList.toggle("beach", world === "beach");
    if (!windowsGone || world !== "roof") {
      if (world === "sand") {
        controls.maxPolarAngle = Math.PI * 0.48;
        controls.minDistance = 1.6;
        controls.maxDistance = 9;
      } else if (world === "roof") {
        controls.maxPolarAngle = Math.PI * 0.72;
        controls.maxDistance = 12;
      }
    }
    if (world === "sand") {
      scene.background = new Color("#efe2c8");
      scene.fog = new Fog("#efe2c8", 14, 32);
      rooms.sky.color.set("#f7f1e6");
      rooms.sky.groundColor.set("#b08958");
      rooms.sky.intensity = 0.7;
      rooms.key.color.set("#fff4d8");
      rooms.key.intensity = 1.48;
      renderer.toneMappingExposure = 1.05;
      scene.environmentIntensity = 0.32;
    } else if (world === "roof") {
      scene.background = new Color("#0b1220");
      scene.fog = new Fog("#0b1220", 16, 36);
      rooms.sky.color.set("#1a2740");
      rooms.sky.groundColor.set("#0a0c10");
      rooms.sky.intensity = 0.38;
      rooms.key.color.set("#c8d4f0");
      rooms.key.intensity = 0.7;
      renderer.toneMappingExposure = 1.05;
      scene.environmentIntensity = 0.32;
    } else if (world === "bazaar") {
      scene.background = new Color("#2a1c16");
      scene.fog = new Fog("#2a1c16", 16, 32);
      rooms.sky.color.set("#ffd8a8");
      rooms.sky.groundColor.set("#3a2418");
      rooms.sky.intensity = 0.85;
      rooms.key.color.set("#ffc898");
      rooms.key.intensity = 1.35;
      renderer.toneMappingExposure = 1.2;
      scene.environmentIntensity = 0.5;
    } else if (world === "vault") {
      scene.background = new Color("#3a2e26");
      scene.fog = new Fog("#3a2e26", 14, 28);
      rooms.sky.color.set("#ffd8b0");
      rooms.sky.groundColor.set("#4a3828");
      rooms.sky.intensity = 0.95;
      rooms.key.color.set("#ffd0a0");
      rooms.key.intensity = 1.4;
      renderer.toneMappingExposure = 1.22;
      scene.environmentIntensity = 0.55;
    } else {
      scene.background = new Color("#9ec8e6");
      scene.fog = new Fog("#b7d6ea", 18, 42);
      rooms.sky.color.set("#fff4dc");
      rooms.sky.groundColor.set("#d2b48c");
      rooms.sky.intensity = 0.92;
      rooms.key.color.set("#fff1c8");
      rooms.key.intensity = 1.55;
      renderer.toneMappingExposure = 1.12;
      scene.environmentIntensity = 0.48;
    }
    showCollect();
  };

  const unloadUpper = (): void => {
    if (upperCleared) return;
    upperCleared = true;
    disposeTree(rooms.home);
    disposeTree(rooms.roof);
    gear.group.visible = false;
  };

  const placeFigure = (x: number, y: number, z: number, view?: { cam: Vector3; look: Vector3 }): void => {
    figure.root.position.set(x, y, z);
    figure.refreshWorld();
    cape.snap();
    figure.worldPos("chest", follow);
    follow.y += 0.08;
    if (view) {
      controls.target.copy(view.look);
      camera.position.copy(view.cam);
    } else {
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(follow);
      camera.position.copy(follow).add(offset);
    }
    if (camera.position.y < 0.8) camera.position.y = 2.15;
  };

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
    hint.textContent = "The window is gone. Walk the stairwell — it drops you into a new level.";
  };

  const enterBazaar = (): void => {
    lastPortal = performance.now() / 1000;
    shop.close();
    pendingShop = false;
    walker.destination = null;
    walker.fly = false;
    walker.speed = 0;
    unloadUpper();
    world = "bazaar";
    const hall = ensureBazaar();
    hall.root.visible = true;
    hall.vault.visible = false;
    gear.setGround(hall.root);
    paintLook();
    placeFigure(0, 0, 2.6, {
      cam: new Vector3(3.4, 1.95, 5.5),
      look: new Vector3(0.7, 0.95, 0.15),
    });
    walker.yaw = Math.PI;
    releasePose();
    controls.maxPolarAngle = Math.PI * 0.86;
    controls.maxDistance = 12;
    syncPurse();
    hint.textContent =
      "The sand room and terrace are gone. Sell what you wear to the twin, then buy his lantern.";
  };

  const enterVault = (): void => {
    lastPortal = performance.now() / 1000;
    shop.close();
    walker.destination = null;
    walker.fly = false;
    walker.speed = 0;
    world = "vault";
    unloadUpper();
    rooms.home.visible = false;
    rooms.roof.visible = false;
    const hall = ensureBazaar();
    gear.setGround(hall.vault);
    hall.root.visible = false;
    hall.vault.visible = true;
    paintLook();
    placeFigure(0, 0, 1.6, {
      cam: new Vector3(2.35, 1.85, 3.4),
      look: new Vector3(0, 0.95, -0.15),
    });
    walker.yaw = Math.PI;
    releasePose();
    controls.minDistance = 1.4;
    controls.maxDistance = 5.8;
    syncPurse();
    hint.textContent = "Walk to each vault light. They die as you reach them.";
  };

  const enterBeach = (): void => {
    lastPortal = performance.now() / 1000;
    shop.close();
    walker.destination = null;
    walker.fly = false;
    walker.speed = 0;
    world = "beach";
    if (bazaar) {
      bazaar.root.visible = false;
      bazaar.vault.visible = false;
    }
    const shore = ensureBeach();
    shore.root.visible = true;
    gear.setGround(shore.root);
    paintLook();
    placeFigure(BEACH_SPAWN.x, 0, BEACH_SPAWN.z, {
      cam: new Vector3(3.6, 2.05, 3.8),
      look: new Vector3(0.2, 0.9, 1.2),
    });
    walker.yaw = 0;
    releasePose();
    controls.minDistance = 1.6;
    controls.maxDistance = 14;
    syncPurse();
    hint.textContent = "The vault is gone. Sand and water — a new level.";
  };

  const enterWorld = (next: "sand" | "roof"): void => {
    if (upperCleared) return;
    lastPortal = performance.now() / 1000;
    windowFlight = false;
    world = next;
    rooms.home.visible = next === "sand";
    rooms.roof.visible = next === "roof";
    gear.group.visible = next === "sand";
    gear.setGround(next === "sand" ? gear.group : rooms.roof);
    strokeReady = false;
    paintLook();
    const offset = camera.position.clone().sub(controls.target);
    figure.root.position.set(-6.1, gear.isWorn("jetpack") ? 1.35 : 0, PORTAL.z);
    figure.refreshWorld();
    cape.snap();
    walker.yaw = 0;
    releasePose();
    figure.worldPos("chest", follow);
    follow.y += 0.08;
    controls.target.copy(follow);
    camera.position.copy(follow).add(offset);
    if (camera.position.y < 0.8) camera.position.y = 2.15;
    if (gear.isWorn("jetpack")) {
      walker.destination = new Vector3(-2, 0, PORTAL.z);
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
        : "Back on the sand. The glowing window is still the way up.";
  };

  const goTo = (point: Vector3, fly: boolean): void => {
    const canFly = fly && (world === "sand" || world === "roof");
    setDestination(walker, point, canFly);
    const down =
      world === "roof" && rooms.stairs.open && point.distanceTo(rooms.stairs.walkIn) < 0.35;
    const stall = world === "bazaar" && point.distanceTo(STALL_FRONT) < 0.35;
    hint.textContent = canFly
      ? "Flying there"
      : down
        ? "Walking down the stairwell"
        : stall
          ? "Walking to the merchant"
          : "Walking there";
  };

  if (params.has("beach")) enterBeach();
  else if (params.has("vault")) {
    gear.forceWear("lantern");
    enterVault();
  } else if (params.has("bazaar")) {
    gear.forceWear("jetpack");
    gear.forceWear("sword");
    gear.forceWear("shirt");
    enterBazaar();
  } else if (params.has("cellar")) {
    gear.forceWear("jetpack");
    gear.forceWear("sword");
    rooms.melons.chop();
    world = "roof";
    rooms.home.visible = false;
    rooms.roof.visible = true;
    gear.group.visible = false;
    paintLook();
    openStairwell();
    figure.root.position.set(-2.4, 0, 1.15);
    figure.refreshWorld();
    cape.snap();
  } else if (params.has("roof")) {
    gear.forceWear("jetpack");
    enterWorld("roof");
  }

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
  let armedWindow = false;
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

  const storeHold = (id: LimbId, worldPoint: Vector3): void => {
    const local = worldPoint.clone();
    if (!isArm(id)) local.y = Math.max(local.y, figure.toeMinHeight + floorY);
    figure.bone(limbAnchor(id)).worldToLocal(local);
    holds.set(id, local);
  };

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      pointerState.x = event.clientX;
      pointerState.y = event.clientY;
      pointerState.moved = false;

      if (world === "vault" || world === "beach") return;

      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      if (
        (world === "sand" || world === "roof") &&
        !windowsGone &&
        pickWindow(raycaster, activeWindow())
      ) {
        // Hold the press so a small drift does not become an orbit and eat the tap.
        armedWindow = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      armedWindow = false;

      const id = pickLimb(event);
      if (!id) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const plane = new Plane();
      camera.getWorldDirection(cameraDir);
      figure.worldPos(limbEndBone(id), worldTarget);
      plane.setFromNormalAndCoplanarPoint(cameraDir, worldTarget);
      const originHit = intersectGrabPlane(event, plane) ? planeHit.clone() : worldTarget.clone();
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
    if (Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y) > 8) {
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

    hover = world === "vault" || world === "beach" ? null : pickLimb(event);
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const wearHover = world === "sand" || world === "roof" ? gear.hit(raycaster) : null;
    const onWindow =
      (world === "sand" || world === "roof") && !windowsGone && pickWindow(raycaster, activeWindow());
    const onMelons = world === "roof" && !upperCleared && rooms.melons.hit(raycaster);
    const onMerchant = world === "bazaar" && !!bazaar?.hit(raycaster);
    const onLamp = world === "vault" && !!bazaar?.lampApproach(raycaster, floorPoint);
    canvas.style.cursor = hover || wearHover || onWindow || onMelons || onMerchant || onLamp ? "pointer" : "";
    if (hover) canvas.style.cursor = "grab";
    if (grab) return;
    if (hover) hint.textContent = `Drag the ${limbLabel(hover)} to pose it`;
    else if (wearHover?.worn) hint.textContent = `Tap to take off the ${wearHover.title}`;
    else if (wearHover) hint.textContent = `Walk over to put on the ${wearHover.title}`;
    else if (onMelons && rooms.melons.chopped) hint.textContent = "Watermelons chopped — nice and ready";
    else if (onMelons && gear.isWorn("sword")) hint.textContent = "Drag the right arm — the knife — through the fruit";
    else if (onMelons) hint.textContent = "Pick up the knife on the table, then swing the right arm";
    else if (onWindow && (gear.isWorn("jetpack") || world === "roof")) {
      hint.textContent = gear.allWorn() ? "Tap the light to fly through" : "Tap to fly through the window";
    } else if (onWindow) hint.textContent = "The jetpack is on the sand — walk to it, then tap the window";
    else if (onLamp) hint.textContent = "Tap a vault light — walk close and it goes out";
    else if (onMerchant) hint.textContent = "Tap the twin — he will buy what you wear and sell a lantern";
    else if (world === "bazaar" && gear.isWorn("lantern") && bazaar?.nearGate(figure.root.position.x, figure.root.position.z)) {
      hint.textContent = "Hold the lantern to the moth-gate";
    } else if (world === "bazaar") {
      hint.textContent = gear.isWorn("lantern")
        ? "Walk the lantern to the sealed arch at the far end"
        : "Sell worn finds to the twin, then buy his brass lantern";
    } else if (world === "vault") {
      hint.textContent = bazaar
        ? `${bazaar.remainingLamps()} vault lights still burn — walk to each`
        : "Walk to each vault light";
    } else if (world === "beach") hint.textContent = "The vault is gone. Sand and water — a new level.";
    else if (windowsGone && world === "roof") {
      hint.textContent = rooms.stairs.open ? "Walk into the stairwell — it drops to a new level" : restHint;
    } else if (!pointerState.moved) {
      hint.textContent = gear.allWorn() ? "The frame is gone — fly through the light" : restHint;
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

    const travel = Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y);
    if (armedWindow) {
      armedWindow = false;
      if (travel < 28) commitWindow();
      return;
    }

    if (pointerState.moved) return;
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const wearHit = world === "sand" || world === "roof" || world === "bazaar" ? gear.hit(raycaster) : null;
    if (wearHit?.worn && world !== "bazaar") {
      hint.textContent = gear.takeOff(wearHit.id) ?? restHint;
      syncHat();
      syncWindowLook();
      showCollect();
      return;
    }
    if (wearHit && !wearHit.worn) {
      gear.walkTarget(wearHit.id, floorPoint);
      floorPoint.y = 0;
      goTo(floorPoint, false);
      hint.textContent = `Walking to the ${wearHit.title}`;
      return;
    }
    if (world === "vault" && bazaar?.lampApproach(raycaster, floorPoint)) {
      goTo(floorPoint, false);
      hint.textContent = "Walking to a vault light";
      return;
    }
    if (world === "bazaar" && bazaar?.hit(raycaster)) {
      if (bazaar.inShopRange(figure.root.position.x, figure.root.position.z)) {
        shop.open();
        hint.textContent = "The twin waits for a trade";
      } else {
        pendingShop = true;
        goTo(STALL_FRONT.clone(), false);
      }
      return;
    }
    if (world === "roof" && !upperCleared && rooms.melons.hit(raycaster)) {
      hint.textContent =
        rooms.melons.takeKnife(gear) ??
        (rooms.melons.chopped
          ? "Watermelons chopped — nice and ready"
          : "Drag the right arm — the knife — through the fruit");
      return;
    }
    if ((world === "sand" || world === "roof") && !windowsGone && pickWindow(raycaster, activeWindow())) {
      commitWindow();
      return;
    }
    const reach =
      world === "roof" ? 10.2 : world === "beach" ? 14 : world === "vault" ? 9.5 : world === "bazaar" ? 8.2 : ROOM + 0.4;
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
      const pad = world === "roof" ? 10 : world === "beach" ? 12 : world === "vault" ? 7.4 : world === "bazaar" ? 5.6 : ROOM;
      floorPoint.x = clamp(floorPoint.x, -pad, pad);
      floorPoint.z = clamp(floorPoint.z, -pad, pad);
      if (world === "roof" && rooms.stairs.open && rooms.stairs.inPit(floorPoint.x, floorPoint.z)) {
        floorPoint.copy(rooms.stairs.walkIn);
      }
      if (world === "vault") bazaar?.pullToLamp(floorPoint);
      floorPoint.y = 0;
      if (world === "sand") noteGear(gear.collectNear(floorPoint.x, floorPoint.z, 0.95));
      const now = performance.now();
      if ((world === "sand" || world === "roof") && gear.isWorn("jetpack") && pendingGo && now - pendingGo.at < DOUBLE_MS) {
        goTo(floorPoint, true);
        pendingGo = null;
        return;
      }
      if ((world === "sand" || world === "roof") && gear.isWorn("jetpack")) {
        pendingGo = { at: now, point: floorPoint.clone() };
        return;
      }
      pendingGo = null;
      goTo(floorPoint, false);
    }
  });

  canvas.addEventListener("pointercancel", (event) => {
    armedWindow = false;
    if (grab && event.pointerId === grab.pointerId) {
      grab = null;
      controls.enabled = true;
    }
  });

  function commitWindow(): void {
    pendingGo = null;
    if (!gear.isWorn("jetpack")) {
      if (world === "roof") {
        enterWorld("sand");
        return;
      }
      gear.walkTarget("jetpack", floorPoint);
      floorPoint.y = 0;
      goTo(floorPoint, false);
      hint.textContent = "Walking to the jetpack — then tap the window";
      return;
    }
    // Fly through the frames. The terrace opens when the body reaches the opening.
    if (!grab) releasePose();
    windowFlight = true;
    setDestination(walker, rooms.portalApproach, true, 2.55);
    hint.textContent = "Flying through the window";
  }

  const pipeline = createImagePipeline(renderer, scene, camera);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    pipeline.setSize(window.innerWidth, window.innerHeight);
  });

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
  const holdWorld = new Vector3();
  const knifeHand = new Vector3();
  const knifeMid = new Vector3();
  const knifeTip = new Vector3();
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
          groundY: floorY,
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
    if (startupFrames < 6 && world === "sand") {
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
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    if (raw === 0) {
      presentScene();
      requestAnimationFrame(tick);
      return;
    }
    // One displayed frame may cover a hitch. Step the body in short slices so a
    // stall does not skip the window, and cap the catch-up so a bad timestamp
    // cannot throw the figure across the room.
    const budget = Math.min(raw, 0.75);
    const dt = Math.min(0.033, budget);

    if (pendingGo && performance.now() - pendingGo.at >= DOUBLE_MS) {
      goTo(pendingGo.point, false);
      pendingGo = null;
    }

    const jet = gear.isWorn("jetpack") && (world === "sand" || world === "roof");
    const wall = performance.now() / 1000;
    let remain = budget;
    let walkWeight = 0;
    let flying = false;
    let arrived = false;
    while (remain > 1e-4) {
      const slice = Math.min(0.05, remain);
      remain -= slice;
      floorY = world === "roof" && !upperCleared ? rooms.stairs.heightAt(figure.root.position.x, figure.root.position.z) : 0;
      const steered = steerWalker(walker, figure.root.position, slice, jet, floorY);
      walkWeight = steered.walkWeight;
      flying = steered.flying;
      arrived = steered.arrived;
      if (world === "roof" && !upperCleared && rooms.stairs.open && wall - lastPortal > 0.8 && floorY <= CELLAR_Y + 0.3) {
        enterBazaar();
      }
      if (
        (world === "sand" || world === "roof") &&
        !windowsGone &&
        flying &&
        wall - lastPortal > 1.3 &&
        crossesWindow(figure.root.position, windowFlight)
      ) {
        enterWorld(world === "sand" ? "roof" : "sand");
      }
    }
    if (world === "bazaar" && pendingShop && arrived && bazaar?.inShopRange(figure.root.position.x, figure.root.position.z)) {
      pendingShop = false;
      shop.open();
      hint.textContent = "The twin waits for a trade";
    }

    const contacts = { leftContact: false, rightContact: false };
    if (flying) {
      poseHover(figure, walker, time);
    } else {
      const posed = poseMannequin(figure, walker, walkWeight, time, {
        leftArm: holds.has("leftArm"),
        rightArm: holds.has("rightArm"),
      });
      contacts.leftContact = posed.leftContact;
      contacts.rightContact = posed.rightContact;
    }
    figure.worldPos("leftToe", leftToe);
    figure.worldPos("rightToe", rightToe);

    if (!flying) {
      const leftTarget = leftToe.clone();
      const rightTarget = rightToe.clone();
      const toeFloor = figure.toeMinHeight + floorY;
      updateFootLockingState(
        leftLock,
        leftToe,
        contacts.leftContact && !holds.has("leftLeg"),
        toeFloor,
        dt,
        UNLOCK_DISTANCE,
        LOCK_DISTANCE,
        BLEND_TIME,
      );
      updateFootLockingState(
        rightLock,
        rightToe,
        contacts.rightContact && !holds.has("rightLeg"),
        toeFloor,
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
          groundY: floorY,
        });
      }
      if (!holds.has("rightLeg")) {
        figure.solveLeg("right", rightTarget, {
          enableHeightClamp: true,
          enableHeelLookAt: true,
          enableToeLookAt: true,
          softening: SOFTENING,
          groundY: floorY,
        });
      }
    }
    applyHolds(walkWeight);

    gear.setThrust(gear.wearing("jetpack") && (flying || walker.speed > 0.2), time);

    if (world === "bazaar" && bazaar) {
      bazaar.poseMerchant(time);
      figure.worldPos("chest", holdWorld);
      const wasShut = !bazaar.gateOpen;
      bazaar.feedLantern(holdWorld, gear.isWorn("lantern"));
      if (wasShut && bazaar.gateOpen) {
        hint.textContent = "The moth-gate split. Walk through — there is no way back.";
      }
      if (wall - lastPortal > 0.8 && bazaar.throughGate(figure.root.position.x, figure.root.position.z)) {
        enterVault();
      }
    }
    if (world === "vault" && bazaar) {
      if (bazaar.snuffNear(figure.root.position.x, figure.root.position.z)) {
        const left = bazaar.remainingLamps();
        hint.textContent =
          left === 0 ? "The last light died. The vault lets go…" : left === 1 ? "One vault light still burns" : `${left} vault lights still burn`;
        if (left === 0) lastPortal = wall;
      }
      if (bazaar.allDark() && wall - lastPortal > 0.85) enterBeach();
    }
    if (world === "beach" && beach) beach.sway(time);

    const focus = grab?.id ?? hover;
    if (focus) {
      figure.worldPos(limbEndBone(focus), highlight.position);
      highlight.visible = true;
    } else {
      highlight.visible = false;
    }

    cape.update(dt, time, walker.speed, walker.yaw, (x, z) => (world === "sand" ? sand.heightAt(x, z) : floorY));
    if (hat.group.visible) hat.update(dt, time, camera, walker.speed, walker.yaw);
    if (!upperCleared && (world === "sand" || world === "roof")) gear.update(time);
    if (world === "sand" && !flying) {
      noteGear(gear.collectNear(figure.root.position.x, figure.root.position.z, 0.55));
    }
    if (!upperCleared) rooms.melons.showLooseKnife(world === "roof" && !gear.isWorn("sword"));
    if (
      !upperCleared &&
      world === "roof" &&
      !gear.isWorn("sword") &&
      rooms.melons.inRange(figure.root.position.x, figure.root.position.z)
    ) {
      const took = rooms.melons.takeKnife(gear);
      if (took) hint.textContent = took;
    }
    if (!upperCleared && world === "roof" && !rooms.melons.chopped && gear.isWorn("sword") && grab?.id === "rightArm") {
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

    if (world === "sand" && !flying && !upperCleared) {
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
    }

    figure.worldPos("chest", follow);
    follow.y += 0.08;
    const high = flying || figure.root.position.y > 0.35;
    const followMax = high ? 5.4 : 2.4;
    const followMin = world === "sand" ? 0.45 : -8;
    if (!Number.isFinite(follow.y) || follow.y < followMin || follow.y > followMax) {
      follow.set(0, 1.03, 0);
    }
    controls.target.lerp(follow, 1 - Math.exp(-3.2 * budget));
    controls.update();
    if (world === "sand" && !flying && (camera.position.y < 0.45 || controls.target.y < 0.45)) {
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

function crossesWindow(pos: Vector3, aimedAtWindow: boolean): boolean {
  if (pos.y <= 0.32) return false;
  const dx = pos.x - PORTAL.x;
  const dz = pos.z - PORTAL.z;
  // Through the frames: past the near edge of the opening, lined up with it.
  if (pos.x < PORTAL.x + 1.05 && Math.abs(dz) < PORTAL.halfW + 0.55) return true;
  // A flight aimed at the window that stops just short of that plane still counts.
  return aimedAtWindow && Math.hypot(dx, dz) < 1.7;
}

function buildRooms(scene: Scene, sand: SandFloor): Rooms {
  const home = new Group();
  home.name = "sand-room";
  home.add(sand.mesh);

  const wallMat = createPlasterMaterial();
  const back = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  back.position.set(0, 3.1, -10);
  back.receiveShadow = true;
  home.add(back);
  const wallPane = (w: number, h: number, x: number, y: number, z: number) => {
    const pane = new Mesh(new PlaneGeometry(w, h), wallMat);
    pane.position.set(x, y, z);
    pane.rotation.y = Math.PI / 2;
    pane.receiveShadow = true;
    home.add(pane);
  };
  wallPane(20, 1.55, -10, 0.775, 0);
  wallPane(20, 1.55, -10, 5.575, 0);
  wallPane(9.95, 3.5, -10, 3.15, -5.025);
  wallPane(7.65, 3.5, -10, 3.15, 6.175);

  const nightView = new Mesh(new PlaneGeometry(2.4, 3.5), new MeshBasicMaterial({ color: "#0b1220" }));
  nightView.name = "nightView";
  nightView.position.set(PORTAL.x - 0.08, PORTAL.y, PORTAL.z);
  nightView.rotation.y = Math.PI / 2;
  home.add(nightView);

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
  home.add(windowGlow);

  const windowPick = new Mesh(
    new PlaneGeometry(4.6, 5.6),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  windowPick.position.set(PORTAL.x + 0.04, PORTAL.y, PORTAL.z);
  windowPick.rotation.y = Math.PI / 2;
  windowPick.name = "studioWindow";
  home.add(windowPick);

  const windowFrame = new Group();
  windowFrame.name = "windowFrame";
  home.add(windowFrame);

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
  scene.add(home);

  const roof = createRooftop();
  const stairs = new Stairwell();
  roof.add(stairs.root);
  const melons = new MelonBoard();
  roof.add(melons.root);
  scene.add(roof);
  const returnWindow = roof.getObjectByName("returnWindow");
  const roofWindow = roof.getObjectByName("roofWindow");
  const floorPlug = roof.getObjectByName("floorPlug");
  if (!(returnWindow instanceof Mesh) || !(roofWindow instanceof Group) || !(floorPlug instanceof Mesh)) {
    throw new Error("Rooftop is missing the return window");
  }

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

  return {
    key,
    sky,
    home,
    roof,
    window: windowPick,
    windowGlow,
    windowFrame,
    nightView,
    returnWindow,
    roofWindow,
    portalApproach: new Vector3(PORTAL.x - 1.35, 0, PORTAL.z),
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
