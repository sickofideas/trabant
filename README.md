# Trabant 601 — Interaktivní 3D cesta po zaprášené silnici

Fotorealistický interaktivní 3D web vytvořený v pipeline **Blender 5.3.0 (GPU OPTIX Cycles AO + Draco/WEBP GLB) → Three.js r170+ (HDRI/PMREM, 3D LUT, Bloom, VFX částice, Web Audio, GSAP ScrollTrigger + Lenis)**.

## Co web nabízí
- **Realisticky jedoucí Trabant 601** po nekonečné zaprášené okresní silnici s klíčovanou Blender animací kol a pružení podvozku (včetně přepínače **Okreska / Rozbitá polňačka**).
- **Plynulý scroll průlet (8 kapitol):** rolováním kolečka myši nebo šipkami kamera filmově obíhá kolem jedoucího vozu (příď, vyklápěcí kapota s motorem P 65, duroplastová karoserie, podvozek, expedice) až po přechod na rýsovací papír s kompletním rozpadem dílů.
- **Interaktivní dílna a encyklopedie ETK 1980:** přepínání dobových barev laku (*Papyrusweiss*, *Monsungelb*, *Gletscherblau*, *Panamagrün*), **Expediční výbava** (střešní zahrádka, rezerva, kanystry, mlhovky), ruční posuvník rozpadu a **klikání na jednotlivé 3D díly** pro zobrazení technických detailů.
- **Živé VFX částice:** zvířený prach za koly, namodralý kouř z dvoutaktního výfuku a zlatá prachová smítka v nízkém slunci.
- **Interaktivní ovládání:** přepínání rychlosti jízdy (Pauza / 30 / 50 / 80 km/h), **Volný pohled (`OrbitControls`)**, **Fotorežim** (přepínání denní doby + stažení PNG snímku) a **Zvuk / Mute**.

## Jak přidat vlastní 3D model Trabanta (Blender)
1. Vlož svůj 3D model Trabanta (`.glb`, `.gltf`, `.fbx`, `.obj` nebo `.blend`) do složky `assets_raw/`.
2. Spusť dvojklikem `vygeneruj_3d_modely.bat`.
3. Skript automaticky srovná měřítko vozu na skutečných `3,555 m`, posadí jej na silnici, najde kola pro rotaci, zapeče AO na silnici, vyexportuje komprimované `.glb` a aktualizuje složku `github_upload/`.

## Lokální spuštění a publikace na GitHub Pages
- **Lokální náhled:** spusť `spustit_lokalni_server.bat` (otevře `http://localhost:8000/`).
- **Publikace na GitHub Pages:** spusť `pripravit_slozku_pro_github.bat` (případně se spustí automaticky po buildu 3D modelů) a obsah složky `github_upload/` přetáhni přímo na GitHub (*Add file → Upload files* a zapni *Settings → Pages → `main` / `/ (root)`*).

## Hybridní režim: Filmové Cycles / WebP scroll-video + interaktivní 3D
Web podporuje kombinaci **předrenderované WebP sekvence na `<canvas>`** (kapitoly 01–06 s progresivním načítáním a stabilními 60 FPS) a **živé Three.js scény** (kapitoly 07–08: rýsovací papír, kompletní rozpad dílů ETK 1980, dílna, lak a volný pohled).
- **Vyrenderovat z Blender Cycles + FFmpeg:** spusť `vygeneruj_scroll_video.bat` (pro rychlý náhled `vygeneruj_scroll_video.bat -Preview`).
- **Převést vlastní / AI MP4 video (Veo, Flow):** přetáhni `.mp4` soubor na `prevest_mp4_na_webp.bat` (nebo ho vlož do `assets_raw/` a spusť `.bat`).
- Dokud nejsou snímky v `assets/frames_desktop/` vygenerované, web automaticky běží v čistém 3D režimu bez chyby. Přepínat mezi režimy lze kdykoli tlačítkem v horní liště nebo klávesou `V`.
