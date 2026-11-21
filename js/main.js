import * as THREE from 'three';
import { TrabantScene } from './scene.js';
import { CameraRig } from './camera.js';
import { UIController } from './ui.js';

async function bootstrap() {
  const loaderOverlay = document.getElementById('loader-overlay');
  const loaderStatus = document.getElementById('loader-status');
  const loaderBar = document.getElementById('loader-bar');

  const setProgress = (pct, msg) => {
    if (loaderBar) loaderBar.style.width = `${pct}%`;
    if (loaderStatus && msg) loaderStatus.textContent = msg;
  };

  try {
    const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    const cfgUrl = `config/scene_config.json${isLocal ? `?v=${Date.now()}` : ''}`;
    const cfgRes = await fetch(cfgUrl);
    if (!cfgRes.ok) throw new Error(`Nelze nacist config (${cfgRes.status})`);
    const config = await cfgRes.json();

    const canvas = document.getElementById('webgl-canvas');
    const sceneApp = new TrabantScene(canvas, config, setProgress);

    let cameraRig = null;
    const ui = new UIController(config, {
      onSelectChapter: (idx) => {
        if (cameraRig) {
          cameraRig.scrollToChapter(idx);
          ui.setOrbitState(false);
        }
      },
      onStepChapter: (delta) => {
        if (cameraRig) {
          cameraRig.stepChapter(delta);
          ui.setOrbitState(false);
        }
      },
      onSpeedChange: (kmh) => sceneApp.setTargetSpeed(kmh),
      onTerrainToggle: (rough) => sceneApp.setRoughTerrain(rough),
      onToggleOrbit: () => {
        if (!cameraRig) return false;
        return cameraRig.setOrbitMode(!cameraRig.orbitMode);
      },
      onToggleAudio: () => sceneApp.toggleAudio(),
      onPaintChange: (paintId) => sceneApp.setPaintColor(paintId),
      onBonnetToggle: (open) => sceneApp.setBonnetOpen(open, true),
      onWipersToggle: (enabled) => sceneApp.setWipersEnabled(enabled),
      onExpeditionToggle: (enabled) => sceneApp.setExpeditionMode(enabled),
      onExplodeSlider: (val) => sceneApp.setManualExplode(val),
      onAtmosphereChange: (key) => sceneApp.setAtmosphere(key),
      onSnapshot: () => sceneApp.captureSnapshot(),
      onPickPart: (ndcX, ndcY) => {
        const picked = sceneApp.pickTrabantPart(ndcX, ndcY);
        sceneApp.setHighlightedPart(picked ? picked.mesh : null);
        return picked;
      },
      onHoverPart: (ndcX, ndcY) => sceneApp.pickTrabantPart(ndcX, ndcY),
      onClearPart: () => sceneApp.setHighlightedPart(null),
    });

    cameraRig = new CameraRig(
      sceneApp.camera,
      canvas,
      config,
      (idx) => {
        ui.setChapter(idx);
        sceneApp.syncChapterBonnet(idx === 1);
        if (sceneApp.manualBonnet === null) {
          ui.setBonnetButtonState(idx === 1);
        }
      },
      (p) => {
        ui.setProgress(p);
        sceneApp.setScrollProgress(p);
        if (sceneApp.manualExplode === null) {
          ui.syncExplodeSlider(sceneApp.explodeFactor);
        }
      }
    );

    await sceneApp.loadAll();

    window.addEventListener('resize', () => sceneApp.resize());

    if (loaderOverlay) {
      setTimeout(() => loaderOverlay.classList.add('is-done'), 260);
    }

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const dt = clock.getDelta();
      sceneApp.update(dt);
      cameraRig.update(dt, sceneApp.elapsed, sceneApp.speedKmh, sceneApp.roughTerrain);
      ui.updateHotspots(sceneApp.camera, sceneApp.trabantGroup);
      sceneApp.render();
    }
    animate();
  } catch (err) {
    console.error('[APP] Kriticka chyba inicializace:', err);
    if (loaderStatus) {
      loaderStatus.textContent = `Chyba načítání 3D scény: ${err.message}`;
    }
  }
}

bootstrap();
