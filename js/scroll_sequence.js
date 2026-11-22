/**
 * Prehravac predrenderovane WebP sekvence (Cycles raytracing / AI video) na HTML5 <canvas>.
 * - Progresivni preload: nejprve nacte prvnich N snimku pro okamzity start, zbytek dotahne na pozadi
 *   s prioritou podle aktualni pozice scrollu.
 * - Vykresluje v rezimu object-fit: cover s podporou devicePixelRatio (max 2).
 */
export class ScrollSequencePlayer {
  constructor(canvas, config = {}, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.cfg = config || {};
    this.onPreloadProgress = options.onPreloadProgress || (() => {});
    this.onInitialProgress = options.onInitialProgress || (() => {});

    this.frameCount = Math.max(1, Number(this.cfg.frameCount) || 180);
    this.preloadInitial = Math.min(this.frameCount, Math.max(4, Number(this.cfg.preloadInitial) || 18));
    this.mobileMaxWidth = Number(this.cfg.mobileMaxWidth) || 768;

    this.frames = new Array(this.frameCount).fill(null);
    this.frameStates = new Array(this.frameCount).fill(0); // 0=idle, 1=loading, 2=loaded, -1=error
    this.loadedCount = 0;

    this.available = false;
    this.active = false;
    this.targetFrame = 0;
    this.drawnFrame = -1;
    this._bgStarted = false;
    this._needsRedraw = true;

    this._cacheBust = ['localhost', '127.0.0.1', ''].includes(window.location.hostname)
      ? `?v=${Date.now()}`
      : '';

    this.isMobileSource = this._detectMobileSource();
    this.resize();
  }

  _detectMobileSource() {
    if (!this.cfg.mobilePattern) return false;
    const narrow = window.innerWidth <= this.mobileMaxWidth;
    const coarse = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 960;
    return narrow || coarse;
  }

  _frameUrl(index) {
    const pattern = this.isMobileSource
      ? (this.cfg.mobilePattern || this.cfg.desktopPattern)
      : (this.cfg.desktopPattern || this.cfg.mobilePattern);
    if (!pattern) return '';
    const num = index + 1;
    const pad4 = String(num).padStart(4, '0');
    const pad3 = String(num).padStart(3, '0');
    return pattern
      .replace('{pad4}', pad4)
      .replace('{pad3}', pad3)
      .replace('{num}', String(num)) + this._cacheBust;
  }

  _loadSingleFrame(index) {
    if (index < 0 || index >= this.frameCount) return Promise.resolve(false);
    if (this.frameStates[index] === 2) return Promise.resolve(true);
    if (this.frameStates[index] === -1) return Promise.resolve(false);

    if (this._inflight && this._inflight.has(index)) {
      return this._inflight.get(index);
    }
    if (!this._inflight) this._inflight = new Map();

    const url = this._frameUrl(index);
    if (!url) {
      this.frameStates[index] = -1;
      return Promise.resolve(false);
    }

    this.frameStates[index] = 1;
    const p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.frames[index] = img;
        if (this.frameStates[index] !== 2) {
          this.frameStates[index] = 2;
          this.loadedCount += 1;
        }
        this._inflight.delete(index);
        this.onPreloadProgress(this.loadedCount, this.frameCount);
        if (index === this.targetFrame || this.drawnFrame === -1) {
          this._needsRedraw = true;
          if (this.active) this.draw();
        }
        resolve(true);
      };
      img.onerror = () => {
        this.frameStates[index] = -1;
        this._inflight.delete(index);
        resolve(false);
      };
      img.src = url;
    });
    this._inflight.set(index, p);
    return p;
  }

  /**
   * Rychle overi, zda existuje prvni snimek sekvence (bez padu, kdyz jeste nebyly vyrenderovany).
   */
  async probeAvailable() {
    if (this.cfg.enabled === false) {
      this.available = false;
      return false;
    }
    const ok = await this._loadSingleFrame(0);
    if (!ok && this.isMobileSource && this.cfg.desktopPattern && this.cfg.desktopPattern !== this.cfg.mobilePattern) {
      // Fallback na desktopovou sadu, pokud mobilni nebyla vygenerovana
      this.isMobileSource = false;
      this.frameStates[0] = 0;
      const desktopOk = await this._loadSingleFrame(0);
      this.available = desktopOk;
      return desktopOk;
    }
    this.available = ok;
    return ok;
  }

  /**
   * Nacte prvnich preloadInitial snimku pro okamzite zobrazeni stranky.
   */
  async initInitialFrames() {
    if (!this.available) return false;
    const initialIndices = [];
    for (let i = 0; i < this.preloadInitial; i++) {
      initialIndices.push(i);
    }

    let done = 0;
    const concurrency = 4;
    let cursor = 0;

    const worker = async () => {
      while (cursor < initialIndices.length) {
        const idx = initialIndices[cursor++];
        await this._loadSingleFrame(idx);
        done += 1;
        const pct = Math.round((done / initialIndices.length) * 100);
        this.onInitialProgress(pct, done, initialIndices.length);
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, initialIndices.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    this._needsRedraw = true;
    this.draw();
    return this.loadedCount > 0;
  }

  /**
   * Na pozadi postupne dotahne vsechny zbyvajici snimky s prioritou okoli aktualniho snimku.
   */
  startBackgroundPreload() {
    if (!this.available || this._bgStarted) return;
    this._bgStarted = true;

    const pending = [];
    for (let i = 0; i < this.frameCount; i++) {
      if (this.frameStates[i] === 0) pending.push(i);
    }
    if (pending.length === 0) return;

    const concurrency = 4;
    const pickNext = () => {
      let bestPos = -1;
      let bestDist = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const idx = pending[i];
        if (this.frameStates[idx] !== 0) continue;
        const dist = Math.abs(idx - this.targetFrame);
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = i;
          if (dist === 0) break;
        }
      }
      if (bestPos === -1) return null;
      return pending.splice(bestPos, 1)[0];
    };

    const worker = async () => {
      while (pending.length > 0) {
        const nextIdx = pickNext();
        if (nextIdx === null) break;
        await this._loadSingleFrame(nextIdx);
      }
    };

    for (let w = 0; w < concurrency; w++) {
      worker();
    }
  }

  setActive(active) {
    this.active = Boolean(active);
    if (this.active) {
      this._needsRedraw = true;
      this.draw();
    }
  }

  /**
   * Nastavi cilovy snimek ze scroll progressu (0..1) a rozsahu filmovych kapitol.
   */
  setScrollProgress(progress, filmEndProgress = 1.0) {
    const span = Math.max(0.05, filmEndProgress);
    const localT = Math.max(0, Math.min(1, progress / span));
    const idx = Math.min(this.frameCount - 1, Math.max(0, Math.round(localT * (this.frameCount - 1))));
    if (idx !== this.targetFrame) {
      this.targetFrame = idx;
      this._needsRedraw = true;
      if (this.frameStates[idx] === 0) {
        this._loadSingleFrame(idx);
      }
    }
    if (this.active) {
      this.draw();
    }
  }

  _findNearestLoadedFrame(target) {
    if (this.frames[target]) return target;
    for (let offset = 1; offset < this.frameCount; offset++) {
      const left = target - offset;
      if (left >= 0 && this.frames[left]) return left;
      const right = target + offset;
      if (right < this.frameCount && this.frames[right]) return right;
    }
    return -1;
  }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this._needsRedraw = true;
    }
    if (this.active) {
      this.draw();
    }
  }

  draw() {
    if (!this.ctx || !this.canvas || !this._needsRedraw) return;
    const frameIdx = this._findNearestLoadedFrame(this.targetFrame);
    if (frameIdx === -1) return;

    const img = this.frames[frameIdx];
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    // object-fit: cover
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) * 0.5;
    const dy = (ch - dh) * 0.5;

    this.ctx.drawImage(img, dx, dy, dw, dh);
    this.drawnFrame = frameIdx;
    this._needsRedraw = frameIdx !== this.targetFrame;
  }

  getInfo() {
    return {
      available: this.available,
      currentFrame: this.targetFrame + 1,
      drawnFrame: this.drawnFrame + 1,
      loadedCount: this.loadedCount,
      totalFrames: this.frameCount,
      isMobileSource: this.isMobileSource,
    };
  }
}
