import * as THREE from 'three';
import { TrabantScene } from './scene.js';
import { CameraRig } from './camera.js';
import { UIController } from './ui.js';
import { ScrollSequencePlayer } from './scroll_sequence.js';

async function bootstrap() {
  const loaderOverlay = document.getElementById('loader-overlay');
  const loaderStatus = document.getElementById('loader-status');
  const loaderBar = document.getElementById('loader-bar');
  const webglCanvas = document.getElementById('webgl-canvas');
  const seqCanvas = document.getElementById('sequence-canvas');

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

    const svCfg = config.scrollVideo || {};
    const totalChapters = Math.max(1, (config.chapters || []).length);
    const interactiveFromChapter =
      typeof svCfg.interactiveFromChapter === 'number' ? svCfg.interactiveFromChapter : null;
    const filmEndProgress =
      interactiveFromChapter === null
        ? 1.0
        : Math.max(0.1, (interactiveFromChapter - 0.35) / Math.max(1, totalChapters - 1));

    const sceneApp = new TrabantScene(webglCanvas, config, (pct, msg) => {
      if (!framesAvailable) {
        setProgress(pct, msg);
      }
    });

    let ui = null;
    let cameraRig = null;
    let framesAvailable = false;
    let manualMode = svCfg.defaultMode === '3d' ? '3d' : 'hybrid';
    let currentProgress = 0;
    let currentChapter = 0;
    let filmActive = false;
    let threeLoaded = false;
    let threeLoadPromise = null;

    const seqPlayer = new ScrollSequencePlayer(seqCanvas, svCfg, {
      onInitialProgress: (pct) => {
        if (framesAvailable) {
          setProgress(15 + Math.round(pct * 0.85), 'Načítám úvodní filmové snímky…');
        }
      },
      onPreloadProgress: () => {
        if (ui && filmActive) {
          ui.updateFilmPill(seqPlayer.getInfo());
        }
      },
    });

    const ensureThreeLoaded = () => {
      if (threeLoadPromise) return threeLoadPromise;
      threeLoadPromise = sceneApp.loadAll().then(() => {
        threeLoaded = true;
        sceneApp.setScrollProgress(currentProgress);
        syncVisualMode();
      });
      return threeLoadPromise;
    };

    const shouldUseFilm = (progress) => {
      if (!framesAvailable) return false;
      if (manualMode !== 'hybrid') return false;
      if (cameraRig && cameraRig.orbitMode) return false;
      if (document.body.classList.contains('is-photo-mode')) return false;
      if (interactiveFromChapter !== null && progress >= filmEndProgress) return false;
      return true;
    };

    const syncVisualMode = () => {
      const nextFilm = shouldUseFilm(currentProgress);
      const changed = nextFilm !== filmActive;
      filmActive = nextFilm;

      if (seqCanvas) {
        seqCanvas.classList.toggle('is-hidden', !filmActive);
      }
      seqPlayer.setActive(filmActive);

      if (!filmActive && !threeLoaded) {
        ensureThreeLoaded();
      }
      if (changed && !filmActive && threeLoaded) {
        sceneApp.setScrollProgress(currentProgress);
      }

      if (ui) {
        ui.setViewModeState({
          filmActive,
          framesAvailable,
          manualMode,
          loading3D: !filmActive && !threeLoaded,
          frameInfo: seqPlayer.getInfo(),
        });
      }
    };

    const force3DMode = () => {
      if (manualMode !== '3d' || filmActive) {
        manualMode = '3d';
        syncVisualMode();
      }
    };

    ui = new UIController(config, {
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
      onToggleViewMode: () => {
        if (!framesAvailable) {
          force3DMode();
          if (ui && ui.hintEl) {
            ui.hintEl.textContent = 'WebP snímky zatím chybí — spusť vygeneruj_scroll_video.bat nebo prevest_mp4_na_webp.bat';
          }
          return;
        }
        if (filmActive) {
          manualMode = '3d';
          syncVisualMode();
        } else {
          manualMode = 'hybrid';
          if (cameraRig && cameraRig.orbitMode) {
            cameraRig.setOrbitMode(false);
            ui.setOrbitState(false);
          }
          if (document.body.classList.contains('is-photo-mode')) {
            ui.setPhotoMode(false);
          }
          if (interactiveFromChapter !== null && currentProgress >= filmEndProgress && cameraRig) {
            cameraRig.scrollToChapter(Math.max(0, interactiveFromChapter - 1));
          }
          syncVisualMode();
        }
      },
      onForce3DMode: force3DMode,
      onSpeedChange: (kmh) => {
        force3DMode();
        sceneApp.setTargetSpeed(kmh);
      },
      onTerrainToggle: (rough) => {
        force3DMode();
        sceneApp.setRoughTerrain(rough);
      },
      onToggleOrbit: () => {
        if (!cameraRig) return false;
        const enabled = cameraRig.setOrbitMode(!cameraRig.orbitMode);
        if (enabled) force3DMode();
        else syncVisualMode();
        return enabled;
      },
      onToggleAudio: () => sceneApp.toggleAudio(),
      onPaintChange: (paintId) => {
        force3DMode();
        sceneApp.setPaintColor(paintId);
      },
      onBonnetToggle: (open) => {
        force3DMode();
        sceneApp.setBonnetOpen(open, true);
      },
      onWipersToggle: (enabled) => {
        force3DMode();
        sceneApp.setWipersEnabled(enabled);
      },
      onExpeditionToggle: (enabled) => {
        force3DMode();
        sceneApp.setExpeditionMode(enabled);
      },
      onExplodeSlider: (val) => {
        if (val !== null) force3DMode();
        sceneApp.setManualExplode(val);
      },
      onAtmosphereChange: (key) => {
        force3DMode();
        return sceneApp.setAtmosphere(key);
      },
      onSnapshot: () => {
        force3DMode();
        sceneApp.captureSnapshot();
      },
      onPickPart: (ndcX, ndcY) => {
        if (filmActive) return null;
        const picked = sceneApp.pickTrabantPart(ndcX, ndcY);
        sceneApp.setHighlightedPart(picked ? picked.mesh : null);
        return picked;
      },
      onHoverPart: (ndcX, ndcY) => (filmActive ? null : sceneApp.pickTrabantPart(ndcX, ndcY)),
      onClearPart: () => sceneApp.setHighlightedPart(null),
    });

    cameraRig = new CameraRig(
      sceneApp.camera,
      webglCanvas,
      config,
      (idx) => {
        currentChapter = idx;
        ui.setChapter(idx);
        sceneApp.syncChapterBonnet(idx === 1);
        if (sceneApp.manualBonnet === null) {
          ui.setBonnetButtonState(idx === 1);
        }
      },
      (p) => {
        currentProgress = p;
        ui.setProgress(p);
        seqPlayer.setScrollProgress(p, filmEndProgress);
        if (threeLoaded) {
          sceneApp.setScrollProgress(p);
          if (sceneApp.manualExplode === null) {
            ui.syncExplodeSlider(sceneApp.explodeFactor);
          }
        }
        syncVisualMode();
      }
    );

    setProgress(8, 'Hledám filmovou WebP sekvenci…');
    framesAvailable = await seqPlayer.probeAvailable();

    if (framesAvailable) {
      await seqPlayer.initInitialFrames();
      seqPlayer.setScrollProgress(currentProgress, filmEndProgress);
      syncVisualMode();
      setProgress(100, 'Připraveno k jízdě!');
      if (loaderOverlay) {
        setTimeout(() => loaderOverlay.classList.add('is-done'), 180);
      }
      seqPlayer.startBackgroundPreload();
      // Three.js pro 7. a 8. kapitolu (rozpad & dilna) nacteme tise na pozadi
      setTimeout(() => {
        ensureThreeLoaded();
      }, 650);
    } else {
      manualMode = '3d';
      syncVisualMode();
      await ensureThreeLoaded();
      if (loaderOverlay) {
        setTimeout(() => loaderOverlay.classList.add('is-done'), 260);
      }
    }

    window.addEventListener('resize', () => {
      seqPlayer.resize();
      sceneApp.resize();
    });

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const dt = clock.getDelta();
      cameraRig.update(dt, sceneApp.elapsed, sceneApp.speedKmh, sceneApp.roughTerrain);

      if (filmActive) {
        seqPlayer.draw();
        return;
      }

      if (threeLoaded) {
        sceneApp.update(dt);
        ui.updateHotspots(sceneApp.camera, sceneApp.trabantGroup);
        sceneApp.render();
      }
    }
    animate();
  } catch (err) {
    console.error('[APP] Kriticka chyba inicializace:', err);
    if (loaderStatus) {
      loaderStatus.textContent = `Chyba načítání scény: ${err.message}`;
    }
  }
}

bootstrap();
