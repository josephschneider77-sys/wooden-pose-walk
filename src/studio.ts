import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createFootLock, updateFootLockingState } from "./footLock";
import {
  createWalker,
  describeGait,
  poseMannequin,
  setDestination,
  steerWalker,
} from "./locomotion";
import { ClothCape } from "./cape";
import { WoodenMannequin } from "./mannequin";
import { clamp } from "./math";
import { createWoodMaterial } from "./wood";

const ROOM = 8.4;
const SOFTENING = 0.012;
const UNLOCK_DISTANCE = 0.2;
const LOCK_DISTANCE = 0.09;
const BLEND_TIME = 0.14;

interface Toggles {
  ik: boolean;
  lock: boolean;
  clampHeight: boolean;
  markers: boolean;
}

export function startStudio(canvas: HTMLCanvasElement): void {
  const hint = document.querySelector("#hint") as HTMLParagraphElement;
  const status = document.querySelector("#status") as HTMLParagraphElement;
  const toggles = bindToggles();

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color("#e7d2b4");
  scene.fog = new Fog("#e7d2b4", 11, 26);

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.08, 60);
  camera.position.set(3.4, 2.15, 4.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.target.set(0, 0.95, 0);

  buildRoom(scene);

  const figure = new WoodenMannequin();
  scene.add(figure.root);
  const cape = new ClothCape(figure);
  scene.add(cape.mesh);

  const walker = createWalker();
  figure.refreshWorld();
  const leftLock = createFootLock(figure.worldPos("leftToe"));
  const rightLock = createFootLock(figure.worldPos("rightToe"));

  const targetMark = makeTargetMark();
  scene.add(targetMark);
  const leftMark = makeContactMark("#d7a441");
  const rightMark = makeContactMark("#6ea0c4");
  scene.add(leftMark, rightMark);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floorPoint = new Vector3();
  const pointerState = { x: 0, y: 0, moved: false };

  canvas.addEventListener("pointerdown", (event) => {
    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.moved = false;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (
      Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y) > 10
    ) {
      pointerState.moved = true;
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointerState.moved) return;
    if (pickFloor(event, camera, raycaster, pointer, floorPoint)) {
      floorPoint.x = clamp(floorPoint.x, -ROOM, ROOM);
      floorPoint.z = clamp(floorPoint.z, -ROOM, ROOM);
      floorPoint.y = 0;
      setDestination(walker, floorPoint);
      targetMark.position.copy(floorPoint);
      targetMark.visible = true;
      hint.textContent = "Walking there — watch the planted toes";
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const follow = new Vector3();
  const leftToe = new Vector3();
  const rightToe = new Vector3();
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const time = now / 1000;

    const { walkWeight, arrived } = steerWalker(walker, figure.root.position, dt);
    if (arrived) targetMark.visible = false;

    const contacts = poseMannequin(figure, walker, walkWeight, time);
    figure.worldPos("leftToe", leftToe);
    figure.worldPos("rightToe", rightToe);

    const leftTarget = leftToe.clone();
    const rightTarget = rightToe.clone();

    if (toggles.lock) {
      updateFootLockingState(
        leftLock,
        leftToe,
        contacts.leftContact,
        figure.toeMinHeight,
        dt,
        UNLOCK_DISTANCE,
        LOCK_DISTANCE,
        BLEND_TIME,
      );
      updateFootLockingState(
        rightLock,
        rightToe,
        contacts.rightContact,
        figure.toeMinHeight,
        dt,
        UNLOCK_DISTANCE,
        LOCK_DISTANCE,
        BLEND_TIME,
      );
      leftTarget.copy(leftLock.position);
      rightTarget.copy(rightLock.position);
    } else {
      leftLock.locked = false;
      rightLock.locked = false;
    }

    if (toggles.ik) {
      figure.solveLeg("left", leftTarget, {
        enableHeightClamp: toggles.clampHeight,
        enableHeelLookAt: true,
        enableToeLookAt: true,
        softening: SOFTENING,
      });
      figure.solveLeg("right", rightTarget, {
        enableHeightClamp: toggles.clampHeight,
        enableHeelLookAt: true,
        enableToeLookAt: true,
        softening: SOFTENING,
      });
    }

    leftMark.visible = toggles.markers;
    rightMark.visible = toggles.markers;
    leftMark.position.copy(leftTarget);
    rightMark.position.copy(rightTarget);
    leftMark.scale.setScalar(leftLock.locked ? 1.15 : 0.75);
    rightMark.scale.setScalar(rightLock.locked ? 1.15 : 0.75);

    cape.update(dt, time, walker.speed, walker.yaw);

    figure.worldPos("chest", follow);
    follow.y += 0.08;
    controls.target.lerp(follow, 1 - Math.exp(-3.2 * dt));
    controls.update();
    targetMark.rotation.y = time * 0.7;

    status.textContent = describeGait(
      walkWeight,
      leftLock.locked,
      rightLock.locked,
      toggles.ik,
      toggles.lock,
    );

    renderer.render(scene, camera);
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

function bindToggles(): Toggles {
  const toggles: Toggles = {
    ik: true,
    lock: true,
    clampHeight: true,
    markers: false,
  };
  const map: Array<[string, keyof Toggles]> = [
    ["#toggle-ik", "ik"],
    ["#toggle-lock", "lock"],
    ["#toggle-clamp", "clampHeight"],
    ["#toggle-markers", "markers"],
  ];
  for (const [selector, key] of map) {
    const input = document.querySelector(selector) as HTMLInputElement;
    input.checked = toggles[key];
    input.addEventListener("change", () => {
      toggles[key] = input.checked;
    });
  }
  return toggles;
}

function buildRoom(scene: Scene): void {
  const floorMat = createWoodMaterial({
    base: "#b88852",
    seed: 7,
    repeatX: 8,
    repeatY: 8,
    roughness: 0.62,
    clearcoat: 0.18,
  });
  const floor = new Mesh(new PlaneGeometry(28, 28), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const tape = new MeshPhysicalMaterial({
    color: "#d8c4a0",
    roughness: 0.55,
    metalness: 0,
  });
  const ring = new Mesh(new RingGeometry(2.15, 2.22, 64), tape);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  scene.add(ring);
  const inner = new Mesh(new RingGeometry(0.95, 1.0, 48), tape);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.004;
  scene.add(inner);

  const wallMat = new MeshPhysicalMaterial({
    color: "#f3e2c6",
    roughness: 0.9,
    metalness: 0,
  });
  const back = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  back.position.set(0, 3.1, -10);
  back.receiveShadow = true;
  scene.add(back);
  const left = new Mesh(new PlaneGeometry(20, 6.5), wallMat);
  left.position.set(-10, 3.1, 0);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  scene.add(left);

  const hemi = new HemisphereLight("#fff4e4", "#8b6a44", 1.05);
  scene.add(hemi);
  const key = new DirectionalLight("#fff1d6", 1.85);
  key.position.set(4.5, 7.2, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new DirectionalLight("#cfe4ff", 0.35);
  fill.position.set(-5, 3.2, -2);
  scene.add(fill);
}

function makeTargetMark(): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.2, 0.28, 32),
    new MeshPhysicalMaterial({
      color: "#c45a2a",
      roughness: 0.4,
      metalness: 0,
      transparent: true,
      opacity: 0.92,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);
  group.visible = false;
  return group;
}

function makeContactMark(color: string): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(0.028, 14, 10),
    new MeshPhysicalMaterial({
      color,
      roughness: 0.25,
      metalness: 0.05,
      emissive: color,
      emissiveIntensity: 0.18,
    }),
  );
  mesh.visible = false;
  return mesh;
}
