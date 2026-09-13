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
import { createGrassBlades, createGrassGround } from "./grass";
import { createImagePipeline } from "./pipeline";
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

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 60);
  camera.position.set(3.4, 2.15, 4.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.target.set(0, 0.95, 0);

  const key = buildRoom(scene);

  const figure = new WoodenMannequin();
  scene.add(figure.root);
  const cape = new ClothCape(figure);
  scene.add(cape.mesh);
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
        : "Grab an arm or a leg to pose it";
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
      setDestination(walker, floorPoint);
      hint.textContent = "Walking there";
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
  const holdWorld = new Vector3();
  let last = performance.now();

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

  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const time = now / 1000;

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

    cape.update(dt, time, walker.speed, walker.yaw);

    figure.worldPos("chest", follow);
    follow.y += 0.08;
    controls.target.lerp(follow, 1 - Math.exp(-3.2 * dt));
    controls.update();
    snapKeyShadow(key, follow);

    pipeline.render(true, true, true, false);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
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

function buildRoom(scene: Scene): DirectionalLight {
  scene.add(createGrassGround());
  scene.add(createGrassBlades());

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
