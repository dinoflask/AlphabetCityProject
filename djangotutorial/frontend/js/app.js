import * as THREE from "three";
import { REVISION } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import fragment from "./shader/fragment.glsl";
import fragmentShaderVelocity from "./shader/fragmentShaderVelocity.glsl";
import fragmentShaderPosition from "./shader/fragmentShaderPosition.glsl";
import vertex from "./shader/vertexParticles.glsl";
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import GUI from 'lil-gui';
import gsap from "gsap";
import load from "load-asset"; 
import t1 from "../img/t1.png";
import t2 from "../img/t2.png";
import poissonDiskSampling from "poisson-disk-sampling";

let COUNT = 32;
let TEXTURE_WIDTH = COUNT**2;

// One color per question (by the question's 0-based index). Each answer dot is
// colored by which question it answers; extra questions cycle through these.
const Q_COLORS = [
  [0.80, 0.22, 0.14], // 0 red
  [0.93, 0.74, 0.20], // 1 yellow
  [0.47, 0.30, 0.12], // 2 brown
];

// Colorful warm palette for the non-answer filler dots, matching the glyph in
// Index.png (gold / amber / orange / burnt / tan / light brown).
const FILLER_PALETTE = [
  [0.94, 0.76, 0.22], // gold
  [0.88, 0.64, 0.18], // amber
  [0.92, 0.56, 0.16], // orange
  [0.80, 0.42, 0.15], // burnt orange
  [0.74, 0.56, 0.24], // tan-gold
  [0.62, 0.44, 0.20], // light brown
];

// Easing for the menu appear animation.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
// Gentle single overshoot (cute, not springy). Raise OVERSHOOT for more bounce.
const OVERSHOOT = 1.1;
const easeOutBack = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = OVERSHOOT, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export default class Sketch {
  constructor(options) {
    this.scene = new THREE.Scene();

    this.container = options.dom;
    this.answers = options.answers || []; // [{ id, q, title, body }] from the DB
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0); // transparent — the garden shows through behind

    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      70,
      this.width / this.height,
      0.01,
      1000
    );

    // let frustumSize = 10;
    // let aspect = this.width / this.height;
    // this.camera = new THREE.OrthographicCamera( frustumSize * aspect / - 2,
    // frustumSize * aspect / 2, frustumSize / 2, frustumSize / - 2, -1000, 1000 );
    this.camera.position.set(0, 0, 2);
    this.camera.lookAt(0, 0, 0); // fixed, centered on the glyph (no orbit controls)
    this.time = 0;

    const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;
    this.dracoLoader = new DRACOLoader( new THREE.LoadingManager() ).setDecoderPath(
      `${THREE_PATH}/examples/jsm/libs/draco/gltf/` );
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.isPlaying = true;

    // Hover-to-reveal state.
    this.hoverIndex = -1;                         // locked answer particle, or -1
    this.HOVER_R = 26;                            // px radius to grab an answer dot
    this.HOVER_DELAY = 160;                       // ms to wait before a dot grows
    this.hoverAmt = 0;                            // eased grow/glow amount (0..1)
    this.hoverActivateAt = 0;                     // timestamp growth may begin
    // Menu appear animation: draw the L-connector, then pop the box open.
    this.LINE_DUR = 240;                          // ms to draw the L line
    this.BOX_DUR = 150;                           // ms for the box scale-up (pop)
    this.appearStart = 0;                         // timestamp the animation began
    this.mousePx = null;                          // mouse in container pixels
    this.posBuffer = new Float32Array(COUNT * COUNT * 4); // GPGPU positions read back
    this._v = new THREE.Vector3();                // scratch for projection
    this.answerIndices = [];                      // particle indices that are answers
    this.answerInfo = {};                         // index -> { title, body, color, own, editUrl, deleteUrl }
    this.ownParticleIndex = null;                 // the signed-in resident's own answer dot

    // Screensaver mode: eased camera dolly + auto-cycling of answer details.
    this.baseCamZ = 2;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.autoMode = false;   // when true, hover is ignored and details auto-cycle
    this._autoPtr = null;    // index into answerIndices for the sequential cycle

    this.initAll();


  }

  async initAll(){
    this.points1 = await this.getPoints(t1);
    this.points2 = await this.getPoints(t2);

    
    this.initGPU();
    this.addObjects();
    this.initMenu();
    this.resize();
    this.render();
    this.setupResize();

    // If the resident has their own answer, open its info box on load to show
    // them where it is (once positions have been read back a few frames in).
    if (this.ownParticleIndex !== null) {
      setTimeout(() => {
        if (this.hoverIndex < 0 && !this.autoMode) this.lockTo(this.ownParticleIndex);
      }, 1400);
    }
  }

  async getPoints(url){
    const image = await load(url);
    let canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d", { willReadFrequently: true })
    canvas.width = COUNT;
    canvas.height = COUNT;
    // Flatten transparency onto WHITE first. A transparent PNG otherwise reads
    // as red=0 everywhere (same as "dark") -> uniform density -> a square pool.
    // With a white backing, only the actual shape stays dark (= dense).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, COUNT, COUNT);
    ctx.drawImage(image, 0, 0, COUNT, COUNT);
    let data = ctx.getImageData(0, 0, COUNT, COUNT).data;
    let array = new Array(COUNT).fill().map(() => new Array(COUNT).fill(0))

    for (let i = 0; i < COUNT; i++) {
      for (let j = 0; j < COUNT; j++) {
        let position = (i + j * COUNT) * 4;
        let color = data[position] / 255;
        array[i][j] = color;
      }
    }

    var pds = new poissonDiskSampling({
    shape: [1, 1],
    minDistance: 2/400,
    maxDistance: 20/400,
    tries: 40,
    distanceFunction: function (point) {
        let indexX = Math.floor(point[0] * COUNT);
        let indexY = Math.floor(point[1] * COUNT);
        return array[indexX][indexY]
    },
    bias: 0
    }); 

    let points = pds.fill();
    // Keep only points that land ON the shape (dark pixels); drop the background
    // so every particle sits on the silhouette (each dot = an answer later).
    points = points.filter(function (p) {
      let ix = Math.min(COUNT - 1, Math.floor(p[0] * COUNT));
      let iy = Math.min(COUNT - 1, Math.floor(p[1] * COUNT));
      return array[ix][iy] < 0.5;   // < 0.5 = dark = inside the shape
    });
    points.sort((a,b) => Math.random() - 0.5);
    points = points.slice(0, TEXTURE_WIDTH);
    return points
  }

  

  setUpSettings() {
    this.settings = {
      progress: 0,
    };
    this.gui = new GUI();
    this.gui.add(this.settings, "progress", 0, 1, 0.01).onChange((val) => {})
  }

  setupResize() {
    window.addEventListener("resize", this.resize.bind(this));
  }

  resize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  addObjects() {
    this.material = new THREE.ShaderMaterial({
      extensions: {
        derivatives: "#extension GL_OES_standard_derivatives : enable"
      },
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        resolution: { value: new THREE.Vector4() },
        uPositions: { value: null },
        uHoverIndex: { value: -1 }, // which answer dot is hovered
        uHoverAmt: { value: 0 }     // eased 0->1 grow/glow amount (with delay)
      },
      // wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      vertexShader: vertex,
      fragmentShader: fragment
    });

    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

    this.geometry = new THREE.BufferGeometry();
    let count = TEXTURE_WIDTH;
    let positions =  new Float32Array(count * 3)
    let reference = new Float32Array(count * 2)
    let colors = new Float32Array(count * 3)
    let scales = new Float32Array(count)
    let isAnswer = new Float32Array(count)
    let indices = new Float32Array(count)

    // The real DB answers occupy the LAST indices so they draw AFTER (on top of)
    // the filler dots; everything before them is colorful filler.
    const nAnswers = Math.min(this.answers.length, count);
    const answerStart = count - nAnswers;

    for( let i = 0; i < count; i++) {
      positions[i*3] = 5* Math.random() - .5;
      positions[i*3+1] = 5* Math.random() - .5;
      positions[i*3+2] = 0;
      reference[i*2] = (i % COUNT)/COUNT;
      reference[i*2 + 1] = ~ ~ (i / COUNT)/COUNT;
      indices[i] = i;

      if (i >= answerStart) {
        // Answer dot: big, outlined, colored by its question.
        const a = this.answers[i - answerStart];
        const c = Q_COLORS[a.q % Q_COLORS.length];
        const shade = 0.9 + Math.random() * 0.2;
        colors[i*3]   = Math.min(1, c[0] * shade);
        colors[i*3+1] = Math.min(1, c[1] * shade);
        colors[i*3+2] = Math.min(1, c[2] * shade);
        scales[i] = 1.1 + Math.random() * 0.4;   // answer dots (bigger than filler)
        isAnswer[i] = 1;

        this.answerIndices.push(i);
        this.answerInfo[i] = {
          title: a.title, body: a.body, color: c,
          own: !!a.own, editUrl: a.editUrl, deleteUrl: a.deleteUrl,
        };
        if (a.own && this.ownParticleIndex === null) this.ownParticleIndex = i;
      } else {
        // Filler dot: small and colorful (warm), helps fill out the silhouette.
        const c = FILLER_PALETTE[(Math.random() * FILLER_PALETTE.length) | 0];
        const shade = 0.85 + Math.random() * 0.25;
        colors[i*3]   = Math.min(1, c[0] * shade);
        colors[i*3+1] = Math.min(1, c[1] * shade);
        colors[i*3+2] = Math.min(1, c[2] * shade);
        scales[i] = 0.45 + Math.random() * 0.4;
        isAnswer[i] = 0;
      }
    }

    let positionAttribute = new THREE.BufferAttribute(positions, 3);
    this.geometry.setAttribute('position', positionAttribute);

    let referenceAttribute = new THREE.BufferAttribute(reference, 2 );
    this.geometry.setAttribute('reference', referenceAttribute);

    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    this.geometry.setAttribute('aIsAnswer', new THREE.BufferAttribute(isAnswer, 1));
    this.geometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));
    

    this.plane = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.plane);
  }

  fillPositionTexture(texture){
    const theArray = texture.image.data;

				for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {
					theArray[ k + 0 ] = 2*(Math.random() - 0.5);
					theArray[ k + 1 ] = 2*(Math.random() - 0.5);
					theArray[ k + 2 ] = 0;
					theArray[ k + 3 ] = 1;

				}
  }

  fillVelocityTexture(texture){
    const theArray = texture.image.data;

				for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {

					theArray[ k + 0 ] = 0.1*(Math.random() - 0.5);
					theArray[ k + 1 ] = 0.1*(Math.random() - 0.5);
					theArray[ k + 2 ] = 0;
					theArray[ k + 3 ] = 1;

				}
  }

  fillPositionTextureFromPoints(texture, points){
    const theArray = texture.image.data;

    for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {

      let i = k/4;
      let p = points[i % points.length];   // wrap if fewer points than particles

      theArray[ k + 0 ] = 2*(p[0] - 0.5);
      theArray[ k + 1 ] = 2*(p[1] - 0.5);
      theArray[ k + 2 ] = 0;
      theArray[ k + 3 ] = 1;
    }
  }


  initGPU(){
    
    this.gpuCompute = new GPUComputationRenderer( COUNT, COUNT, this.renderer );

				const dtPosition = this.gpuCompute.createTexture();
        const dtPosition1 = this.gpuCompute.createTexture();
				const dtVelocity = this.gpuCompute.createTexture();
				this.fillPositionTextureFromPoints( dtPosition, this.points1 );
				this.fillPositionTextureFromPoints( dtPosition1, this.points2 );
				this.fillVelocityTexture( dtVelocity );

        const target1 = this.gpuCompute.createTexture();
				const target2 = this.gpuCompute.createTexture();
        this.fillPositionTextureFromPoints( target1, this.points1 );
				this.fillPositionTextureFromPoints( target2 , this.points2 );

				this.velocityVariable = this.gpuCompute.addVariable( 'textureVelocity', fragmentShaderVelocity, dtVelocity );
				this.positionVariable = this.gpuCompute.addVariable( 'texturePosition', fragmentShaderPosition, dtPosition );

				this.gpuCompute.setVariableDependencies( this.velocityVariable, [ this.positionVariable, this.velocityVariable ] );
				this.gpuCompute.setVariableDependencies( this.positionVariable, [ this.positionVariable, this.velocityVariable ] );

				this.positionUniforms = this.positionVariable.material.uniforms;
				this.velocityUniforms = this.velocityVariable.material.uniforms;

				this.positionUniforms[ 'time' ] = { value: 0.0 };
				this.velocityUniforms[ 'time' ] = { value: 1.0 };
        this.velocityUniforms[ 'uTarget' ] = { value: target1 };

				this.velocityVariable.wrapS = THREE.RepeatWrapping;
				this.velocityVariable.wrapT = THREE.RepeatWrapping;
				this.positionVariable.wrapS = THREE.RepeatWrapping;
				this.positionVariable.wrapT = THREE.RepeatWrapping;

				this.gpuCompute.init();
  }

  render() {
    if (!this.isPlaying) return;
    this.time += 0.05;
    this.material.uniforms.time.value = this.time;
    this.gpuCompute.compute();
    this.positionUniforms[ 'time' ].value = this.time;
		this.velocityUniforms[ 'time' ].value = this.time;

    const posTarget = this.gpuCompute.getCurrentRenderTarget( this.positionVariable );
    this.material.uniforms.uPositions.value = posTarget.texture;

    // Read the (tiny 32x32) position texture back to the CPU so we know where each
    // answer dot is on screen — for hover detection and menu-following.
    try {
      this.renderer.readRenderTargetPixels(posTarget, 0, 0, COUNT, COUNT, this.posBuffer);

      // Hovering a different answer dot immediately switches to it (no click). In
      // screensaver mode hover is ignored — details are cycled automatically. If
      // the cursor isn't over any dot, the current menu stays locked & following.
      // Also freeze switching while an overlay (help / delete confirm) is open.
      const overlayOpen =
        (this.helpPanel && this.helpPanel.classList.contains("open")) ||
        (this.deleteConfirm && this.deleteConfirm.classList.contains("open"));
      if (!this.autoMode && !this.overMenu && !overlayOpen) {
        const near = this.nearestAnswer();
        if (near >= 0 && near !== this.hoverIndex) this.lockTo(near);
      }
      if (this.hoverIndex >= 0) this.updateMenu();
    } catch (e) { /* float readback unsupported — hover disabled */ }

    // Grow/glow the hovered dot: wait HOVER_DELAY, then ease in; ease back out
    // on unhover. uHoverIndex stays put during ease-out so the shrink is visible.
    const grow = (this.hoverIndex >= 0 && performance.now() >= this.hoverActivateAt) ? 1 : 0;
    this.hoverAmt += (grow - this.hoverAmt) * 0.1;
    this.material.uniforms.uHoverAmt.value = this.hoverAmt;

    // Ease the screensaver camera dolly (zoom = 1 normal, >1 pushed in).
    this.zoom += (this.zoomTarget - this.zoom) * 0.06;
    this.camera.position.z = this.baseCamZ / this.zoom;

    requestAnimationFrame(this.render.bind(this));
    this.renderer.render(this.scene, this.camera);
  }

  // ---- Screensaver hooks ---------------------------------------------------
  setZoom(z) { this.zoomTarget = z; }
  setAutoMode(on) { this.autoMode = on; if (!on) this._autoPtr = null; }
  autoSelectNext() {
    if (!this.answerIndices.length) return;
    this._autoPtr = (this._autoPtr === null) ? 0 : (this._autoPtr + 1) % this.answerIndices.length;
    this.lockTo(this.answerIndices[this._autoPtr]);
  }

  // ---- Hover-to-reveal menu ------------------------------------------------

  // Current world position of particle i, matching the vertex shader (Y flipped).
  dotWorld(i) {
    const b = this.posBuffer;
    return { x: b[i * 4], y: -b[i * 4 + 1], z: b[i * 4 + 2] };
  }

  // Project a world point to container pixel coordinates.
  worldToScreen(x, y, z) {
    this._v.set(x, y, z).project(this.camera);
    return {
      x: (this._v.x * 0.5 + 0.5) * this.width,
      y: (-this._v.y * 0.5 + 0.5) * this.height,
    };
  }

  // The nearest answer dot under the cursor (within HOVER_R), or -1 if none.
  nearestAnswer() {
    if (!this.mousePx) return -1;
    let best = -1, bestD = this.HOVER_R;
    for (const i of this.answerIndices) {
      const w = this.dotWorld(i);
      const s = this.worldToScreen(w.x, w.y, w.z);
      const dd = Math.hypot(s.x - this.mousePx.x, s.y - this.mousePx.y);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  initMenu() {
    const NS = "http://www.w3.org/2000/svg";

    if (!document.getElementById("dm-fonts")) {
      const l = document.createElement("link");
      l.id = "dm-fonts";
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500&family=Playfair+Display:wght@400;500;600&display=swap";
      document.head.appendChild(l);
    }

    if (!document.getElementById("dm-style")) {
      const s = document.createElement("style");
      s.id = "dm-style";
      s.textContent = `
      .dm-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0;opacity:0;transition:opacity .2s ease;}
      .dm-svg.show{opacity:1;}
      .dm-stem{fill:none;stroke:#654618;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 2px rgba(0,0,0,.25));}
      .dm-box{position:absolute;z-index:3;width:300px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;
        background:#fff5da;border:3px solid #654618;border-radius:20px;
        box-shadow:4px 8px 6px rgba(0,0,0,.22);padding:16px 24px 24px;opacity:0;pointer-events:auto;will-change:transform,opacity;}
      .dm-actions{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:9px;margin-bottom:6px;min-height:20px;}
      .dm-actions button{border:none;background:none;cursor:pointer;padding:0;color:#654618;line-height:0;display:flex;}
      .dm-actions button:hover{opacity:.55;}
      .dm-edit svg,.dm-delete svg{width:16px;height:16px;display:block;}
      .dm-edit,.dm-delete{display:none;}
      .dm-box.own .dm-edit,.dm-box.own .dm-delete{display:flex;}
      .dm-close{font-size:20px;line-height:1;font-family:sans-serif;color:#654618;}
      .dm-title{flex:0 0 auto;font-family:"Playfair Display",Georgia,serif;font-weight:500;font-size:18px;line-height:1.28;color:#000;margin:0 0 10px;}
      .dm-rule{flex:0 0 auto;width:26px;height:2px;background:#000;margin:0 0 12px;}
      .dm-body{flex:1 1 auto;min-height:0;font-family:"Montserrat","Helvetica Neue",sans-serif;font-weight:400;font-size:13.5px;line-height:1.45;color:#111;
        overflow-y:auto;}
      `;
      document.head.appendChild(s);
    }

    // Lift the dots canvas above the connector SVG so the L draws UNDER the dots
    // (the hovered dot sits on top of where the line meets it).
    this.renderer.domElement.style.position = "relative";
    this.renderer.domElement.style.zIndex = "1";

    this.menuSvg = document.createElementNS(NS, "svg");
    this.menuSvg.setAttribute("class", "dm-svg");
    this.menuStem = document.createElementNS(NS, "path");
    this.menuStem.setAttribute("class", "dm-stem");
    this.menuSvg.appendChild(this.menuStem);
    this.container.appendChild(this.menuSvg);

    const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    const trash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 10.5v6M14 10.5v6"/></svg>';

    this.menuBox = document.createElement("div");
    this.menuBox.className = "dm-box";
    this.menuBox.innerHTML =
      '<div class="dm-actions">' +
      '<button class="dm-edit" aria-label="Edit" title="Edit your response">' + pencil + '</button>' +
      '<button class="dm-delete" aria-label="Delete" title="Delete your response">' + trash + '</button>' +
      '<button class="dm-close" aria-label="Close">×</button>' +
      '</div>' +
      '<h3 class="dm-title"></h3><div class="dm-rule"></div><div class="dm-body"></div>';
    this.container.appendChild(this.menuBox);
    this.menuTitle = this.menuBox.querySelector(".dm-title");
    this.menuBodyEl = this.menuBox.querySelector(".dm-body");

    // While the cursor is over the box (e.g. reaching for edit/delete), don't let
    // dots underneath it hijack the menu.
    this.overMenu = false;
    this.menuBox.addEventListener("mouseenter", () => { this.overMenu = true; });
    this.menuBox.addEventListener("mouseleave", () => { this.overMenu = false; });

    this.menuBox.querySelector(".dm-close").addEventListener("click", (e) => {
      e.stopPropagation();
      this.unlockMenu();
    });
    this.menuBox.querySelector(".dm-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._editUrl) window.location.href = this._editUrl;
    });
    this.menuBox.querySelector(".dm-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._deleteUrl && this.deleteConfirm) this.deleteConfirm.classList.add("open");
    });

    // Overlays that should freeze dot-hover while open (help + delete confirm).
    this.helpPanel = document.getElementById("help-panel");
    // Delete-confirmation popup (lives in the Django template).
    this.deleteForm = document.getElementById("delete-form");
    this.deleteConfirm = document.getElementById("delete-confirm");
    if (this.deleteConfirm) {
      const yes = document.getElementById("confirm-yes");
      const no = document.getElementById("confirm-no");
      const hide = () => this.deleteConfirm.classList.remove("open");
      if (yes) yes.addEventListener("click", () => {
        if (this._deleteUrl && this.deleteForm) {
          this.deleteForm.action = this._deleteUrl;
          this.deleteForm.submit();
        }
      });
      if (no) no.addEventListener("click", hide);
      this.deleteConfirm.addEventListener("click", (e) => {
        if (e.target === this.deleteConfirm) hide();
      });
    }

    // Track the cursor in container pixels for hover detection.
    window.addEventListener("mousemove", (e) => {
      const r = this.container.getBoundingClientRect();
      this.mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
    });

    // Click on empty space (the canvas) or Escape closes the locked menu.
    this.renderer.domElement.addEventListener("click", () => {
      if (this.hoverIndex >= 0) this.unlockMenu();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.unlockMenu();
    });
  }

  lockTo(i) {
    this.hoverIndex = i;
    this.material.uniforms.uHoverIndex.value = i; // dot grows + glows
    this.hoverActivateAt = performance.now() + this.HOVER_DELAY; // delay the growth
    this.hoverAmt = 0; // grow in fresh from nothing
    const info = this.answerInfo[i];
    this.menuTitle.textContent = info.title;
    this.menuBodyEl.textContent = info.body;

    // Own answers get the pencil/trash controls (edit + delete URLs from the DB).
    const own = !!info.own;
    this.menuBox.classList.toggle("own", own);
    this._editUrl = own ? info.editUrl : null;
    this._deleteUrl = own ? info.deleteUrl : null;

    // Tint the border + stem with a bolder version of the question color.
    const c = info.color;
    const bold = `rgb(${(c[0] * 0.6 * 255) | 0},${(c[1] * 0.6 * 255) | 0},${(c[2] * 0.6 * 255) | 0})`;
    this.menuBox.style.borderColor = bold;
    this.menuStem.style.stroke = bold;

    this.boxPos = null; // reset easing; snaps into place on first update
    this.appearStart = performance.now(); // (re)start the appear animation
    this.menuBox.style.transition = "none"; // per-frame JS drives transform/opacity
    this.menuBox.style.pointerEvents = "auto"; // interactive while open
    this.updateMenu();
    this.menuSvg.classList.add("show");
  }

  unlockMenu() {
    if (this.hoverIndex < 0) return;
    this.hoverIndex = -1;
    // Leave uHoverIndex pointing at the dot so its growth can ease back out
    // (uHoverAmt eases to 0 in the render loop).
    this.menuSvg.classList.remove("show");
    // updateMenu stops running now, so fade the box out with a quick transition.
    this.menuBox.style.transition = "opacity .18s ease, transform .18s ease";
    this.menuBox.style.opacity = "0";
    // Actually make it inert: no pointer/hover/text-selection on the hidden box.
    this.menuBox.style.pointerEvents = "none";
    this.overMenu = false;
  }

  updateMenu() {
    const i = this.hoverIndex;
    const w = this.dotWorld(i);
    const s = this.worldToScreen(w.x, w.y, w.z); // dot on screen

    const GAP = 70, PAD = 14;

    // Dynamic sizing: never let the box exceed the viewport. It's a flex column
    // that clips to this max size (the body scrolls), so the measured BW/BH below
    // stay within bounds and the position clamp keeps it fully on-screen.
    this.menuBox.style.maxWidth = (this.width - 2 * PAD) + "px";
    this.menuBox.style.maxHeight = (this.height - 2 * PAD) + "px";

    const BW = this.menuBox.offsetWidth || 300;
    const BH = this.menuBox.offsetHeight || 260;

    // Bias the box toward the nearer screen edge so it juts away from the center
    // glyph: a dot on the left half opens left, a dot on the right half opens right.
    const placeLeft = s.x < this.width * 0.5;
    let bx = placeLeft ? s.x - GAP - BW : s.x + GAP;
    let by = s.y - BH * 0.4;
    bx = Math.max(PAD, Math.min(this.width - BW - PAD, bx));
    by = Math.max(PAD, Math.min(this.height - BH - PAD, by));

    // Ease the box toward its target so it follows the drifting dot smoothly.
    if (!this.boxPos) this.boxPos = { x: bx, y: by };
    else {
      this.boxPos.x += (bx - this.boxPos.x) * 0.15;
      this.boxPos.y += (by - this.boxPos.y) * 0.15;
    }
    this.menuBox.style.left = this.boxPos.x + "px";
    this.menuBox.style.top = this.boxPos.y + "px";

    // L-shaped connector: a short vertical stub off the dot, then a long
    // horizontal run into the near edge of the box.
    const edgeX = placeLeft ? this.boxPos.x + BW : this.boxPos.x;
    const boxTop = this.boxPos.y, boxBottom = this.boxPos.y + BH;
    const dirY = (this.boxPos.y + BH / 2) >= s.y ? 1 : -1;
    // Stub must be longer than the hovered dot's radius (~30px) so it clears the
    // dot now that the L draws underneath it — otherwise it hides behind the dot.
    let cornerY = s.y + dirY * 46;                                 // short stub length
    cornerY = Math.max(boxTop + 18, Math.min(boxBottom - 18, cornerY));
    const P0 = [s.x, s.y];        // dot (short end)
    const P1 = [s.x, cornerY];    // corner
    const P2 = [edgeX, cornerY];  // box edge (long end)

    // ---- Appear timeline: draw the L first, then pop the box open. ----
    const elapsed = performance.now() - this.appearStart;
    const lineT = easeOutCubic(Math.min(1, elapsed / this.LINE_DUR));
    const boxRaw = Math.min(1, Math.max(0, (elapsed - this.LINE_DUR) / this.BOX_DUR));
    const boxT = easeOutBack(boxRaw);

    // Draw the L progressively along its length (from the dot outward).
    const seg1 = Math.abs(P1[1] - P0[1]);
    const seg2 = Math.abs(P2[0] - P1[0]);
    const draw = lineT * (seg1 + seg2);
    let d;
    if (draw <= seg1) {
      const t = seg1 > 0 ? draw / seg1 : 1;
      d = `M ${P0[0]} ${P0[1]} L ${P0[0]} ${P0[1] + (P1[1] - P0[1]) * t}`;
    } else {
      const t = seg2 > 0 ? (draw - seg1) / seg2 : 1;
      d = `M ${P0[0]} ${P0[1]} L ${P1[0]} ${P1[1]} L ${P1[0] + (P2[0] - P1[0]) * t} ${P1[1]}`;
    }
    this.menuStem.setAttribute("d", d);

    // Box scales up through its Y axis (scaleX stays 1) with an elastic bounce,
    // growing out of the L's horizontal line where it meets the box edge.
    this.menuBox.style.transformOrigin = `${placeLeft ? "right" : "left"} ${cornerY - this.boxPos.y}px`;
    this.menuBox.style.transform = `scaleY(${boxT})`;
    this.menuBox.style.opacity = boxRaw > 0 ? "1" : "0";
  }
}

// Instantiated by an entry file (js/main-dots.js in the sandbox, js/index-page.js
// in Django) so the mount container can differ per page.
