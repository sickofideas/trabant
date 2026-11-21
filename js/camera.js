import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  constructor(camera, domElement, config, onChapterChange, onScrollProgress) {
    this.camera = camera;
    this.domElement = domElement;
    this.cfg = config;
    this.chapters = config.chapters;
    this.onChapterChange = onChapterChange || (() => {});
    this.onScrollProgress = onScrollProgress || (() => {});

    this.orbitMode = false;
    this.scrollProgress = 0;
    this.smoothProgress = 0;
    this.currentChapterIndex = 0;

    this.currentTarget = new THREE.Vector3(...this.chapters[0].camera.target);
    this._tmpPos = new THREE.Vector3();
    this._tmpTarget = new THREE.Vector3();

    this._buildCurves();
    this._initOrbitControls();
    this._initScrollAndLenis();
  }

  _buildCurves() {
    const posPoints = this.chapters.map((c) => new THREE.Vector3(...c.camera.pos));
    const targetPoints = this.chapters.map((c) => new THREE.Vector3(...c.camera.target));

    this.posCurve = new THREE.CatmullRomCurve3(posPoints, false, 'catmullrom', 0.45);
    this.targetCurve = new THREE.CatmullRomCurve3(targetPoints, false, 'catmullrom', 0.45);
    this.fovStops = this.chapters.map((c) => c.camera.fov || 38);
  }

  _initOrbitControls() {
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 2.1;
    this.controls.maxDistance = 16.5;
    this.controls.maxPolarAngle = Math.PI * 0.485; // nepodjede pod silnici
    this.controls.target.copy(this.currentTarget);
    this.controls.enabled = false;
  }

  _initScrollAndLenis() {
    const track = document.getElementById('scroll-track');
    if (track) {
      track.innerHTML = '';
      this.chapters.forEach((ch, idx) => {
        const sec = document.createElement('section');
        sec.className = 'scroll-section';
        sec.dataset.chapterIndex = String(idx);
        sec.id = `chapter-sec-${ch.id}`;
        track.appendChild(sec);
      });
    }

    // Plynuly scroll pres Lenis
    if (window.Lenis) {
      this.lenis = new window.Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 0.9,
      });
    }

    // GSAP ScrollTrigger napojeny na celkovy scroll-track
    if (window.gsap && window.ScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);
      if (this.lenis) {
        this.lenis.on('scroll', window.ScrollTrigger.update);
      }

      window.ScrollTrigger.create({
        trigger: '#scroll-track',
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          this.scrollProgress = THREE.MathUtils.clamp(self.progress, 0, 1);
          this._syncChapterIndex(this.scrollProgress);
          this.onScrollProgress(this.scrollProgress);
        },
      });
    } else {
      window.addEventListener('scroll', () => {
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        this.scrollProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
        this._syncChapterIndex(this.scrollProgress);
        this.onScrollProgress(this.scrollProgress);
      });
    }
  }

  _syncChapterIndex(progress) {
    const last = this.chapters.length - 1;
    const idx = Math.round(progress * last);
    if (idx !== this.currentChapterIndex) {
      this.currentChapterIndex = idx;
      this.onChapterChange(idx);
    }
  }

  scrollToChapter(index) {
    const clamped = Math.max(0, Math.min(this.chapters.length - 1, index));
    if (this.orbitMode) {
      this.setOrbitMode(false);
    }
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = (clamped / Math.max(1, this.chapters.length - 1)) * maxScroll;

    if (this.lenis) {
      this.lenis.scrollTo(targetY, { duration: 1.25 });
    } else {
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    }
  }

  stepChapter(delta) {
    const next = Math.max(0, Math.min(this.chapters.length - 1, this.currentChapterIndex + delta));
    this.scrollToChapter(next);
    return next;
  }

  setOrbitMode(enabled) {
    this.orbitMode = Boolean(enabled);
    this.controls.enabled = this.orbitMode;
    document.body.classList.toggle('is-orbit-mode', this.orbitMode);

    if (this.orbitMode) {
      this.controls.target.copy(this.currentTarget);
      this.controls.update();
      if (this.lenis) this.lenis.stop();
    } else {
      if (this.lenis) this.lenis.start();
    }
    return this.orbitMode;
  }

  _sampleFov(t) {
    const n = this.fovStops.length - 1;
    const f = t * n;
    const i0 = Math.floor(f);
    const i1 = Math.min(n, i0 + 1);
    const alpha = f - i0;
    return THREE.MathUtils.lerp(this.fovStops[i0], this.fovStops[i1], alpha);
  }

  update(dt, elapsed, speedKmh, roughTerrain = false) {
    if (this.lenis && !this.orbitMode) {
      this.lenis.raf(performance.now());
    }

    if (this.orbitMode) {
      this.controls.update();
      return;
    }

    const lerpRate = Math.min(1, dt * 6.5);
    this.smoothProgress += (this.scrollProgress - this.smoothProgress) * lerpRate;
    const t = THREE.MathUtils.clamp(this.smoothProgress, 0, 1);

    this.posCurve.getPointAt(t, this._tmpPos);
    this.targetCurve.getPointAt(t, this._tmpTarget);

    // Realisticky pohyb kamery jedouci v doprovodnem aute po stejne prasne ceste (vypne se pri 0 km/h nebo v rozpadu)
    const speedFactor = THREE.MathUtils.clamp(speedKmh / 50, 0, 1.3);
    const blueprintFade = 1 - THREE.MathUtils.clamp((t - 0.72) / 0.12, 0, 1);
    const roughMult = roughTerrain ? 2.4 : 1.0;
    const camAmp = 0.026 * speedFactor * blueprintFade * roughMult;
    this._tmpPos.x += (Math.sin(elapsed * 1.45) * 0.7 + Math.sin(elapsed * 4.2) * 0.3) * camAmp;
    this._tmpPos.y += (Math.cos(elapsed * 2.35) * 0.65 + Math.sin(elapsed * 6.8) * 0.25) * camAmp * 0.65;
    this._tmpTarget.y += Math.sin(elapsed * 3.1) * camAmp * 0.28;

    this.camera.position.lerp(this._tmpPos, Math.min(1, dt * 8.5));
    // Na uzkych displejich na vysku posuneme zaber pri jizde mirne dolu (auto vyse nad spodni kartou) a rozsirime FOV
    if (this.camera.aspect < 0.95) {
      this._tmpTarget.y -= 0.18 * blueprintFade;
    }
    this.currentTarget.lerp(this._tmpTarget, Math.min(1, dt * 9.5));
    this.camera.lookAt(this.currentTarget);

    const baseFov = this._sampleFov(t);
    const portraitBoost = this.camera.aspect < 1.0
      ? THREE.MathUtils.clamp(1.0 + (1.0 - this.camera.aspect) * 0.62, 1.0, 1.46)
      : 1.0;
    const desiredFov = baseFov * portraitBoost;
    if (Math.abs(this.camera.fov - desiredFov) > 0.02) {
      this.camera.fov += (desiredFov - this.camera.fov) * Math.min(1, dt * 6.0);
      this.camera.updateProjectionMatrix();
    }
  }
}
