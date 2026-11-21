import * as THREE from 'three';

const SVG_AUDIO_ON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const SVG_AUDIO_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
const SVG_ATMOS = {
  sunset: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px" aria-hidden="true"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/></svg>',
  noon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  dusk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
};

const ATMOSPHERE_ORDER = ['sunset', 'noon', 'dusk'];

export class UIController {
  constructor(config, callbacks) {
    this.cfg = config;
    this.cb = callbacks;
    this.chapters = config.chapters || [];
    this.hotspots = config.hotspots || [];
    this.paints = config.paints || [];
    this.currentChapterIndex = 0;

    this.cardEl = document.getElementById('chapter-card');
    this.badgeEl = document.getElementById('card-badge');
    this.titleEl = document.getElementById('card-title');
    this.subtitleEl = document.getElementById('card-subtitle');
    this.textEl = document.getElementById('card-text');
    this.specsEl = document.getElementById('card-specs');
    this.navEl = document.getElementById('chapter-nav');
    this.hotspotsLayer = document.getElementById('hotspots-layer');
    this.progressBar = document.getElementById('scroll-progress-bar');

    this.btnPrevChapter = document.getElementById('btn-prev-chapter');
    this.btnNextChapter = document.getElementById('btn-next-chapter');
    this.btnStartTour = document.getElementById('btn-start-tour');
    this.btnCardMinimize = document.getElementById('btn-card-minimize');

    this.btnTerrain = document.getElementById('btn-terrain');
    this.terrainLabel = document.getElementById('terrain-label');
    this.btnOrbit = document.getElementById('btn-orbit');
    this.btnPhoto = document.getElementById('btn-photo');
    this.photoToolbar = document.getElementById('photo-toolbar');
    this.btnAtmosphere = document.getElementById('btn-atmosphere');
    this.atmosphereIcon = document.getElementById('atmosphere-icon');
    this.atmosphereLabel = document.getElementById('atmosphere-label');
    this.btnSnapshot = document.getElementById('btn-snapshot');
    this.btnExitPhoto = document.getElementById('btn-exit-photo');
    this.btnAudio = document.getElementById('btn-audio');
    this.audioIcon = document.getElementById('audio-icon');
    this.audioLabel = document.getElementById('audio-label');
    this.hintEl = document.getElementById('control-hint');

    // Dilna
    this.workshopBar = document.getElementById('workshop-bar');
    this.btnWorkshopToggle = document.getElementById('btn-workshop-toggle');
    this.paintSwatchesEl = document.getElementById('paint-swatches');
    this.btnBonnet = document.getElementById('btn-bonnet');
    this.btnWipers = document.getElementById('btn-wipers');
    this.btnExpedition = document.getElementById('btn-expedition');
    this.explodeSlider = document.getElementById('explode-slider');
    this.explodeValue = document.getElementById('explode-value');

    // Inspektor dilu
    this.partInspector = document.getElementById('part-inspector');
    this.partGroupEl = document.getElementById('part-group');
    this.partTitleEl = document.getElementById('part-title');
    this.partMaterialEl = document.getElementById('part-material');
    this.partFactEl = document.getElementById('part-fact');
    this.btnClosePart = document.getElementById('btn-close-part');
    this.partTooltip = document.getElementById('part-tooltip');

    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.hotspotItems = [];
    this.activeHotspotId = null;
    this._projVec = new THREE.Vector3();
    this._atmosphereIdx = 0;
    this._bonnetManualOpen = false;
    this._wipersOn = false;
    this._expeditionOn = false;
    this._terrainRough = false;
    this._lastHoverTime = 0;
    this._lastSpeedBeforePause = config.driving?.defaultSpeedKmh ?? 50;

    this._buildChapterNav();
    this._buildHotspots();
    this._buildPaintSwatches();
    this._bindControls();
    this._bindCanvasPicking();
    this._bindKeyboard();
    this._updateHintText(false);
    this.setChapter(0);
  }

  _buildChapterNav() {
    if (!this.navEl) return;
    this.navEl.innerHTML = '';
    this.navDots = this.chapters.map((ch, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chapter-dot';
      btn.setAttribute('aria-label', ch.title);
      btn.innerHTML = `<span class="chapter-dot-tip">${ch.title}</span>`;
      btn.addEventListener('click', () => this.cb.onSelectChapter(idx));
      this.navEl.appendChild(btn);
      return btn;
    });
  }

  _buildHotspots() {
    if (!this.hotspotsLayer) return;
    this.hotspotsLayer.innerHTML = '';
    this.hotspotItems = this.hotspots.map((hs) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot-pin';
      el.innerHTML = `
        <span class="hotspot-dot"></span>
        <span class="hotspot-text">
          <span class="hotspot-label">${hs.label}</span>
          <span class="hotspot-short">${hs.short}</span>
        </span>
      `;
      el.addEventListener('click', () => {
        if (typeof hs.chapterIndex === 'number') {
          this.cb.onSelectChapter(hs.chapterIndex);
        }
      });
      this.hotspotsLayer.appendChild(el);
      return { data: hs, el, pos: new THREE.Vector3(...hs.position) };
    });
  }

  _buildPaintSwatches() {
    if (!this.paintSwatchesEl) return;
    this.paintSwatchesEl.innerHTML = '';
    this.paints.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `paint-swatch${idx === 0 ? ' is-active' : ''}`;
      btn.style.backgroundColor = p.hex;
      btn.title = p.name;
      btn.setAttribute('aria-label', `Lak ${p.name}`);
      btn.addEventListener('click', () => {
        this.paintSwatchesEl.querySelectorAll('.paint-swatch').forEach((s) => s.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.cb.onPaintChange?.(p.id);
      });
      this.paintSwatchesEl.appendChild(btn);
    });
  }

  _bindControls() {
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spd = Number(btn.dataset.speed);
        if (spd > 0) this._lastSpeedBeforePause = spd;
        this._setSpeedUI(spd);
        this.cb.onSpeedChange(spd);
      });
    });

    if (this.btnTerrain) {
      this.btnTerrain.addEventListener('click', () => {
        this._terrainRough = !this._terrainRough;
        this.btnTerrain.classList.toggle('is-active', this._terrainRough);
        this.btnTerrain.setAttribute('aria-pressed', String(this._terrainRough));
        if (this.terrainLabel) {
          this.terrainLabel.textContent = this._terrainRough ? 'Polňačka' : 'Okreska';
        }
        this.cb.onTerrainToggle?.(this._terrainRough);
      });
    }

    if (this.btnOrbit) {
      this.btnOrbit.addEventListener('click', () => {
        const enabled = this.cb.onToggleOrbit();
        this.setOrbitState(enabled);
      });
    }

    if (this.btnPhoto) {
      this.btnPhoto.addEventListener('click', () => this.setPhotoMode(true));
    }
    if (this.btnExitPhoto) {
      this.btnExitPhoto.addEventListener('click', () => this.setPhotoMode(false));
    }
    if (this.btnAtmosphere) {
      this.btnAtmosphere.addEventListener('click', () => {
        this._atmosphereIdx = (this._atmosphereIdx + 1) % ATMOSPHERE_ORDER.length;
        const key = ATMOSPHERE_ORDER[this._atmosphereIdx];
        const label = this.cb.onAtmosphereChange?.(key);
        if (this.atmosphereIcon && SVG_ATMOS[key]) {
          this.atmosphereIcon.innerHTML = SVG_ATMOS[key];
        }
        if (label) {
          if (this.atmosphereLabel) {
            this.atmosphereLabel.textContent = label;
          } else {
            this.btnAtmosphere.textContent = label;
          }
        }
      });
    }
    if (this.btnSnapshot) {
      this.btnSnapshot.addEventListener('click', () => this.cb.onSnapshot?.());
    }

    if (this.btnAudio) {
      this.btnAudio.addEventListener('click', async () => {
        const on = await this.cb.onToggleAudio();
        this.btnAudio.classList.toggle('is-active', on);
        this.btnAudio.setAttribute('aria-pressed', String(on));
        if (this.audioIcon) this.audioIcon.innerHTML = on ? SVG_AUDIO_ON : SVG_AUDIO_OFF;
        if (this.audioLabel) this.audioLabel.textContent = on ? 'Zvuk zap.' : 'Zvuk';
      });
    }

    // Dilna
    if (this.btnWorkshopToggle && this.workshopBar) {
      this.btnWorkshopToggle.addEventListener('click', () => {
        const open = this.workshopBar.classList.toggle('is-open');
        this.btnWorkshopToggle.setAttribute('aria-expanded', String(open));
      });
    }

    if (this.btnBonnet) {
      this.btnBonnet.addEventListener('click', () => {
        this._bonnetManualOpen = !this._bonnetManualOpen;
        this.setBonnetButtonState(this._bonnetManualOpen);
        this.cb.onBonnetToggle?.(this._bonnetManualOpen);
      });
    }

    if (this.btnWipers) {
      this.btnWipers.addEventListener('click', () => {
        this._wipersOn = !this._wipersOn;
        this.btnWipers.classList.toggle('is-active', this._wipersOn);
        this.btnWipers.setAttribute('aria-pressed', String(this._wipersOn));
        this.cb.onWipersToggle?.(this._wipersOn);
      });
    }

    if (this.btnExpedition) {
      this.btnExpedition.addEventListener('click', () => {
        this._expeditionOn = !this._expeditionOn;
        this.btnExpedition.classList.toggle('is-active', this._expeditionOn);
        this.btnExpedition.setAttribute('aria-pressed', String(this._expeditionOn));
        this.cb.onExpeditionToggle?.(this._expeditionOn);
      });
    }

    if (this.explodeSlider) {
      this.explodeSlider.addEventListener('input', () => {
        const pct = Number(this.explodeSlider.value);
        if (this.explodeValue) this.explodeValue.textContent = `${pct} %`;
        this.cb.onExplodeSlider?.(pct === 0 ? null : pct / 100);
      });
    }

    // Karta kapitoly: krok zpet/vpred & sbaleni
    if (this.btnPrevChapter) {
      this.btnPrevChapter.addEventListener('click', () => this.cb.onStepChapter?.(-1));
    }
    if (this.btnNextChapter) {
      this.btnNextChapter.addEventListener('click', () => this.cb.onStepChapter?.(1));
    }
    if (this.btnStartTour) {
      this.btnStartTour.addEventListener('click', () => {
        const next = this.currentChapterIndex >= this.chapters.length - 1 ? 0 : this.currentChapterIndex + 1;
        this.cb.onSelectChapter(next);
      });
    }
    if (this.btnCardMinimize && this.cardEl) {
      this.btnCardMinimize.addEventListener('click', () => {
        const min = this.cardEl.classList.toggle('is-minimized');
        this.btnCardMinimize.textContent = min ? '+' : '−';
      });
    }

    if (this.btnClosePart) {
      this.btnClosePart.addEventListener('click', () => {
        this.hidePartInspector();
        this.cb.onClearPart?.();
      });
    }
  }

  _bindCanvasPicking() {
    const canvas = document.getElementById('webgl-canvas');
    if (!canvas) return;

    let downX = 0;
    let downY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });

    canvas.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 6) return; // tahnuti mysi v OrbitControls neotevira detail dilu
      if (document.body.classList.contains('is-photo-mode')) return;

      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const picked = this.cb.onPickPart?.(ndcX, ndcY);
      if (picked) {
        this.showPartInspector(picked.info);
      } else {
        this.hidePartInspector();
        this.cb.onClearPart?.();
      }
    });

    if (!this.isTouch) {
      canvas.addEventListener('pointermove', (e) => {
        if (!this.partTooltip || document.body.classList.contains('is-photo-mode')) return;
        const now = performance.now();
        if (now - this._lastHoverTime < 45) return;
        this._lastHoverTime = now;

        const rect = canvas.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const hovered = this.cb.onHoverPart?.(ndcX, ndcY);
        if (hovered) {
          this.partTooltip.textContent = hovered.info.title;
          this.partTooltip.style.left = `${e.clientX}px`;
          this.partTooltip.style.top = `${e.clientY}px`;
          this.partTooltip.classList.remove('is-hidden');
          canvas.style.cursor = document.body.classList.contains('is-orbit-mode') ? 'grab' : 'pointer';
        } else {
          this.partTooltip.classList.add('is-hidden');
          canvas.style.cursor = document.body.classList.contains('is-orbit-mode') ? 'grab' : 'default';
        }
      });

      canvas.addEventListener('pointerleave', () => {
        if (this.partTooltip) this.partTooltip.classList.add('is-hidden');
      });
    }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        this.cb.onStepChapter?.(1);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        this.cb.onStepChapter?.(-1);
      } else if (e.code === 'Space') {
        e.preventDefault();
        const activeBtn = document.querySelector('.speed-btn.is-active');
        const cur = activeBtn ? Number(activeBtn.dataset.speed) : 50;
        const next = cur === 0 ? this._lastSpeedBeforePause || 50 : 0;
        this._setSpeedUI(next);
        this.cb.onSpeedChange(next);
      } else if (e.code === 'KeyO') {
        const enabled = this.cb.onToggleOrbit();
        this.setOrbitState(enabled);
      } else if (e.code === 'KeyH' && this.btnBonnet) {
        this.btnBonnet.click();
      } else if (e.code === 'KeyW' && this.btnWipers) {
        this.btnWipers.click();
      } else if (e.code === 'Escape' && document.body.classList.contains('is-photo-mode')) {
        this.setPhotoMode(false);
      }
    });
  }

  _setSpeedUI(spd) {
    document.querySelectorAll('.speed-btn').forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.speed) === spd);
    });
  }

  setBonnetButtonState(open) {
    this._bonnetManualOpen = Boolean(open);
    if (this.btnBonnet) {
      this.btnBonnet.classList.toggle('is-active', this._bonnetManualOpen);
      this.btnBonnet.setAttribute('aria-pressed', String(this._bonnetManualOpen));
    }
  }

  syncExplodeSlider(factor) {
    if (!this.explodeSlider) return;
    const pct = Math.round(factor * 100);
    this.explodeSlider.value = String(pct);
    if (this.explodeValue) this.explodeValue.textContent = `${pct} %`;
  }

  showPartInspector(info) {
    if (!this.partInspector || !info) return;
    if (this.partGroupEl) this.partGroupEl.textContent = info.group;
    if (this.partTitleEl) this.partTitleEl.textContent = info.title;
    if (this.partMaterialEl) this.partMaterialEl.textContent = info.material;
    if (this.partFactEl) this.partFactEl.textContent = info.fact;
    this.partInspector.classList.remove('is-hidden');
  }

  hidePartInspector() {
    if (this.partInspector) {
      this.partInspector.classList.add('is-hidden');
    }
  }

  setOrbitState(enabled) {
    if (this.btnOrbit) {
      this.btnOrbit.classList.toggle('is-active', enabled);
      this.btnOrbit.setAttribute('aria-pressed', String(enabled));
    }
    this._updateHintText(enabled);
  }

  setPhotoMode(enabled) {
    document.body.classList.toggle('is-photo-mode', enabled);
    if (this.btnPhoto) {
      this.btnPhoto.classList.toggle('is-active', enabled);
      this.btnPhoto.setAttribute('aria-pressed', String(enabled));
    }
    if (this.photoToolbar) {
      this.photoToolbar.classList.toggle('is-hidden', !enabled);
    }
    if (enabled && this.partTooltip) {
      this.partTooltip.classList.add('is-hidden');
    }
  }

  _updateHintText(orbit) {
    if (!this.hintEl) return;
    if (orbit) {
      this.hintEl.textContent = this.isTouch
        ? 'Volný pohled: táhni prstem pro otáčení • klepni na díl pro detail'
        : 'Volný pohled: táhni myší pro otáčení, kolečkem přibliž • klikni na díl pro detail';
    } else {
      this.hintEl.textContent = this.isTouch
        ? 'Posouvej prstem pro průlet • klepni na libovolný díl pro detail'
        : 'Roluj kolečkem myši nebo šipkami ↑/↓ • Klikni na díl pro detail';
    }
  }

  setChapter(index) {
    const ch = this.chapters[index];
    if (!ch) return;
    this.currentChapterIndex = index;
    this.activeHotspotId = ch.activeHotspot || null;

    if (this.cardEl) {
      this.cardEl.classList.add('is-switching');
      setTimeout(() => {
        if (this.badgeEl) this.badgeEl.textContent = ch.badge;
        if (this.titleEl) this.titleEl.textContent = ch.title;
        if (this.subtitleEl) this.subtitleEl.textContent = ch.subtitle;
        if (this.textEl) this.textEl.textContent = ch.text;
        if (this.specsEl) {
          this.specsEl.innerHTML = (ch.specs || [])
            .map(
              (s) => `
              <div class="spec-chip">
                <span class="spec-k">${s.k}</span>
                <span class="spec-v">${s.v}</span>
              </div>
            `
            )
            .join('');
        }
        if (this.btnStartTour) {
          this.btnStartTour.textContent =
            index >= this.chapters.length - 1 ? 'Zpět na start ↺' : 'Další pohled →';
        }
        this.cardEl.classList.remove('is-switching');
      }, 90);
    }

    if (this.navDots) {
      this.navDots.forEach((dot, idx) => dot.classList.toggle('is-active', idx === index));
    }
    this.hotspotItems.forEach((hs) => {
      hs.el.classList.toggle('is-highlighted', hs.data.id === this.activeHotspotId);
    });
  }

  setProgress(p) {
    if (this.progressBar) {
      this.progressBar.style.width = `${Math.round(p * 100)}%`;
    }
  }

  updateHotspots(camera, trabantGroup) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const padX = 95;
    const padYTop = 82;
    const padYBot = 86;

    for (const item of this.hotspotItems) {
      if (!this.activeHotspotId || item.data.id !== this.activeHotspotId) {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }

      this._projVec.copy(item.pos);
      if (trabantGroup) {
        this._projVec.applyMatrix4(trabantGroup.matrixWorld);
      }
      this._projVec.project(camera);

      const visible = this._projVec.z > -1 && this._projVec.z < 1;
      if (!visible) {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }

      let x = (this._projVec.x * 0.5 + 0.5) * w;
      let y = (-this._projVec.y * 0.5 + 0.5) * h;

      const outOfBounds = x < 16 || x > w - 16 || y < 16 || y > h - 16;
      x = Math.max(padX, Math.min(w - padX, x));
      y = Math.max(padYTop, Math.min(h - padYBot, y));

      item.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      item.el.style.opacity = outOfBounds ? '0.28' : '1';
      item.el.style.pointerEvents = 'auto';
    }
  }
}
