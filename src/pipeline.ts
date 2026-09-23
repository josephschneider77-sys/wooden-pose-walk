import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import type { Camera, Scene } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export interface ImagePipeline {
  composer: EffectComposer;
  gtao: GTAOPass;
  bloom: UnrealBloomPass;
  setSize: (width: number, height: number) => void;
  render: (enabled: boolean, ao: boolean, bloom: boolean, aoDebug: boolean) => void;
}

/**
 * HDR scene → GTAO (indirect contact) → bloom → ACES once.
 * No-post path is renderer.render; the studio must still read without this.
 */
export function createImagePipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): ImagePipeline {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const size = renderer.getSize(new Vector2());
  const pixelRatio = renderer.getPixelRatio();
  // Bloom adds its result into this buffer. A half-float target accepts
  // that blend poorly here: the beauty pass is replaced with a clear
  // frame, and the page shows only its beige background. 8-bit targets
  // keep the same GTAO, bloom, and ACES chain on screen.
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
      type: UnsignedByteType,
    }),
  );
  composer.setPixelRatio(pixelRatio);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.48;
  gtao.updateGtaoMaterial({
    radius: 0.22,
    distanceExponent: 1.6,
    thickness: 0.08,
    scale: 0.85,
    samples: 16,
    screenSpaceRadius: false,
  });
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(size, 0.18, 0.32, 0.92);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  return {
    composer,
    gtao,
    bloom,
    setSize(width, height) {
      composer.setSize(width, height);
    },
    render(enabled, ao, bloomOn, aoDebug) {
      if (!enabled) {
        renderer.render(scene, camera);
        return;
      }
      gtao.enabled = ao || aoDebug;
      gtao.output = aoDebug ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
      bloom.enabled = bloomOn && !aoDebug;
      composer.render();
    },
  };
}
