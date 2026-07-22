import * as THREE from "three";
import load from "load-asset";
import gardenVertex from "./shader/gardenVertex.glsl";
import gardenFragment from "./shader/gardenFragment.glsl";
import gardenUrl from "../img/vineyard.jpg";

/*
 * "Le Chemin de Reims"-style watercolor background.
 *
 * The image is exploded into ~thousands of soft, varied-size color circles that
 * sit in 3D (depth from the image's vertical axis, so the scene recedes) and
 * gently flow like a river while fading in and out. A mouse-follow camera adds
 * parallax. No GPGPU: the motion is a pure function of (home position, time),
 * so it's all computed directly in the vertex shader.
 */
export default class Garden {
  constructor(options) {
    this.container = options.dom;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0xfff5da, 1); // cream, matching the site
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, this.width / this.height, 0.01, 100);
    this.baseCam = new THREE.Vector3(0, 0, 3.2);
    this.camera.position.copy(this.baseCam);
    this.camera.lookAt(0, 0, 0);

    // Plane the vineyard painting is laid out on (16:9, like the source image).
    this.PLANE_W = 9.5; // wide enough to fill past the left/right corners
    this.PLANE_H = this.PLANE_W * 9 / 16;
    this.DEPTH = 2.2; // front-to-back spread -> parallax (bottom = nearer)
    this.LOWER = 0.35; // how far the whole field sits below center
    // Central open ellipse (in image UV) kept clear so the answer-dots breathe.
    this.OPEN_CX = 0.5; this.OPEN_CY = 0.46;
    this.OPEN_RX = 0.26; this.OPEN_RY = 0.34;

    this.mouse = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0 plane
    this.mouseWorld = new THREE.Vector3(999, 999, 0); // off-screen until it moves
    this.time = 0;
    this.isPlaying = true;

    // Screensaver: eased camera dolly + a one-shot particle "burst" that decays.
    this.baseZ = this.baseCam.z;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.burst = 0;

    this.init();
  }

  async init() {
    await this.addParticles();
    this.setupEvents();
    this.resize();
    this.render();
  }

  async addParticles() {
    const image = await load(gardenUrl);

    // Sample the vineyard painting on a fine grid — one particle per sampled pixel.
    const SAMPLE_W = 230;
    const SAMPLE_H = Math.round(SAMPLE_W * (image.height / image.width));
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, SAMPLE_W, SAMPLE_H);
    const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

    // Collect kept particles into growable arrays (we skip the cream background
    // and the central open zone, so the count isn't known up front).
    const positions = [], colors = [], sizes = [], seeds = [], edges = [];

    const jitterX = this.PLANE_W / SAMPLE_W;
    const jitterY = this.PLANE_H / SAMPLE_H;

    for (let y = 0; y < SAMPLE_H; y++) {
      for (let x = 0; x < SAMPLE_W; x++) {
        const idx = (y * SAMPLE_W + x) * 4;

        const u = x / (SAMPLE_W - 1);
        const v = y / (SAMPLE_H - 1);

        let cr = data[idx] / 255, cg = data[idx + 1] / 255, cb = data[idx + 2] / 255;
        const mx = Math.max(cr, cg, cb), mn = Math.min(cr, cg, cb);
        const sat = mx > 0 ? (mx - mn) / mx : 0;

        // Skip the cream/near-white background (bright + low saturation) and any
        // near-black outlines/text — keep only the colorful foliage & grapes.
        if ((mx > 0.82 && sat < 0.14) || mx < 0.12) continue;

        // Keep the central ellipse clear so the answer-dots have room to breathe.
        const nx = (u - this.OPEN_CX) / this.OPEN_RX;
        const ny = (v - this.OPEN_CY) / this.OPEN_RY;
        if (nx * nx + ny * ny < 1.0) continue;

        // Lay the painting flat on the plane (flip Y: canvas is top-down), with a
        // little depth from the vertical axis so the bottom reads as foreground.
        const px = (u - 0.5) * this.PLANE_W + (Math.random() - 0.5) * jitterX;
        const py = (0.5 - v) * this.PLANE_H + (Math.random() - 0.5) * jitterY - this.LOWER;
        const pz = (v - 0.5) * this.DEPTH + (Math.random() - 0.5) * 0.2;

        positions.push(px, py, pz);

        // Keep the painting's own colors — just boost saturation a touch and lift
        // the darkest shadows so it stays vivid and watercolor-bright.
        const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        const S = 2; // saturation boost
        cr = lum + (cr - lum) * S; cg = lum + (cg - lum) * S; cb = lum + (cb - lum) * S;
        const lift = 0.08;
        cr = Math.min(1, lift + cr * (1 - lift));
        cg = Math.min(1, lift + cg * (1 - lift));
        cb = Math.min(1, lift + cb * (1 - lift));
        colors.push(Math.max(0, cr), Math.max(0, cg), Math.max(0, cb));

        // Slightly bigger toward the foreground (bottom) and a bit of variety.
        sizes.push((0.5 + Math.random() * 0.9) * (0.6 + v * 0.7));
        seeds.push(Math.random());

        // Rim particles (near the outer image border) reveal when the mouse is near.
        const gu = Math.abs(u - 0.5) * 2, gv = Math.abs(v - 0.5) * 2;
        edges.push(Math.min(1, Math.max(0, (Math.max(gu, gv) - 0.7) / 0.3)));
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(sizes), 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geo.setAttribute("aEdge", new THREE.BufferAttribute(new Float32Array(edges), 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        uSpeed: { value: 0.025 },
        uCurlAmp: { value: 0.06 },
        uFlowDist: { value: 0.35 },
        uSize: { value: 40 }, // <-- global garden-dot size knob (tune me)
        uFlowDir: { value: new THREE.Vector3(1.0, 0.1, 0.0).normalize() },
        uMouse: { value: new THREE.Vector3(999, 999, 0) },
        uRevealRadius: { value: 1.3 }, // how large the mouse's reveal area is
        uBurst: { value: 0 }, // screensaver scatter kick (0..1, decays)
      },
      vertexShader: gardenVertex,
      fragmentShader: gardenFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.scene.add(this.points);
  }

  setupEvents() {
    window.addEventListener("resize", this.resize.bind(this));
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = (e.clientX / this.width) * 2 - 1;
      this.mouse.y = -((e.clientY / this.height) * 2 - 1);
    });
  }

  resize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.isPlaying) return;
    this.time += 0.016;
    this.material.uniforms.time.value = this.time;

    // Screensaver: ease the zoom dolly and decay the one-shot particle burst.
    this.zoom += (this.zoomTarget - this.zoom) * 0.05;
    this.burst += (0 - this.burst) * 0.03;
    this.material.uniforms.uBurst.value = this.burst;

    // Project the mouse onto the z=0 plane so the shader can reveal nearby edges.
    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (this.raycaster.ray.intersectPlane(this.planeZ, this.mouseWorld)) {
      this.material.uniforms.uMouse.value.copy(this.mouseWorld);
    }

    // Parallax: ease the camera a little toward the mouse, keep looking at center.
    const targetX = this.mouse.x * 0.4;
    const targetY = this.baseCam.y + this.mouse.y * 0.3;
    this.camera.position.x += (targetX - this.camera.position.x) * 0.05;
    this.camera.position.y += (targetY - this.camera.position.y) * 0.05;
    const targetZ = this.baseZ / this.zoom;
    this.camera.position.z += (targetZ - this.camera.position.z) * 0.05;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render.bind(this));
  }

  // ---- Screensaver hooks ---------------------------------------------------
  setZoom(z) { this.zoomTarget = z; }
  triggerBurst() { this.burst = 1; } // spikes, then decays in render()
}

// Instantiated by an entry file (js/main-garden.js in the sandbox,
// js/index-page.js in Django) so the mount container can differ per page.
