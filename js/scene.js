import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { describeTrabantPart } from './partsCatalog.js';

const FilmCameraShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.016 },
    uVignette: { value: 0.24 },
    uChromatic: { value: 0.0005 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uChromatic;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + uTime * 17.3) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - vec2(0.5);
      float dist = length(dir);
      vec2 offset = dir * dist * uChromatic;

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 col = vec3(r, g, b);

      float vig = smoothstep(0.95, 0.28, dist);
      col *= mix(1.0 - uVignette, 1.0, vig);

      float grain = (rand(vUv) - 0.5) * uGrain;
      col += grain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

const PAINT_MULTIPLIERS = {
  papyrus: '#ffffff',
  monsun: '#f2b224',
  gletscher: '#7fb8db',
  panama: '#6ea86b',
};

const ATMOSPHERE_PRESETS = {
  sunset: {
    label: 'Zlatá hodinka',
    sunColor: '#ffbe70',
    sunIntensity: 4.4,
    sunPos: [28, 5.2, 14],
    hemiSky: '#ffdcb0',
    hemiGround: '#281d14',
    hemiIntensity: 0.24,
    skyFillColor: '#88b4e8',
    skyFillIntensity: 0.62,
    fogColor: '#c49e72',
    fogDensity: 0.017,
    envIntensity: 1.10,
    bgIntensity: 0.96,
    envRotY: 0.0,
    headlights: 5.5,
    lutEnabled: true,
  },
  noon: {
    label: 'Polední slunce',
    sunColor: '#fff6e8',
    sunIntensity: 4.5,
    sunPos: [12, 26, 10],
    hemiSky: '#cfe4ff',
    hemiGround: '#4a3d2e',
    hemiIntensity: 0.46,
    skyFillColor: '#a6c8f5',
    skyFillIntensity: 0.45,
    fogColor: '#d9ceb8',
    fogDensity: 0.010,
    envIntensity: 1.25,
    bgIntensity: 1.15,
    envRotY: 0.55,
    headlights: 1.0,
    lutEnabled: false,
  },
  dusk: {
    label: 'Soumrak & světla',
    sunColor: '#9db4ff',
    sunIntensity: 1.25,
    sunPos: [-22, 4.0, -18],
    hemiSky: '#4f6294',
    hemiGround: '#120f0c',
    hemiIntensity: 0.22,
    skyFillColor: '#5b76b8',
    skyFillIntensity: 0.48,
    fogColor: '#2d3345',
    fogDensity: 0.022,
    envIntensity: 0.52,
    bgIntensity: 0.42,
    envRotY: -1.1,
    headlights: 16.0,
    lutEnabled: false,
  },
};

const IS_LOCALHOST = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const CACHE_BUST = IS_LOCALHOST ? `?v=${Date.now()}` : '';

function withCacheBust(url) {
  return url ? `${url}${CACHE_BUST}` : url;
}

export class TrabantScene {
  constructor(canvas, config, onProgress) {
    this.canvas = canvas;
    this.cfg = config;
    this.onProgress = onProgress || (() => {});

    this.speedKmh = config.driving.defaultSpeedKmh ?? 50;
    this.targetSpeedKmh = this.speedKmh;
    this.elapsed = 0;
    this.roughTerrain = false;
    this.isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;

    this.roadTiles = [];
    this.roadMaterials = [];
    this.trabantGroup = new THREE.Group();
    this.trabantGroup.name = 'Trabant_Driving_Wrapper';
    this.bodyNode = null;
    this.contactShadowMesh = null;

    this.bonnetPivot = null;
    this.bonnetOpenTarget = 0;
    this.bonnetOpenCurrent = 0;
    this.manualBonnet = null; // null = auto podle kapitoly, boolean = rucni prepinac

    this.paintMaterials = [];
    this.currentPaintId = 'papyrus';
    this.dustShaderUniforms = [];
    this.orangePeelNormalTex = this._createOrangePeelNormalTexture();
    this.roadDetailBumpTex = this._createRoadDetailBumpTexture();
    this.expeditionGroup = null;
    this.expeditionEnabled = false;

    this.wheelSpinNodes = [];
    this.fanSpinnerNode = null;
    this.pulleyNodes = [];
    this.steeringPivot = null;
    this.wiperPivots = [];
    this.wipersEnabled = false;
    this.wiperPhase = 0;
    this.taillightMat = null;
    this.cabinLight = null;

    this.mixer = null;
    this.clipDuration = 2.0;

    // Virtualni papir & Exploded View
    this.scrollProgress = 0;
    this.manualExplode = null; // null = ze scrollu, jinak 0..1
    this.blueprintBlend = 0;
    this.explodeFactor = 0;
    this.explodeParts = [];
    this.explodeLines = null;
    this.explodeLineRefs = [];
    this._lastLineEx = -1;

    this.blueprintGrid = null;
    this.blueprintPaperMesh = null;
    this.roadFogColor = new THREE.Color(config.lighting.fog.color);
    this.paperBgColor = new THREE.Color('#efeadd');
    this.envTexture = null;
    this.envTextures = { sunset: null, noon: null, dusk: null };
    this.studioLight = null;
    this.atmosphereKey = 'sunset';

    // Raycasting / inspekce dilu
    this.raycaster = new THREE.Raycaster();
    this.pickableMeshes = [];
    this._trabantBoundsBox = new THREE.Box3();
    this.highlightedMesh = null;
    this._origEmissive = new THREE.Color();
    this._origEmissiveIntensity = 1;

    this.dustSprites = [];
    this.exhaustSprites = [];
    this.dustMotes = null;
    this.dustSpawnAcc = 0;
    this.exhaustSpawnAcc = 0;

    this.audio = {
      ctx: null,
      enabled: false,
      masterGain: null,
      windGain: null,
      engineGain: null,
      engineOsc: null,
      engineSubOsc: null,
      engineLfo: null,
      noiseGain: null,
      windBufferLoaded: false,
    };

    this._initRenderer();
    this._initSceneAndLights();
    this._initPostProcessing();
  }

  _initRenderer() {
    const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
    const maxDpr = isMobile ? 1.25 : 1.75;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.cfg.lighting.toneMappingExposure ?? 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy() || 1);
  }

  _createOrangePeelNormalTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const v = (y / size) * Math.PI * 2;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const h1 = Math.sin(u * 14 + Math.cos(v * 9)) * 0.5 + Math.cos(v * 16 - Math.sin(u * 11)) * 0.5;
        const h2 = Math.sin(u * 29 - v * 23) * 0.35;
        const dx = (Math.cos(u * 14 + Math.cos(v * 9)) * 0.6 + Math.cos(u * 29 - v * 23) * 0.35 + h1 * 0.15) * 14;
        const dy = (-Math.sin(v * 16 - Math.sin(u * 11)) * 0.6 - Math.sin(u * 29 - v * 23) * 0.35 + h2 * 0.15) * 14;
        const idx = (y * size + x) * 4;
        data[idx] = Math.max(0, Math.min(255, Math.round(128 + dx)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + dy)));
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 10);
    tex.needsUpdate = true;
    return tex;
  }

  _createRoadDetailBumpTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i++) {
      height[i] = rnd();
    }
    // Lehke 3x3 vyhlazeni pro cistou sedotonovou heightmapu do bumpMap
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size;
        const xp = (x + 1) % size;
        const ym = (y - 1 + size) % size;
        const yp = (y + 1) % size;
        const h =
          height[y * size + x] * 0.52 +
          (height[y * size + xm] + height[y * size + xp] + height[ym * size + x] + height[yp * size + x]) * 0.12;
        const v = Math.max(0, Math.min(255, Math.round(h * 255)));
        const idx = (y * size + x) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 22);
    tex.needsUpdate = true;
    return tex;
  }

  _ensureBoxUVs(geom, scale = 1.0) {
    if (!geom || geom.attributes.uv || !geom.attributes.position) return;
    if (!geom.attributes.normal) {
      geom.computeVertexNormals();
    }
    const pos = geom.attributes.position;
    const nor = geom.attributes.normal;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      let u = 0;
      let v = 0;
      if (nx >= ny && nx >= nz) {
        u = pz * scale;
        v = py * scale;
      } else if (ny >= nx && ny >= nz) {
        u = px * scale;
        v = pz * scale;
      } else {
        u = px * scale;
        v = py * scale;
      }
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  _prepareMaterialTextures(mat) {
    if (!mat) return;
    for (const key of ['map', 'roughnessMap', 'normalMap', 'metalnessMap', 'aoMap']) {
      const t = mat[key];
      if (t && t.isTexture) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.maxAniso;
        t.needsUpdate = true;
      }
    }
  }

  _createBlueprintTexture() {
    const size = this.isMobile ? 1024 : 2048;
    const scale = size / 2048;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    const vSize = 2048;

    // Tepla textura rysovaciho papiru
    ctx.fillStyle = '#efeadd';
    ctx.fillRect(0, 0, vSize, vSize);

    // Jemna milimetrova mrizka (24 m plocha -> 2048 px => ~85.3 px / m)
    const pxPerMeter = vSize / 24;
    const minorStep = pxPerMeter * 0.25;
    const majorStep = pxPerMeter * 1.0;

    ctx.strokeStyle = 'rgba(130, 118, 96, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= vSize; x += minorStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vSize);
    }
    for (let y = 0; y <= vSize; y += minorStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(vSize, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(105, 92, 72, 0.24)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= vSize; x += majorStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vSize);
    }
    for (let y = 0; y <= vSize; y += majorStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(vSize, y);
    }
    ctx.stroke();

    // Technicky ramecek a hlavni osy kolem Trabantu (stred = (1024, 1024))
    const cx = vSize * 0.5;
    const cy = vSize * 0.5;

    ctx.strokeStyle = 'rgba(72, 61, 46, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(cx, 240);
    ctx.lineTo(cx, vSize - 240);
    ctx.moveTo(240, cy);
    ctx.lineTo(vSize - 240, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Koty vozu Trabant 601 (delka 3.555 m, sirka 1.505 m, rozvor 2.020 m)
    const carLenPx = 3.555 * pxPerMeter;
    const carWidPx = 1.505 * pxPerMeter;
    const wheelbasePx = 2.020 * pxPerMeter;
    const halfW = carWidPx * 0.5;
    const halfL = carLenPx * 0.5;

    ctx.strokeStyle = 'rgba(190, 96, 24, 0.72)';
    ctx.fillStyle = 'rgba(145, 68, 12, 0.88)';
    ctx.lineWidth = 2;
    ctx.font = '600 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    // Delkova kota vlevo od auta
    const dimX = cx - halfW - 140;
    ctx.beginPath();
    ctx.moveTo(dimX, cy - halfL);
    ctx.lineTo(dimX, cy + halfL);
    ctx.moveTo(dimX - 14, cy - halfL);
    ctx.lineTo(dimX + 14, cy - halfL);
    ctx.moveTo(dimX - 14, cy + halfL);
    ctx.lineTo(dimX + 14, cy + halfL);
    ctx.stroke();
    ctx.save();
    ctx.translate(dimX - 24, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('L = 3 555 mm', 0, 0);
    ctx.restore();

    // Rozvorova kota vpravo od auta
    const wbX = cx + halfW + 140;
    ctx.beginPath();
    ctx.moveTo(wbX, cy - wheelbasePx * 0.5);
    ctx.lineTo(wbX, cy + wheelbasePx * 0.5);
    ctx.moveTo(wbX - 12, cy - wheelbasePx * 0.5);
    ctx.lineTo(wbX + 12, cy - wheelbasePx * 0.5);
    ctx.moveTo(wbX - 12, cy + wheelbasePx * 0.5);
    ctx.lineTo(wbX + 12, cy + wheelbasePx * 0.5);
    ctx.stroke();
    ctx.save();
    ctx.translate(wbX + 28, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ROZVOR 2 020 mm', 0, 0);
    ctx.restore();

    // Sirkova kota za zadi
    const widY = cy + halfL + 110;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, widY);
    ctx.lineTo(cx + halfW, widY);
    ctx.moveTo(cx - halfW, widY - 12);
    ctx.lineTo(cx - halfW, widY + 12);
    ctx.moveTo(cx + halfW, widY - 12);
    ctx.lineTo(cx + halfW, widY + 12);
    ctx.stroke();
    ctx.fillText('B = 1 505 mm', cx, widY + 34);

    // Razitko VEB Sachsenring v rohu nakreslene plochy
    const bx = cx + 280;
    const by = cy + 340;
    ctx.strokeStyle = 'rgba(72, 61, 46, 0.58)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, 430, 124);
    ctx.fillStyle = 'rgba(54, 45, 34, 0.85)';
    ctx.textAlign = 'left';
    ctx.font = '700 20px "Space Grotesk", sans-serif';
    ctx.fillText('VEB SACHSENRING ZWICKAU', bx + 18, by + 34);
    ctx.font = '500 17px "JetBrains Mono", monospace';
    ctx.fillText('TRABANT 601 L/LO • TYP P 601', bx + 18, by + 64);
    ctx.fillStyle = 'rgba(110, 96, 78, 0.85)';
    ctx.fillText('KATALOG ETK 1980 • TGL 1:10', bx + 18, by + 94);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  _initSceneAndLights() {
    const L = this.cfg.lighting;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(L.fog.color);
    this.scene.fog = new THREE.FogExp2(L.fog.color, L.fog.density);

    const firstCam = this.cfg.chapters[0].camera;
    this.camera = new THREE.PerspectiveCamera(
      firstCam.fov || 38,
      window.innerWidth / window.innerHeight,
      0.1,
      260
    );
    this.camera.position.set(...firstCam.pos);

    this.sunLight = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    this.sunLight.position.set(...L.sun.position);
    this.sunLight.target.position.set(0, 0.5, -1.0);
    this.sunLight.castShadow = true;
    const shadowRes = this.isMobile ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    const f = L.sun.shadowFrustum || 11;
    this.sunLight.shadow.camera.left = -f;
    this.sunLight.shadow.camera.right = f;
    this.sunLight.shadow.camera.top = f;
    this.sunLight.shadow.camera.bottom = -f;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 75;
    this.sunLight.shadow.bias = L.sun.shadowBias ?? -0.00025;
    this.sunLight.shadow.normalBias = L.sun.shadowNormalBias ?? 0.016;
    this.sunLight.shadow.radius = 2.0;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const hemi = new THREE.HemisphereLight(L.hemi.skyColor, L.hemi.groundColor, L.hemi.intensity);
    this.hemiLight = hemi;
    this.scene.add(hemi);

    // Chladny odraz modre oblohy z opacne strany (warm key / cool fill kontrast)
    this.skyFillLight = new THREE.DirectionalLight(0x88b4e8, 0.62);
    this.skyFillLight.position.set(-18, 9, -14);
    this.scene.add(this.skyFillLight);

    // Technicke studijni svetlo se stiny pro rezim Virtualniho papiru (rozpad)
    this.studioLight = new THREE.DirectionalLight(0xfff9f0, 0.0);
    this.studioLight.position.set(-6, 15, 7);
    this.studioLight.castShadow = true;
    this.studioLight.shadow.mapSize.set(1024, 1024);
    this.studioLight.shadow.camera.left = -6;
    this.studioLight.shadow.camera.right = 6;
    this.studioLight.shadow.camera.top = 6;
    this.studioLight.shadow.camera.bottom = -6;
    this.studioLight.shadow.camera.near = 2;
    this.studioLight.shadow.camera.far = 35;
    this.studioLight.shadow.bias = -0.0005;
    this.scene.add(this.studioLight);

    // Virtualni rysovaci papir s kotami a razitkem (prijma stiny rozlozenych dilu!)
    const paperGeo = new THREE.PlaneGeometry(24, 24);
    const paperMat = new THREE.MeshStandardMaterial({
      map: this._createBlueprintTexture(),
      roughness: 0.94,
      metalness: 0.0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.blueprintPaperMesh = new THREE.Mesh(paperGeo, paperMat);
    this.blueprintPaperMesh.rotation.x = -Math.PI / 2;
    this.blueprintPaperMesh.position.set(0, -0.015, -1.01);
    this.blueprintPaperMesh.receiveShadow = true;
    this.blueprintPaperMesh.visible = false;
    this.scene.add(this.blueprintPaperMesh);

    this.headlightL = new THREE.SpotLight(0xffe0a8, 4.5, 24, Math.PI * 0.22, 0.55, 1.5);
    this.headlightL.position.set(-0.53, 0.69, 0.72);
    this.headlightL.target.position.set(-0.75, 0.0, 9.5);
    this.trabantGroup.add(this.headlightL);
    this.trabantGroup.add(this.headlightL.target);

    this.headlightR = new THREE.SpotLight(0xffe0a8, 4.5, 24, Math.PI * 0.22, 0.55, 1.5);
    this.headlightR.position.set(0.53, 0.69, 0.72);
    this.headlightR.target.position.set(0.75, 0.0, 9.5);
    this.trabantGroup.add(this.headlightR);
    this.trabantGroup.add(this.headlightR.target);

    this.scene.add(this.trabantGroup);
  }

  _initPostProcessing() {
    // Na telefonech vynechame 5+ offscreen pruchodu EffectComposeru: nativni MSAA + ACESFilmicToneMapping je 2-3x rychlejsi a ostrejsi
    if (this.isMobile) {
      this.composer = null;
      return;
    }

    const L = this.cfg.lighting;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      L.bloom.strength ?? 0.22,
      L.bloom.radius ?? 0.36,
      L.bloom.threshold ?? 1.08
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.lutPass = new LUTPass();
    this.lutPass.enabled = false;
    this.lutPass.intensity = L.lut?.intensity ?? 0.42;
    this.composer.addPass(this.lutPass);

    this.filmPass = new ShaderPass(FilmCameraShader);
    this.composer.addPass(this.filmPass);
  }

  async loadAll() {
    this.onProgress(12, 'Načítám HDRI oblohu a zlaté odpolední světlo…');
    await Promise.allSettled([
      this._loadHDRI(),
      this._loadLUT(),
    ]);

    this.onProgress(42, 'Optimalizuji 3D modely zaprášené silnice a Trabanta 601…');
    const gltfLoader = this._createGLTFLoader();
    await Promise.all([
      this._loadRoadTiles(gltfLoader),
      this._loadTrabant(gltfLoader),
    ]);

    this.onProgress(82, 'Spouštím zvířený prach, dvoutaktní kouř a VFX…');
    await this._initVFX();

    this.onProgress(100, 'Připraveno k jízdě!');
  }

  _createGLTFLoader() {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  }

  _createProceduralSkyEnv(pmrem, { zenith, horizon, ground, sunDir, sunColor, sunPower = 14.0 }) {
    const skyScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(20, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(zenith) },
        uHorizon: { value: new THREE.Color(horizon) },
        uGround: { value: new THREE.Color(ground) },
        uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
        uSunColor: { value: new THREE.Color(sunColor) },
        uSunPower: { value: sunPower },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunPower;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = d.y >= 0.0
            ? mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.58))
            : mix(uHorizon, uGround, pow(clamp(-d.y, 0.0, 1.0), 0.45));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 96.0) * uSunPower + pow(s, 8.0) * 0.28);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    skyScene.add(new THREE.Mesh(skyGeo, skyMat));
    const rt = pmrem.fromScene(skyScene, 0.03);
    skyGeo.dispose();
    skyMat.dispose();
    return rt.texture;
  }

  _loadHDRI() {
    return new Promise((resolve) => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();

      // Pripravit ciste PMREM prostredi pro poledne a soumrak (bez oranzoveho odlesku zapadu!)
      this.envTextures.noon = this._createProceduralSkyEnv(pmrem, {
        zenith: '#3b7fe0',
        horizon: '#d8e8f8',
        ground: '#5e5344',
        sunDir: [12, 26, 10],
        sunColor: '#fff8ea',
        sunPower: 16.0,
      });
      this.envTextures.dusk = this._createProceduralSkyEnv(pmrem, {
        zenith: '#111a36',
        horizon: '#3c4c73',
        ground: '#0e1017',
        sunDir: [-22, 4, -18],
        sunColor: '#9fb8ff',
        sunPower: 5.5,
      });

      const hdrUrl = withCacheBust(this.cfg.assets.hdri);
      new RGBELoader().load(
        hdrUrl,
        (texture) => {
          const envRT = pmrem.fromEquirectangular(texture);
          this.envTextures.sunset = envRT.texture;
          this.envTexture = envRT.texture;
          this.scene.environment = envRT.texture;
          this.scene.environmentIntensity = this.cfg.lighting.environmentIntensity ?? 0.88;
          this.scene.background = envRT.texture;
          this.scene.backgroundBlurriness = this.cfg.lighting.backgroundBlurriness ?? 0.055;
          this.scene.backgroundIntensity = this.cfg.lighting.backgroundIntensity ?? 0.92;
          texture.dispose();
          pmrem.dispose();
          resolve();
        },
        undefined,
        (err) => {
          console.warn('[HDRI] Nepodarilo se nacist HDRI, pouzivam procedurni oblohu:', err);
          this.envTextures.sunset = this._createProceduralSkyEnv(pmrem, {
            zenith: '#4c70a8',
            horizon: '#f4b572',
            ground: '#2b2016',
            sunDir: [28, 5.2, 14],
            sunColor: '#ffd490',
            sunPower: 14.0,
          });
          this.envTexture = this.envTextures.sunset;
          this.scene.environment = this.envTexture;
          this.scene.background = this.envTexture;
          pmrem.dispose();
          resolve();
        }
      );
    });
  }

  _loadLUT() {
    return new Promise((resolve) => {
      if (!this.lutPass || !this.cfg.lighting.lut?.enabled || !this.cfg.assets.lut) {
        resolve();
        return;
      }
      const lutUrl = withCacheBust(this.cfg.assets.lut);
      new LUTCubeLoader().load(
        lutUrl,
        (result) => {
          const tex = result.texture3D || result.texture;
          if (tex) {
            this.lutPass.lut = tex;
            this.lutPass.intensity = this.cfg.lighting.lut.intensity ?? 0.62;
            this.lutPass.enabled = true;
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('[LUT] Nepodarilo se nacist 3D LUT, pokracuji bez nej:', err);
          resolve();
        }
      );
    });
  }

  _optimizeRoadTile(baseTile) {
    baseTile.updateMatrixWorld(true);
    const groups = new Map();
    const matSet = new Set();

    baseTile.traverse((child) => {
      if (!child.isMesh) return;
      const nm = (child.name || '').toLowerCase();
      const isDecal = nm.includes('decal');
      const isTerrain = nm.includes('terrain');
      const isGrass = nm.includes('grass');
      const isNature = isGrass || nm.includes('shrub') || nm.includes('rock') || nm.includes('canopy');

      // Doplnit chybejici UV na patnicich, sloupu, ohradniku a kmenech stromu
      this._ensureBoxUVs(child.geometry, 0.7);

      child.receiveShadow = true;
      child.castShadow = this.isMobile
        ? (!isDecal && !isTerrain && !isNature)
        : (!isDecal && !isTerrain && !isGrass);

      if (isDecal && child.material) {
        child.material.depthWrite = false;
        child.material.polygonOffset = true;
        child.material.polygonOffsetFactor = -2;
      }

      if (child.material && !Array.isArray(child.material)) {
        this._prepareMaterialTextures(child.material);
        if (isTerrain && child.material.name && child.material.name.includes('Road_Unified') && !child.material.userData._roadDetailApplied) {
          child.material.userData._roadDetailApplied = true;
          child.material.bumpMap = this.roadDetailBumpTex;
          child.material.bumpScale = 0.015;
          child.material.envMapIntensity = 0.72;
        }
        matSet.add(child.material);
        if (nm.includes('grass') || nm.includes('shrub') || nm.includes('rock') || nm.includes('canopy') || nm.includes('bollard') || nm.includes('fence')) {
          const key = `${child.geometry.uuid}|${child.material.uuid}|${child.castShadow ? 1 : 0}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(child);
        }
      } else if (Array.isArray(child.material)) {
        child.material.forEach((m) => {
          this._prepareMaterialTextures(m);
          if (isTerrain && m.name && m.name.includes('Road_Unified') && !m.userData._roadDetailApplied) {
            m.userData._roadDetailApplied = true;
            m.bumpMap = this.roadDetailBumpTex;
            m.bumpScale = 0.015;
            m.envMapIntensity = 0.72;
          }
          matSet.add(m);
        });
      }
    });

    // Nahradit skupiny >= 3 stejnych objektu jednim THREE.InstancedMesh (vyrazne mene draw callu)
    const invBase = new THREE.Matrix4().copy(baseTile.matrixWorld).invert();
    const localMat = new THREE.Matrix4();

    for (const items of groups.values()) {
      if (items.length < 3) continue;
      const sample = items[0];
      const inst = new THREE.InstancedMesh(sample.geometry, sample.material, items.length);
      inst.castShadow = sample.castShadow;
      inst.receiveShadow = sample.receiveShadow;
      inst.name = `${sample.name}_Instanced(${items.length})`;

      for (let i = 0; i < items.length; i++) {
        localMat.multiplyMatrices(invBase, items[i].matrixWorld);
        inst.setMatrixAt(i, localMat);
        if (items[i].parent) {
          items[i].parent.remove(items[i]);
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      baseTile.add(inst);
    }

    this.roadMaterials = Array.from(matSet).map((mat) => ({
      mat,
      origTrans: Boolean(mat.transparent),
      origOp: mat.opacity ?? 1,
    }));
  }

  _loadRoadTiles(gltfLoader) {
    return new Promise((resolve) => {
      const url = withCacheBust(this.cfg.assets.roadTileModel);
      const count = this.cfg.driving.roadTileCount || 3;
      const tileLen = this.cfg.driving.roadTileLength || 32.0;

      gltfLoader.load(
        url,
        (gltf) => {
          const baseTile = gltf.scene;
          this._optimizeRoadTile(baseTile);

          const halfSpan = Math.floor(count / 2);
          for (let i = 0; i < count; i++) {
            const tile = i === 0 ? baseTile : baseTile.clone(true);
            tile.position.z = (i - halfSpan) * tileLen;
            this.scene.add(tile);
            this.roadTiles.push(tile);
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('[ROAD] Nepodarilo se nacist road_tile.glb, vytvarim nouzovou silnici:', err);
          this._buildFallbackRoad(tileLen, count);
          resolve();
        }
      );
    });
  }

  _buildFallbackRoad(tileLen, count) {
    const geo = new THREE.PlaneGeometry(46, tileLen);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b5c49, roughness: 0.92 });
    this.roadMaterials = [{ mat, origTrans: false, origOp: 1 }];
    const half = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.z = (i - half) * tileLen;
      m.receiveShadow = true;
      this.scene.add(m);
      this.roadTiles.push(m);
    }
  }

  _setupHingedBonnet(model) {
    const bonnetMesh = model.getObjectByName('K13_Duroplast_Bonnet');
    if (!bonnetMesh || !bonnetMesh.parent) return;

    const parent = bonnetMesh.parent;
    parent.updateMatrixWorld(true);

    // Najit vsechny casti patrici ke kapote (znak, vnitrni vyztuhy, nyty)
    const bonnetRoots = [];
    const bonnetMeshes = [];
    for (const obj of parent.children) {
      const nm = obj.name || '';
      if (obj === bonnetMesh || nm.includes('Bonnet') || nm.includes('Sachsenring')) {
        bonnetRoots.push(obj);
        obj.traverse((ch) => {
          if (ch.isMesh) bonnetMeshes.push(ch);
        });
      }
    }

    const box = new THREE.Box3().setFromObject(bonnetMesh);
    const invParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    box.applyMatrix4(invParent);

    // Pant kapoty lezi na zadnim okraji u celniho skla (min.z, max.y)
    const pivotLocal = new THREE.Vector3(0, box.max.y, box.min.z);
    const pivot = new THREE.Group();
    pivot.name = 'Bonnet_Hinge_Pivot';
    pivot.position.copy(pivotLocal);
    parent.add(pivot);
    pivot.updateMatrixWorld(true);

    for (const rootPart of bonnetRoots) {
      pivot.attach(rootPart);
    }

    // Aktualizovat basePos u rozpadu pro presunute casti kapoty
    for (const ep of this.explodeParts) {
      if (bonnetMeshes.includes(ep.mesh)) {
        ep.basePos.copy(ep.mesh.position);
      }
    }

    this.bonnetPivot = pivot;
  }

  _buildExpeditionPack(parentNode) {
    const exp = new THREE.Group();
    exp.name = 'Expedition_Pack';
    exp.visible = false;

    const rackMat = new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.45, metalness: 0.78 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7b5632, roughness: 0.78 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.86 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc2bcb0, roughness: 0.34, metalness: 0.75 });
    const canRedMat = new THREE.MeshStandardMaterial({ color: 0x9c281c, roughness: 0.45, metalness: 0.35 });
    const canOliveMat = new THREE.MeshStandardMaterial({ color: 0x455331, roughness: 0.55, metalness: 0.30 });
    const aluBoxMat = new THREE.MeshStandardMaterial({ color: 0xb0b5b8, roughness: 0.38, metalness: 0.82 });
    const fogLensMat = new THREE.MeshStandardMaterial({
      color: 0xffd148,
      emissive: 0xffaa18,
      emissiveIntensity: 0.45,
      roughness: 0.15,
    });

    const addPart = (name, geo, mat, pos, rot, explodeOffset) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      m.castShadow = true;
      m.receiveShadow = true;
      exp.add(m);
      this.explodeParts.push({
        mesh: m,
        basePos: m.position.clone(),
        offset: new THREE.Vector3(...explodeOffset),
      });
      this.pickableMeshes.push(m);
      return m;
    };

    // Stresni zahradka nad strechou oprena o okapnice (X = +-0.56, y = 1.485 nad klenbou 1.440)
    const rackY = 1.485;
    const rackZ = -1.18;
    addPart('Exp_RoofRack_Side_L', new THREE.BoxGeometry(0.025, 0.025, 1.06), rackMat, [-0.56, rackY, rackZ], null, [-0.25, 2.35, 0]);
    addPart('Exp_RoofRack_Side_R', new THREE.BoxGeometry(0.025, 0.025, 1.06), rackMat, [0.56, rackY, rackZ], null, [0.25, 2.35, 0]);
    addPart('Exp_RoofRack_Front', new THREE.BoxGeometry(1.14, 0.025, 0.025), rackMat, [0, rackY, rackZ + 0.52], null, [0, 2.35, 0.25]);
    addPart('Exp_RoofRack_Rear', new THREE.BoxGeometry(1.14, 0.025, 0.025), rackMat, [0, rackY, rackZ - 0.52], null, [0, 2.35, -0.25]);

    for (let i = 0; i < 4; i++) {
      const sx = -0.375 + i * 0.25;
      addPart(`Exp_RoofRack_Slat_${i}`, new THREE.BoxGeometry(0.055, 0.014, 1.02), woodMat, [sx, rackY - 0.014, rackZ], null, [0, 2.30, 0]);
    }
    for (const [fx, fz] of [[-0.56, -0.82], [0.56, -0.82], [-0.56, -1.54], [0.56, -1.54]]) {
      addPart('Exp_RoofRack_Foot', new THREE.BoxGeometry(0.028, 0.11, 0.028), rackMat, [fx, rackY - 0.06, fz], null, [0, 2.25, 0]);
    }

    // Rezervni kolo na strese
    addPart('Exp_SpareWheel_Tire', new THREE.TorusGeometry(0.21, 0.068, 12, 24), tireMat, [-0.20, rackY + 0.072, rackZ + 0.22], [Math.PI / 2, 0, 0], [-0.35, 2.65, 0.3]);
    addPart('Exp_SpareWheel_Rim', new THREE.CylinderGeometry(0.15, 0.15, 0.085, 18), rimMat, [-0.20, rackY + 0.072, rackZ + 0.22], [0, 0, 0], [-0.35, 2.65, 0.3]);

    // Dva kovove kanystry
    addPart('Exp_Jerrycan_Red', new THREE.BoxGeometry(0.16, 0.32, 0.24), canRedMat, [0.30, rackY + 0.16, rackZ + 0.18], [0, 0.12, 0], [0.42, 2.7, 0.2]);
    addPart('Exp_Jerrycan_Olive', new THREE.BoxGeometry(0.16, 0.32, 0.24), canOliveMat, [0.30, rackY + 0.16, rackZ - 0.14], [0, -0.06, 0], [0.42, 2.7, -0.2]);

    // Hlinikova expedicni bedna
    addPart('Exp_CargoBox', new THREE.BoxGeometry(0.48, 0.22, 0.42), aluBoxMat, [-0.18, rackY + 0.11, rackZ - 0.26], null, [-0.25, 2.75, -0.35]);

    // Pridavne mlhovky na konzolach ciste nad prednim naraznikem (y = 0.448 nad horni hranou 0.394)
    for (const [side, sx] of [['L', -0.34], ['R', 0.34]]) {
      addPart(`Exp_FogLight_Bracket_${side}`, new THREE.BoxGeometry(0.022, 0.045, 0.025), rackMat, [sx, 0.405, 0.715], null, [sx * 0.6, 0.25, 1.92]);
      addPart(`Exp_FogLight_Housing_${side}`, new THREE.CylinderGeometry(0.058, 0.048, 0.052, 16), rackMat, [sx, 0.448, 0.725], [Math.PI / 2, 0, 0], [sx * 0.6, 0.25, 1.95]);
      addPart(`Exp_FogLight_Lens_${side}`, new THREE.CylinderGeometry(0.050, 0.050, 0.012, 16), fogLensMat, [sx, 0.448, 0.753], [Math.PI / 2, 0, 0], [sx * 0.6, 0.25, 1.98]);
    }

    parentNode.add(exp);
    this.expeditionGroup = exp;
  }

  _buildExplodeGuideLines(parentNode) {
    // Vodicich car staci ~45 pro hlavni konstrukci (ne pro kazdy sroubek)
    const targets = this.explodeParts.filter((ep) => {
      const n = ep.mesh.name || '';
      if (n.includes('Bolt_') || n.includes('Nut_') || n.includes('Rivet_') || n.includes('RimSlot_') || n.includes('HeadFin_') || n.includes('CylFin_') || n.includes('FanBlade_') || n.startsWith('Exp_')) {
        return false;
      }
      return ep.offset.lengthSq() > 0.15;
    });

    if (targets.length === 0) return;

    const positions = new Float32Array(targets.length * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0xc96e1d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(geo, mat);
    lines.name = 'Explode_Guide_Lines';
    lines.visible = false;
    lines.frustumCulled = false;

    parentNode.add(lines);
    this.explodeLines = lines;
    this.explodeLineRefs = targets;
  }

  _upgradeTrabantMaterial(origMat, meshName, matCache) {
    if (!origMat) return origMat;
    if (matCache.has(origMat.uuid)) {
      return matCache.get(origMat.uuid);
    }

    this._prepareMaterialTextures(origMat);
    const matName = (origMat.name || '').toLowerCase();
    const isGlass =
      matName.includes('glass') ||
      meshName.includes('Windshield') ||
      meshName.includes('RearWindow') ||
      meshName.includes('DoorGlass') ||
      meshName.includes('QuarterGlass');

    let upgraded = origMat;

    if (isGlass) {
      upgraded = new THREE.MeshPhysicalMaterial({
        name: origMat.name || 'Mat_Trabant_ESG_Glass',
        color: new THREE.Color('#d8e2dc'),
        roughness: 0.06,
        metalness: 0.02,
        transmission: 0.72,
        thickness: 0.005,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        ior: 1.52,
        reflectivity: 0.95,
        envMapIntensity: 1.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    } else if (matName.includes('papyrus') && !meshName.includes('FluidReservoir')) {
      const dustUniform = { value: 1.0 };
      this.dustShaderUniforms.push(dustUniform);

      upgraded = new THREE.MeshPhysicalMaterial({
        name: origMat.name,
        color: origMat.color ? origMat.color.clone() : new THREE.Color(0xffffff),
        map: origMat.map || null,
        roughnessMap: origMat.roughnessMap || null,
        normalMap: origMat.normalMap || null,
        roughness: 0.34,
        metalness: 0.03,
        clearcoat: 1.0,
        clearcoatRoughness: 0.048,
        clearcoatNormalMap: this.orangePeelNormalTex,
        clearcoatNormalScale: new THREE.Vector2(0.085, 0.085),
        ior: 1.52,
        reflectivity: 0.96,
        envMapIntensity: 1.9,
      });

      upgraded.onBeforeCompile = (shader) => {
        shader.uniforms.uDustAmount = dustUniform;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vDustWorldPos;'
          )
          .replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvDustWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform float uDustAmount;
            varying vec3 vDustWorldPos;
            float calcRoadDust(vec3 wp) {
              float hMask = smoothstep(0.50, 0.14, wp.y) * uDustAmount;
              float n1 = sin(wp.x * 19.0 + wp.z * 11.0) * cos(wp.z * 23.0 - wp.y * 17.0);
              float n2 = sin(wp.x * 47.0 - wp.y * 31.0) * cos(wp.z * 43.0 + wp.x * 13.0);
              float dNoise = clamp(0.52 + 0.30 * n1 + 0.18 * n2, 0.0, 1.0);
              return clamp(hMask * (0.35 + 0.45 * dNoise), 0.0, 0.48);
            }`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float _dustFac = calcRoadDust(vDustWorldPos);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.28, 0.18), _dustFac);`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = mix(roughnessFactor, 0.92, calcRoadDust(vDustWorldPos));`
          );
      };
      upgraded.customProgramCacheKey = () => 'trabant-clearcoat-dust-v1';
    } else if (matName.includes('rimsilver')) {
      upgraded = new THREE.MeshPhysicalMaterial({
        name: origMat.name,
        color: origMat.color ? origMat.color.clone() : new THREE.Color(0xffffff),
        map: origMat.map || null,
        roughnessMap: origMat.roughnessMap || null,
        roughness: 0.34,
        metalness: 0.42,
        clearcoat: 0.48,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.65,
      });
    } else {
      if (upgraded.envMapIntensity !== undefined) {
        if (matName.includes('chrome')) {
          upgraded.envMapIntensity = 2.45;
          upgraded.metalness = 0.96;
        } else if (matName.includes('alu') || matName.includes('zinc')) {
          upgraded.envMapIntensity = 2.05;
        } else if (matName.includes('rubber') || matName.includes('ubotex')) {
          upgraded.envMapIntensity = 0.55;
        } else {
          upgraded.envMapIntensity = 1.25;
        }
      }
      if (matName.includes('taillight')) {
        this.taillightMat = upgraded;
      }
    }

    matCache.set(origMat.uuid, upgraded);
    return upgraded;
  }

  _createContactShadowTexture() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Mekký celkový stín pod podvozkem (elipsa)
    ctx.save();
    ctx.translate(size * 0.5, size * 0.5);
    ctx.scale(0.68, 0.92);
    const bodyGrad = ctx.createRadialGradient(0, 0, size * 0.10, 0, 0, size * 0.48);
    bodyGrad.addColorStop(0.0, 'rgba(12, 9, 6, 0.78)');
    bodyGrad.addColorStop(0.55, 'rgba(14, 10, 7, 0.48)');
    bodyGrad.addColorStop(0.85, 'rgba(16, 12, 8, 0.14)');
    bodyGrad.addColorStop(1.0, 'rgba(16, 12, 8, 0.0)');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4 koncentrované kontaktní AO skvrny přímo pod koly (Canvas flipY=true: v=0.233 -> uy=0.77 vpředu, v=0.767 -> uy=0.23 vzadu)
    const wheelUVs = [
      [0.19, 0.77],
      [0.81, 0.77],
      [0.18, 0.23],
      [0.82, 0.23],
    ];
    for (const [ux, uy] of wheelUVs) {
      const wx = ux * size;
      const wy = uy * size;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.scale(0.65, 1.15);
      const wg = ctx.createRadialGradient(0, 0, 2, 0, 0, size * 0.11);
      wg.addColorStop(0.0, 'rgba(6, 5, 4, 0.85)');
      wg.addColorStop(0.55, 'rgba(8, 6, 4, 0.36)');
      wg.addColorStop(1.0, 'rgba(8, 6, 4, 0.0)');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _loadTrabant(gltfLoader) {
    return new Promise((resolve) => {
      const url = withCacheBust(this.cfg.assets.trabantModel);
      gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const paintMatSet = new Set();
          const matCache = new Map();
          let bodyObj = null;

          model.traverse((child) => {
            const cName = child.name || '';
            if (cName === 'Trabant_Body') {
              bodyObj = child;
            }
            if (/Wheel_(FL|FR|RL|RR)_Spin$/.test(cName)) {
              this.wheelSpinNodes.push(child);
            } else if (cName === 'M12_Fan_Spinner') {
              this.fanSpinnerNode = child;
            } else if (cName === 'M07_Crank_Pulley_Pivot' || cName === 'E24_Dynamo_Pulley_Pivot') {
              this.pulleyNodes.push(child);
            } else if (cName === 'F58_Steering_Pivot') {
              this.steeringPivot = child;
            } else if (cName.startsWith('K22_WiperPivot_')) {
              this.wiperPivots.push({
                node: child,
                baseRotZ: child.rotation.z,
                baseRotY: child.rotation.y,
              });
            }
            if (!child.isMesh) return;

            const nm = child.name || '';
            const isShadowPlane = nm.includes('ContactShadow');
            const isGlass =
              nm.includes('Windshield') ||
              nm.includes('RearWindow') ||
              nm.includes('DoorGlass') ||
              nm.includes('QuarterGlass');

            if (!isShadowPlane) {
              this._ensureBoxUVs(child.geometry, 1.4);
            }

            child.castShadow = !isShadowPlane && !isGlass;
            child.receiveShadow = !isShadowPlane;

            if (isShadowPlane) {
              this.contactShadowMesh = child;
            }

            if (child.material) {
              if (isShadowPlane) {
                child.geometry.computeBoundingBox();
                const minY = child.geometry.boundingBox ? child.geometry.boundingBox.min.y : 0.012;
                child.position.y += (0.022 - minY);
                child.material = new THREE.MeshBasicMaterial({
                  map: this._createContactShadowTexture(),
                  transparent: true,
                  opacity: 0.88,
                  depthWrite: false,
                  polygonOffset: true,
                  polygonOffsetFactor: -3,
                });
                child.material.userData._baseOpacity = 0.88;
                child.renderOrder = 1;
              } else if (!Array.isArray(child.material)) {
                child.material = this._upgradeTrabantMaterial(child.material, nm, matCache);
                const matName = (child.material.name || '').toLowerCase();
                if (matName.includes('papyrus') && !nm.includes('FluidReservoir')) {
                  paintMatSet.add(child.material);
                }
              }

              if (isGlass) {
                child.renderOrder = 3;
              }
            }

            if (!isShadowPlane) {
              const offset = this._computeExplodeOffset(nm);
              this.explodeParts.push({
                mesh: child,
                basePos: child.position.clone(),
                offset,
              });
              this.pickableMeshes.push(child);
            }
          });

          this.paintMaterials = Array.from(paintMatSet);
          this.bodyNode = bodyObj || model;
          this.trabantGroup.add(model);

          // Jemne vnitrni osvetleni kabiny (tlumene, aby stropnice nesvitila pres sklo)
          this.cabinLight = new THREE.PointLight(0xffe6c4, 0.55, 2.6, 1.5);
          this.cabinLight.position.set(0.0, 1.15, -1.05);
          this.bodyNode.add(this.cabinLight);

          this._setupHingedBonnet(model);
          const glbExpedition = model.getObjectByName('Expedition_Pack');
          if (glbExpedition) {
            this.expeditionGroup = glbExpedition;
            this.expeditionGroup.visible = this.expeditionEnabled;
          } else {
            this._buildExpeditionPack(this.bodyNode);
          }
          this._buildExplodeGuideLines(this.bodyNode);

          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(model);
            const clip = gltf.animations[0];
            // Odstranit stopy _Spin, abychom mohli kola tocit plynule a bez stroboskopickeho zamrzani v Three.js
            clip.tracks = clip.tracks.filter((tr) => !tr.name.includes('_Spin.'));
            this.clipDuration = clip.duration || 2.0;
            const action = this.mixer.clipAction(clip);
            action.play();
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('[TRABANT] Nepodarilo se nacist trabant.glb, pouzivam nouzovou siluetu:', err);
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1.35, 3.55),
            new THREE.MeshStandardMaterial({ color: 0xd9ceb2, roughness: 0.35 })
          );
          box.position.y = 0.72;
          box.castShadow = true;
          this.trabantGroup.add(box);
          this.bodyNode = this.trabantGroup;
          resolve();
        }
      );
    });
  }

  async _initVFX() {
    const texLoader = new THREE.TextureLoader();
    const loadTex = (path) =>
      new Promise((res) => {
        texLoader.load(withCacheBust(path), (t) => res(t), undefined, () => res(null));
      });

    const [smokeTex, mistTex, moteTex, flareTex] = await Promise.all([
      loadTex(this.cfg.assets.vfx.smokePuff),
      loadTex(this.cfg.assets.vfx.softMist),
      loadTex(this.cfg.assets.vfx.dustMote),
      loadTex(this.cfg.assets.vfx.lensFlare),
    ]);

    if (flareTex) {
      const sunPos = this.cfg.lighting.sun.position || [28, 6.2, 16];
      const flareMat = new THREE.SpriteMaterial({
        map: flareTex,
        color: new THREE.Color(0xffd28e),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.flareSprite = new THREE.Sprite(flareMat);
      this.flareSprite.position.set(sunPos[0] * 1.4, sunPos[1] * 1.35, sunPos[2] * 1.4);
      this.flareSprite.scale.set(16, 16, 1);
      this.scene.add(this.flareSprite);
    }

    const dustCount = this.isMobile ? 40 : 72;
    for (let i = 0; i < dustCount; i++) {
      const tex = i % 3 === 0 && mistTex ? mistTex : smokeTex;
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(0xd9ba8c),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.scene.add(sp);
      this.dustSprites.push({
        sprite: sp,
        age: 99,
        life: 1.0,
        vel: new THREE.Vector3(),
        startScale: 0.35,
        endScale: 2.2,
        maxOpacity: 0.34,
      });
    }

    const exhaustCount = this.isMobile ? 20 : 36;
    for (let i = 0; i < exhaustCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        color: new THREE.Color(0xb8cbe0),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.scene.add(sp);
      this.exhaustSprites.push({
        sprite: sp,
        age: 99,
        life: 1.0,
        vel: new THREE.Vector3(),
        startScale: 0.14,
        endScale: 1.15,
        maxOpacity: 0.36,
      });
    }

    const moteCount = this.isMobile ? 72 : 160;
    const positions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = 0.25 + Math.random() * 4.8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 32;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const moteMat = new THREE.PointsMaterial({
      map: moteTex,
      color: 0xffe4b5,
      size: 0.16,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dustMotes = new THREE.Points(moteGeo, moteMat);
    this.scene.add(this.dustMotes);
  }

  setTargetSpeed(kmh) {
    this.targetSpeedKmh = Math.max(0, Math.min(100, Number(kmh) || 0));
  }

  setRoughTerrain(enabled) {
    this.roughTerrain = Boolean(enabled);
  }

  setPaintColor(paintId) {
    this.currentPaintId = paintId || 'papyrus';
    const mult = PAINT_MULTIPLIERS[this.currentPaintId] || '#ffffff';
    for (const mat of this.paintMaterials) {
      mat.color.set(mult);
    }
  }

  setExpeditionMode(enabled) {
    this.expeditionEnabled = Boolean(enabled);
    if (this.expeditionGroup) {
      this.expeditionGroup.visible = this.expeditionEnabled;
    }
  }

  setWipersEnabled(enabled) {
    this.wipersEnabled = Boolean(enabled);
  }

  setBonnetOpen(open, isManual = false) {
    if (isManual) {
      this.manualBonnet = Boolean(open);
    }
    this.bonnetOpenTarget = (this.manualBonnet !== null ? this.manualBonnet : Boolean(open)) ? 1 : 0;
  }

  syncChapterBonnet(isEngineChapter) {
    if (this.manualBonnet === null) {
      this.bonnetOpenTarget = isEngineChapter ? 1 : 0;
    }
  }

  setManualExplode(factorOrNull) {
    this.manualExplode = factorOrNull === null ? null : THREE.MathUtils.clamp(factorOrNull, 0, 1);
    this._recomputeBlueprintAndExplode();
  }

  setScrollProgress(progress) {
    this.scrollProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this._recomputeBlueprintAndExplode();
  }

  _recomputeBlueprintAndExplode() {
    if (this.manualExplode !== null) {
      this.explodeFactor = this.manualExplode;
      const manualBp = THREE.MathUtils.clamp(this.manualExplode / 0.18, 0, 1);
      const scrollBp = THREE.MathUtils.clamp((this.scrollProgress - 0.73) / 0.12, 0, 1);
      const bp = Math.max(manualBp, scrollBp);
      this.blueprintBlend = bp * bp * (3 - 2 * bp);
    } else {
      const bp = THREE.MathUtils.clamp((this.scrollProgress - 0.73) / 0.12, 0, 1);
      this.blueprintBlend = bp * bp * (3 - 2 * bp);
      const ex = THREE.MathUtils.clamp((this.scrollProgress - 0.84) / 0.16, 0, 1);
      this.explodeFactor = ex * ex * (3 - 2 * ex);
    }
    document.body.classList.toggle('is-blueprint-mode', this.blueprintBlend > 0.45);
  }

  setAtmosphere(presetKey) {
    const p = ATMOSPHERE_PRESETS[presetKey];
    if (!p) return null;
    this.atmosphereKey = presetKey;
    this.sunLight.color.set(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.sunLight.position.set(...p.sunPos);

    this.hemiLight.color.set(p.hemiSky);
    this.hemiLight.groundColor.set(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;
    if (this.skyFillLight) {
      this.skyFillLight.color.set(p.skyFillColor);
      this.skyFillLight.intensity = p.skyFillIntensity;
    }

    const targetEnv = this.envTextures[presetKey] || this.envTextures.sunset;
    if (targetEnv) {
      this.envTexture = targetEnv;
      this.scene.environment = targetEnv;
    }
    if (this.scene.environmentRotation) {
      this.scene.environmentRotation.y = p.envRotY ?? 0;
    }

    this.roadFogColor.set(p.fogColor);
    if (this.blueprintBlend < 0.02) {
      if (targetEnv) {
        this.scene.background = targetEnv;
      }
      this.scene.fog.color.copy(this.roadFogColor);
      this.scene.fog.density = p.fogDensity;
      this.scene.environmentIntensity = p.envIntensity;
      this.scene.backgroundIntensity = p.bgIntensity;
    }
    if (this.lutPass && this.lutPass.lut) {
      this.lutPass.enabled = p.lutEnabled;
    }
    if (this.flareSprite) {
      this.flareSprite.position.set(p.sunPos[0] * 1.4, p.sunPos[1] * 1.35, p.sunPos[2] * 1.4);
      this.flareSprite.material.opacity = presetKey === 'sunset' ? 0.45 : presetKey === 'noon' ? 0.18 : 0.0;
    }
    return p.label;
  }

  captureSnapshot() {
    this.render();
    const dataUrl = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `trabant-601-${this.atmosphereKey}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  _isNodeVisible(obj) {
    let cur = obj;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  pickTrabantPart(ndcX, ndcY) {
    if (!this.pickableMeshes.length) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Rychly hruby test proti obalovemu kvadru celeho Trabantu (preskoci prazdne pozadi)
    this.trabantGroup.updateMatrixWorld(true);
    this._trabantBoundsBox.setFromObject(this.trabantGroup);
    if (!this._trabantBoundsBox.isEmpty() && !this.raycaster.ray.intersectsBox(this._trabantBoundsBox)) {
      return null;
    }

    const hits = this.raycaster.intersectObjects(this.pickableMeshes, false);
    for (const h of hits) {
      if (this._isNodeVisible(h.object)) {
        return {
          mesh: h.object,
          info: describeTrabantPart(h.object.name),
        };
      }
    }
    return null;
  }

  setHighlightedPart(mesh) {
    if (this.highlightedMesh && this.highlightedMesh.material && this.highlightedMesh.material.emissive) {
      this.highlightedMesh.material.emissive.copy(this._origEmissive);
      this.highlightedMesh.material.emissiveIntensity = this._origEmissiveIntensity;
    }
    this.highlightedMesh = null;

    if (!mesh || !mesh.material) return;
    if (!mesh.userData._clonedForHighlight) {
      const origMat = mesh.material;
      const cloned = origMat.clone();
      if (origMat.onBeforeCompile) {
        cloned.onBeforeCompile = origMat.onBeforeCompile;
      }
      if (origMat.customProgramCacheKey) {
        cloned.customProgramCacheKey = origMat.customProgramCacheKey;
      }
      if (this.paintMaterials.includes(origMat)) {
        this.paintMaterials.push(cloned);
        cloned.color.set(PAINT_MULTIPLIERS[this.currentPaintId] || '#ffffff');
      }
      mesh.material = cloned;
      mesh.userData._clonedForHighlight = true;
    }
    if (mesh.material.emissive) {
      this._origEmissive.copy(mesh.material.emissive);
      this._origEmissiveIntensity = mesh.material.emissiveIntensity ?? 1;
      mesh.material.emissive.set('#e98c3a');
      mesh.material.emissiveIntensity = 0.55;
      this.highlightedMesh = mesh;
    }
  }

  _computeExplodeOffset(name) {
    const n = name || '';
    const v = new THREE.Vector3(0, 0, 0);

    if (n.startsWith('Exp_')) {
      if (n.includes('RoofRack')) return v.set(0, 2.35, 0);
      if (n.includes('SpareWheel')) return v.set(-0.35, 2.65, 0.30);
      if (n.includes('Jerrycan')) return v.set(0.42, 2.70, 0.0);
      if (n.includes('CargoBox')) return v.set(-0.25, 2.75, -0.35);
      if (n.includes('FogLight')) return v.set(0, 0.25, 1.95);
      return v.set(0, 2.35, 0);
    }

    if (n.includes('Roof')) return v.set(0, 1.95, 0);
    if (n.includes('Windshield')) return v.set(0, 1.35, 0.95);
    if (n.includes('RearWindow')) return v.set(0, 1.35, -0.95);
    if (n.includes('SideGlass_L') || n.includes('DoorGlass_L') || n.includes('QuarterGlass_L') || n.includes('SideFrame_L') || n.includes('VentBar_L')) return v.set(-0.95, 0.95, 0);
    if (n.includes('SideGlass_R') || n.includes('DoorGlass_R') || n.includes('QuarterGlass_R') || n.includes('SideFrame_R') || n.includes('VentBar_R')) return v.set(0.95, 0.95, 0);
    if (n.includes('Pillar_') || n.includes('Header_')) {
      const sx = n.includes('_L') || n.includes('AL') || n.includes('BL') || n.includes('CL') ? -0.55 : (n.includes('Header_') ? 0 : 0.55);
      const sz = n.includes('A') || n.includes('Front') ? 0.35 : (n.includes('C') || n.includes('Rear') ? -0.35 : 0);
      return v.set(sx, 1.25, sz);
    }

    if (n.includes('Bonnet') || n.includes('Sachsenring')) return v.set(0, 1.45, 0.95);
    if (n.includes('TrunkLid') || n.includes('TrunkHinge')) return v.set(0, 1.35, -1.15);
    if (n.includes('Attrappe') || n.includes('Grille') || n.includes('Front_Fascia') || n.includes('Plate_Front')) return v.set(0, 0.35, 1.35);
    if (n.includes('Headlight') || n.includes('Blinker')) {
      return v.set(n.includes('_L') ? -0.45 : 0.45, 0.42, 1.48);
    }
    if (n.includes('Bumper_Front')) return v.set(0, 0.05, 1.85);
    if (n.includes('Bumper_Rear')) return v.set(0, 0.05, -1.85);
    if (n.includes('Taillight') || n.includes('Rear_Panel') || n.includes('License_Light') || n.includes('Plate_Rear')) return v.set(0, 0.35, -1.42);
    if (n.includes('Wiper')) return v.set(0, 1.15, 0.65);

    if (n.includes('Fender_FL')) return v.set(-1.35, 0.45, 0.45);
    if (n.includes('Fender_FR')) return v.set(1.35, 0.45, 0.45);
    if (n.includes('Door_L') || n.includes('Door_Handle_L') || n.includes('Mirror_')) return v.set(-1.55, 0.42, 0);
    if (n.includes('Door_R') || n.includes('Door_Handle_R')) return v.set(1.55, 0.42, 0);
    if (n.includes('Fender_RL') || n.includes('C_Vent_L')) return v.set(-1.35, 0.45, -0.55);
    if (n.includes('Fender_RR') || n.includes('C_Vent_R')) return v.set(1.35, 0.45, -0.55);
    if (n.includes('SideTrim_')) {
      const sz = n.includes('Front') ? 0.45 : (n.includes('Rear') ? -0.55 : 0);
      return v.set(n.includes('_L') ? -1.78 : 1.78, 0.42, sz);
    }

    if (n.includes('Dashboard') || n.includes('Tacho') || n.includes('Wheel_Rim') || n.includes('Wheel_Spoke') || n.includes('Steering_Col') || n.includes('Shift_Rod') || n.includes('Inner_Mirror')) {
      return v.set(0, 0.92, 0.18);
    }
    if (n.includes('Seat_') || n.includes('Rear_Bench') || n.includes('Rear_Backrest') || n.includes('Handbrake')) {
      return v.set(0, 0.78, -0.18);
    }

    if (n.includes('M02_') || n.includes('M07_') || n.includes('M12_') || n.includes('M16_') || n.includes('M18_')) {
      return v.set(0.35, 0.85, 0.55);
    }
    if (n.includes('E01_') || n.includes('E24_') || n.includes('E28_')) return v.set(0.65, 0.92, 0.35);
    if (n.includes('E05_Battery')) return v.set(-0.78, 0.88, 0.35);
    if (n.includes('F51_Fuel')) return v.set(0.78, 1.05, 0.05);
    if (n.includes('F36_') || n.includes('F45_Brake')) return v.set(-0.45, 0.65, 0.15);
    if (n.includes('G02_')) return v.set(-0.35, 0.72, 0.45);
    if (n.includes('F55_') || n.includes('K58_')) return v.set(-0.35, -0.45, -0.45);

    const wheelMatch = n.match(/Wheel_(FL|FR|RL|RR)/);
    if (wheelMatch) {
      const wKey = wheelMatch[1];
      const sx = wKey.endsWith('L') ? -1 : 1;
      const sz = wKey.startsWith('F') ? 0.18 : -0.18;
      if (n.includes('BrakeDrum')) return v.set(0.62 * sx, 0.02, sz);
      if (n.includes('Tire')) return v.set(0.96 * sx, 0.04, sz);
      if (n.includes('Rim')) return v.set(1.32 * sx, 0.05, sz);
      if (n.includes('LugNut')) return v.set(1.56 * sx, 0.06, sz);
      if (n.includes('NutCap')) return v.set(1.72 * sx, 0.06, sz);
      if (n.includes('HubNut')) return v.set(1.62 * sx, 0.06, sz);
      if (n.includes('HubCap')) return v.set(1.86 * sx, 0.07, sz);
      return v.set(1.05 * sx, 0.05, sz);
    }
    if (n.includes('Susp_FL') || n.includes('Damper_FL') || n.includes('ControlArm_FL') || n.includes('HalfShaft_FL') || n.includes('BootInner_FL')) return v.set(-0.62, 0.25, 0.14);
    if (n.includes('Susp_FR') || n.includes('Damper_FR') || n.includes('ControlArm_FR') || n.includes('HalfShaft_FR') || n.includes('BootInner_FR')) return v.set(0.62, 0.25, 0.14);
    if (n.includes('Susp_RL') || n.includes('Damper_RL') || n.includes('ControlArm_RL')) return v.set(-0.62, 0.25, -0.14);
    if (n.includes('Susp_RR') || n.includes('Damper_RR') || n.includes('ControlArm_RR')) return v.set(0.62, 0.25, -0.14);
    if (n.includes('F01_Hilfsrahmen')) return v.set(0, -0.42, 0.35);
    if (n.includes('F04_Front')) return v.set(0, -0.25, 0.65);
    if (n.includes('F04_Rear')) return v.set(0, -0.25, -0.65);
    if (n.includes('F07_Steering')) return v.set(0, -0.18, 0.45);
    if (n.includes('Bolt_') || n.includes('Nut_') || n.includes('Rivet_')) return v.set(0, 1.15, 0);

    return v.set(0, 0, 0);
  }

  async toggleAudio() {
    if (!this.audio.ctx) {
      await this._setupAudio();
    }
    if (!this.audio.ctx) return false;

    if (this.audio.ctx.state === 'suspended') {
      await this.audio.ctx.resume();
    }

    this.audio.enabled = !this.audio.enabled;
    const now = this.audio.ctx.currentTime;
    this.audio.masterGain.gain.cancelScheduledValues(now);
    this.audio.masterGain.gain.setTargetAtTime(this.audio.enabled ? 1.0 : 0.0, now, 0.18);
    return this.audio.enabled;
  }

  async _setupAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);

      const windGain = ctx.createGain();
      windGain.gain.value = this.cfg.audio?.windVolume ?? 0.22;
      windGain.connect(master);

      fetch(withCacheBust(this.cfg.assets.audio))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
        .then((decoded) => {
          if (!decoded) return;
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.loop = true;
          src.connect(windGain);
          src.start(0);
          this.audio.windBufferLoaded = true;
        })
        .catch(() => {});

      // Vicevrstva synteza dvoutaktu (hlavni puls + sub-harmonika + pulzujici vyfukovy sum)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 34;

      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.value = 17;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 210;
      filter.Q.value = 3.2;

      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 11.5;

      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.42;

      const modGain = ctx.createGain();
      modGain.gain.value = 0.58;

      // Jemny vyfukovy sum (prrd-prrd)
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const chData = noiseBuf.getChannelData(0);
      for (let i = 0; i < chData.length; i++) {
        chData[i] = Math.random() * 2 - 1;
      }
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const noiseBand = ctx.createBiquadFilter();
      noiseBand.type = 'bandpass';
      noiseBand.frequency.value = 165;
      noiseBand.Q.value = 2.0;

      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.25;

      const engineGain = ctx.createGain();
      engineGain.gain.value = this.cfg.audio?.engineVolume ?? 0.14;

      lfo.connect(lfoDepth);
      lfoDepth.connect(modGain.gain);
      osc.connect(filter);
      subOsc.connect(filter);
      filter.connect(modGain);
      noiseSrc.connect(noiseBand);
      noiseBand.connect(noiseGain);
      noiseGain.connect(modGain);

      modGain.connect(engineGain);
      engineGain.connect(master);

      osc.start(0);
      subOsc.start(0);
      lfo.start(0);
      noiseSrc.start(0);

      this.audio.ctx = ctx;
      this.audio.masterGain = master;
      this.audio.windGain = windGain;
      this.audio.engineGain = engineGain;
      this.audio.engineOsc = osc;
      this.audio.engineSubOsc = subOsc;
      this.audio.engineLfo = lfo;
      this.audio.noiseGain = noiseGain;
    } catch (err) {
      console.warn('[AUDIO] Web Audio nelze inicializovat:', err);
    }
  }

  _spawnDust(origin, speedMs, isRear) {
    const slot = this.dustSprites.find((p) => p.age >= p.life);
    if (!slot) return;
    const sp = slot.sprite;
    const speedNorm = Math.min(1.5, speedMs / 14.0);
    const roughBoost = this.roughTerrain ? 1.45 : 1.0;
    sp.position.set(
      origin[0] + (Math.random() - 0.5) * 0.24,
      origin[1] + 0.05 + Math.random() * 0.10,
      origin[2] + (Math.random() - 0.5) * 0.18
    );
    slot.age = 0;
    slot.life = (isRear ? 1.15 : 0.75) + Math.random() * 0.65;
    slot.startScale = isRear ? 0.34 : 0.22;
    slot.endScale = (isRear ? 2.45 : 1.35) * (0.7 + 0.45 * speedNorm) * roughBoost;
    slot.maxOpacity = (isRear ? 0.36 : 0.18) * Math.min(1.0, speedNorm) * (this.roughTerrain ? 1.25 : 1.0);
    slot.vel.set(
      (origin[0] >= 0 ? 1 : -1) * (0.28 + Math.random() * 0.55),
      0.38 + Math.random() * 0.55 * speedNorm * roughBoost,
      -speedMs * (0.58 + Math.random() * 0.24)
    );
    sp.material.rotation = Math.random() * Math.PI * 2;
    sp.visible = true;
  }

  _spawnExhaust(speedMs) {
    const slot = this.exhaustSprites.find((p) => p.age >= p.life);
    if (!slot) return;
    const tip = this.cfg.driving.exhaustTip || [-0.46, 0.21, -2.82];
    const sp = slot.sprite;
    sp.position.set(
      tip[0] + (Math.random() - 0.5) * 0.05,
      tip[1] + this.trabantGroup.position.y + (Math.random() - 0.5) * 0.04,
      tip[2] - 0.06
    );
    slot.age = 0;
    slot.life = 0.85 + Math.random() * 0.65;
    slot.startScale = 0.14;
    slot.endScale = 0.95 + Math.random() * 0.55;
    slot.maxOpacity = speedMs > 1 ? 0.30 : 0.40;
    slot.vel.set(
      -0.18 + (Math.random() - 0.5) * 0.25,
      0.32 + Math.random() * 0.25,
      -(Math.max(1.2, speedMs * 0.52) + Math.random() * 0.6)
    );
    sp.material.rotation = Math.random() * Math.PI * 2;
    sp.visible = true;
  }

  update(dt) {
    const clampedDt = Math.min(dt, 0.05);
    this.elapsed += clampedDt;

    const effectiveTarget = this.blueprintBlend > 0.2 ? 0 : this.targetSpeedKmh;
    this.speedKmh += (effectiveTarget - this.speedKmh) * Math.min(1, clampedDt * 4.0);
    const speedMs = this.speedKmh / 3.6;

    const bp = this.blueprintBlend;
    const roadVisible = bp < 0.96;
    for (const tile of this.roadTiles) {
      tile.visible = roadVisible;
    }
    if (roadVisible && bp > 0.01) {
      for (const rm of this.roadMaterials) {
        rm.mat.transparent = true;
        rm.mat.opacity = (1 - bp) * rm.origOp;
      }
    } else if (bp <= 0.01) {
      for (const rm of this.roadMaterials) {
        if (rm.mat.opacity !== rm.origOp || rm.mat.transparent !== rm.origTrans) {
          rm.mat.transparent = rm.origTrans;
          rm.mat.opacity = rm.origOp;
        }
      }
    }

    if (this.blueprintPaperMesh) {
      const showPaper = bp > 0.01;
      this.blueprintPaperMesh.visible = showPaper;
      this.blueprintPaperMesh.material.opacity = bp;
    }

    const preset = ATMOSPHERE_PRESETS[this.atmosphereKey] || ATMOSPHERE_PRESETS.sunset;
    if (bp > 0.02) {
      if (!(this.scene.background instanceof THREE.Color)) {
        this.scene.background = this.roadFogColor.clone();
      }
      this.scene.background.copy(this.roadFogColor).lerp(this.paperBgColor, bp);
      this.scene.fog.density = preset.fogDensity * (1 - bp);
      this.scene.environmentIntensity = preset.envIntensity * (1 - bp * 0.35);
      if (this.studioLight) this.studioLight.intensity = bp * 1.45;
      if (this.flareSprite) this.flareSprite.visible = bp < 0.4;
      if (this.dustMotes) this.dustMotes.visible = bp < 0.6;
    } else {
      if (this.envTexture && this.scene.background !== this.envTexture) {
        this.scene.background = this.envTexture;
      }
      this.scene.fog.color.copy(this.roadFogColor);
      this.scene.fog.density = preset.fogDensity;
      this.scene.environmentIntensity = preset.envIntensity;
      this.scene.backgroundIntensity = preset.bgIntensity;
      if (this.studioLight) this.studioLight.intensity = 0;
      if (this.flareSprite) this.flareSprite.visible = true;
      if (this.dustMotes) this.dustMotes.visible = true;
    }

    if (this.filmPass) {
      this.filmPass.uniforms.uTime.value = this.elapsed;
      this.filmPass.uniforms.uGrain.value = 0.016 * (1 - bp * 0.90);
      this.filmPass.uniforms.uVignette.value = 0.24 * (1 - bp * 0.78);
      this.filmPass.uniforms.uChromatic.value = 0.0005 * (1 - bp);
    }
    const dustUniformVal = 1.0 - bp * 0.72;
    for (const u of this.dustShaderUniforms) {
      u.value = dustUniformVal;
    }
    if (this.headlightL && this.headlightR) {
      const hlIntensity = preset.headlights * (1 - bp);
      this.headlightL.intensity = hlIntensity;
      this.headlightR.intensity = hlIntensity;
    }

    // Rozpad vozu na jednotlive dily (s cachovanim inverzni rotace rodice)
    const ex = this.explodeFactor;
    if (this.explodeParts.length > 0) {
      if (ex > 0.001) {
        const parentQuatCache = new Map();
        const tmpDelta = new THREE.Vector3();
        for (const part of this.explodeParts) {
          tmpDelta.copy(part.offset).multiplyScalar(ex);
          const p = part.mesh.parent;
          if (p) {
            let invQ = parentQuatCache.get(p);
            if (!invQ) {
              invQ = new THREE.Quaternion();
              p.getWorldQuaternion(invQ).invert();
              parentQuatCache.set(p, invQ);
            }
            tmpDelta.applyQuaternion(invQ);
          }
          part.mesh.position.copy(part.basePos).add(tmpDelta);
        }
      } else {
        for (const part of this.explodeParts) {
          part.mesh.position.copy(part.basePos);
        }
      }
    }

    // Aktualizace vodicich car rozpadu
    if (this.explodeLines) {
      const showLines = ex > 0.04;
      this.explodeLines.visible = showLines;
      this.explodeLines.material.opacity = THREE.MathUtils.clamp((ex - 0.04) * 1.4, 0, 0.55);
      if (showLines && Math.abs(ex - this._lastLineEx) > 0.0005) {
        this._lastLineEx = ex;
        this.bodyNode.updateMatrixWorld(true);
        const posArr = this.explodeLines.geometry.attributes.position.array;
        const boxCenter = new THREE.Vector3();
        const p0 = new THREE.Vector3();
        const p1 = new THREE.Vector3();
        const worldOffset = new THREE.Vector3();
        for (let i = 0; i < this.explodeLineRefs.length; i++) {
          const ref = this.explodeLineRefs[i];
          boxCenter.set(0, 0, 0);
          if (ref.mesh.geometry) {
            if (!ref.mesh.geometry.boundingBox) {
              ref.mesh.geometry.computeBoundingBox();
            }
            if (ref.mesh.geometry.boundingBox) {
              ref.mesh.geometry.boundingBox.getCenter(boxCenter);
            }
          }
          p1.copy(boxCenter);
          ref.mesh.localToWorld(p1);
          worldOffset.copy(ref.offset).multiplyScalar(ex);
          p0.copy(p1).sub(worldOffset);
          this.bodyNode.worldToLocal(p1);
          this.bodyNode.worldToLocal(p0);
          const idx = i * 6;
          posArr[idx + 0] = p0.x;
          posArr[idx + 1] = p0.y;
          posArr[idx + 2] = p0.z;
          posArr[idx + 3] = p1.x;
          posArr[idx + 4] = p1.y;
          posArr[idx + 5] = p1.z;
        }
        this.explodeLines.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Kontaktni stin pod autem (v rezimu rysovaciho papiru jen jemne zeslabit, pri rozpadu zmizi)
    if (this.contactShadowMesh && this.contactShadowMesh.material) {
      const baseOp = this.contactShadowMesh.material.userData._baseOpacity ?? 0.88;
      const bpFade = 1.0 - bp * 0.65;
      const exFade = THREE.MathUtils.clamp(1 - ex * 3.0, 0, 1);
      this.contactShadowMesh.material.opacity = baseOp * bpFade * exFade;
      this.contactShadowMesh.visible = exFade > 0.02;
    }

    // Skutecne vyklapeni kapoty na pantech u celniho skla
    if (this.bonnetPivot) {
      const bonnetTarget = ex > 0.05 ? 0 : this.bonnetOpenTarget;
      this.bonnetOpenCurrent += (bonnetTarget - this.bonnetOpenCurrent) * Math.min(1, clampedDt * 5.2);
      this.bonnetPivot.rotation.x = -this.bonnetOpenCurrent * 0.72;
    }

    // Nekonecny posun dlazdic silnice
    const tileLen = this.cfg.driving.roadTileLength || 32.0;
    const totalLen = tileLen * this.roadTiles.length;
    const wrapLimit = totalLen * 0.5;
    for (const tile of this.roadTiles) {
      tile.position.z -= speedMs * clampedDt;
      if (tile.position.z < -wrapLimit) {
        tile.position.z += totalLen;
      }
    }

    // Synchronizace Blender animace pruzeni (bez _Spin kol, ta tocime primo nize)
    if (this.mixer) {
      if (speedMs > 0.05) {
        const wheelCirc = 2 * Math.PI * (this.cfg.driving.wheelRadius || 0.2825);
        const revPerSec = speedMs / wheelCirc;
        const roughScale = this.roughTerrain ? 1.35 : 1.0;
        this.mixer.timeScale = revPerSec * this.clipDuration * roughScale;
        this.mixer.update(clampedDt);
      } else {
        this.mixer.timeScale = 0;
      }
    }

    // Spolehlive otaceni vsech 4 kol bez stroboskopickeho zamrzani
    if (speedMs > 0.05 && this.wheelSpinNodes.length > 0 && ex < 0.05) {
      const wheelR = this.cfg.driving.wheelRadius || 0.2825;
      const wheelAngular = (speedMs / wheelR) * 0.48 * clampedDt;
      for (const wNode of this.wheelSpinNodes) {
        wNode.rotation.x += wheelAngular;
      }
    }

    // Chladici ventilator P 65, remenice, volant, sterace a brzdova svetla
    if (ex < 0.05) {
      const fanSpeed = (14.0 + this.speedKmh * 0.55) * clampedDt;
      if (this.fanSpinnerNode) {
        this.fanSpinnerNode.rotation.x += fanSpeed;
      }
      for (const pNode of this.pulleyNodes) {
        pNode.rotation.x += fanSpeed * 0.85;
      }
      if (this.steeringPivot) {
        const steerAmp = speedMs > 0.5 ? 0.16 : 0.0;
        this.steeringPivot.rotation.z = Math.cos(this.elapsed * 0.85) * steerAmp;
      }
      if (this.wiperPivots.length > 0) {
        if (this.wipersEnabled) {
          this.wiperPhase += clampedDt * 3.4;
          const sweep = (0.5 - 0.5 * Math.cos(this.wiperPhase)) * 1.15;
          for (const wp of this.wiperPivots) {
            wp.node.rotation.z = wp.baseRotZ - sweep;
          }
        } else {
          for (const wp of this.wiperPivots) {
            wp.node.rotation.z += (wp.baseRotZ - wp.node.rotation.z) * Math.min(1, clampedDt * 8);
          }
        }
      }
    }
    if (this.taillightMat && this.taillightMat.emissiveIntensity !== undefined) {
      const isBraking = this.targetSpeedKmh === 0 || this.speedKmh > this.targetSpeedKmh + 2.0;
      const targetEm = (isBraking ? 5.8 : 1.8) * (1 - bp);
      this.taillightMat.emissiveIntensity += (targetEm - this.taillightMat.emissiveIntensity) * Math.min(1, clampedDt * 8);
    }
    if (this.cabinLight) {
      this.cabinLight.intensity = 0.55 * (1 - bp * 0.65);
    }

    // Zivy pohyb na silnici / polnacce
    if (speedMs > 0.05 && bp < 0.8) {
      const rAmp = this.roughTerrain ? 2.8 : 1.0;
      const heave = this.roughTerrain
        ? (Math.sin(this.elapsed * 9.5) * 0.024 + Math.sin(this.elapsed * 16.5) * 0.012) * Math.min(1.2, speedMs / 12)
        : Math.sin(this.elapsed * 14.0) * 0.003;
      this.trabantGroup.position.x = Math.sin(this.elapsed * 0.85) * 0.045 * (this.roughTerrain ? 1.6 : 1.0);
      this.trabantGroup.position.y = heave;
      this.trabantGroup.rotation.y = Math.cos(this.elapsed * 0.85) * 0.008 * rAmp;
      this.trabantGroup.rotation.z = this.roughTerrain ? Math.sin(this.elapsed * 7.2) * 0.028 : 0;
      this.trabantGroup.rotation.x = this.roughTerrain ? Math.cos(this.elapsed * 10.4) * 0.018 : 0;
    } else {
      const idleScale = 1 - bp;
      this.trabantGroup.position.x *= 0.9;
      this.trabantGroup.position.y = Math.sin(this.elapsed * 32.0) * 0.0018 * idleScale;
      this.trabantGroup.rotation.z = Math.sin(this.elapsed * 29.0) * 0.0012 * idleScale;
      this.trabantGroup.rotation.x *= 0.9;
      this.trabantGroup.rotation.y *= 0.9;
    }

    // VFX: Zvireny prach za koly
    if (speedMs > 1.2 && bp < 0.25) {
      const dustRate = (12 + speedMs * 2.2) * (this.roughTerrain ? 1.85 : 1.0);
      this.dustSpawnAcc += dustRate * clampedDt;
      while (this.dustSpawnAcc >= 1) {
        this.dustSpawnAcc -= 1;
        const rear = this.cfg.driving.rearWheels;
        const front = this.cfg.driving.frontWheels;
        if (Math.random() < 0.72) {
          this._spawnDust(rear[Math.random() < 0.5 ? 0 : 1], speedMs, true);
        } else {
          this._spawnDust(front[Math.random() < 0.5 ? 0 : 1], speedMs, false);
        }
      }
    }

    for (const p of this.dustSprites) {
      if (p.age >= p.life) continue;
      p.age += clampedDt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, clampedDt);
      p.vel.z *= 1 - 0.55 * clampedDt;
      const s = THREE.MathUtils.lerp(p.startScale, p.endScale, Math.pow(t, 0.7));
      p.sprite.scale.set(s, s, 1);
      const fade = t < 0.16 ? t / 0.16 : 1 - (t - 0.16) / 0.84;
      p.sprite.material.opacity = Math.max(0, fade * fade * p.maxOpacity * (1 - bp));
      p.sprite.material.rotation += clampedDt * 0.45;
    }

    // VFX: Modry dvoutaktni kour z vyfuku
    const exhaustRate = bp > 0.2 ? 0 : 7 + speedMs * 1.1;
    this.exhaustSpawnAcc += exhaustRate * clampedDt;
    while (this.exhaustSpawnAcc >= 1) {
      this.exhaustSpawnAcc -= 1;
      this._spawnExhaust(speedMs);
    }

    for (const p of this.exhaustSprites) {
      if (p.age >= p.life) continue;
      p.age += clampedDt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, clampedDt);
      p.vel.z *= 1 - 0.8 * clampedDt;
      const s = THREE.MathUtils.lerp(p.startScale, p.endScale, Math.pow(t, 0.75));
      p.sprite.scale.set(s, s, 1);
      const fade = t < 0.14 ? t / 0.14 : 1 - (t - 0.14) / 0.86;
      p.sprite.material.opacity = Math.max(0, fade * p.maxOpacity * (1 - bp));
      p.sprite.material.rotation -= clampedDt * 0.6;
    }

    // VFX: Prachova smitka ve vzduchu (pouze kdyz jsou viditelna)
    if (this.dustMotes && this.dustMotes.visible) {
      const posAttr = this.dustMotes.geometry.attributes.position;
      const driftZ = (1.6 + speedMs * 0.65) * clampedDt;
      for (let i = 0; i < posAttr.count; i++) {
        let z = posAttr.getZ(i) - driftZ;
        if (z < -16) z += 32;
        const y = posAttr.getY(i) + Math.sin(this.elapsed * 0.9 + i) * 0.002;
        posAttr.setY(i, y);
        posAttr.setZ(i, z);
      }
      posAttr.needsUpdate = true;
    }

    // Dynamicky zvuk motoru
    if (this.audio.ctx && this.audio.enabled) {
      const now = this.audio.ctx.currentTime;
      const baseFreq = 34 + this.speedKmh * 0.85;
      const targetLfo = 10.5 + this.speedKmh * 0.28;
      this.audio.engineOsc.frequency.setTargetAtTime(baseFreq, now, 0.12);
      this.audio.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.12);
      this.audio.engineLfo.frequency.setTargetAtTime(targetLfo, now, 0.12);
      const windVol = (this.cfg.audio?.windVolume ?? 0.22) * (0.45 + 0.85 * (this.speedKmh / 60));
      this.audio.windGain.gain.setTargetAtTime(windVol, now, 0.15);
    }
  }

  render() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(w, h);
    }
  }
}
