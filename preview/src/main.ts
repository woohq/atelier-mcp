import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { initUI, updateUI } from "./ui.js";

// --- Three.js Setup ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: true,
});
const isHeadless = new URLSearchParams(location.search).get("mode") === "headless";

renderer.setSize(1024, 1024);
renderer.setPixelRatio(1);
let currentBgColor = 0xffffff;
let currentBgAlpha = 1;
renderer.setClearColor(currentBgColor, currentBgAlpha);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(5, 5, 5);
camera.lookAt(0, 0, 0);

// OrbitControls for user browser only
let controls: OrbitControls | null = null;
if (!isHeadless) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);
}

// Default lighting
const ambientLight = new THREE.AmbientLight(0x404040, 1);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Grid helper for orientation
const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
scene.add(grid);

// --- Post-Processing Setup ---
const composerTarget = new THREE.WebGLRenderTarget(1024, 1024, {
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
});
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// OutputPass converts linear color space to sRGB for display.
// Must always be the last pass in the chain.
const outputPass = new OutputPass();
composer.addPass(outputPass);

// In user browser mode, fill viewport and handle resize
if (!isHeadless) {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  composer.setSize(window.innerWidth, window.innerHeight);

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    composer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Track ShaderPasses by effect ID
const effectPasses = new Map<string, ShaderPass>();

/**
 * Insert an effect pass before the OutputPass so OutputPass always remains last.
 */
function addEffectPass(pass: ShaderPass): void {
  composer.removePass(outputPass);
  composer.addPass(pass);
  composer.addPass(outputPass);
}

// Object registry — maps IDs to Three.js objects
const objects = new Map<string, THREE.Object3D>();

// Skeleton registry — maps skeleton IDs to { root: THREE.Bone, bones: Map }
const skeletonRoots = new Map<string, { root: THREE.Bone; bones: Map<string, THREE.Bone> }>();

// Animation mixer registry — maps objectId to THREE.AnimationMixer
const mixers = new Map<string, THREE.AnimationMixer>();

// Animation clip registry — maps clipId to THREE.AnimationClip
const clipStore = new Map<string, THREE.AnimationClip>();

// Clock for mixer updates
const clock = new THREE.Clock();

// Render mode
let renderMode: "3d" | "2d" | "composite" = "3d";

// 2D canvas layer
let canvas2d: OffscreenCanvas | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;

// Layer system
interface Layer {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  name: string;
  opacity: number;
  blendMode: string;
}

const layers: Layer[] = [];
let activeLayerIndex = -1; // -1 means draw to base canvas2d

/** Get the active drawing context — active layer's ctx, or base ctx2d. */
function getActiveCtx(): OffscreenCanvasRenderingContext2D {
  if (activeLayerIndex >= 0 && activeLayerIndex < layers.length) {
    return layers[activeLayerIndex].ctx;
  }
  if (!ctx2d) throw new Error("No 2D canvas. Call createCanvas first.");
  return ctx2d;
}

/** Parse a CSS color string to RGBA values (0-255). Uses a scratch canvas. */
const colorParseCanvas = new OffscreenCanvas(1, 1);
const colorParseCtx = colorParseCanvas.getContext("2d")!;

function parseColor(color: string): [number, number, number, number] {
  colorParseCtx.clearRect(0, 0, 1, 1);
  colorParseCtx.fillStyle = color;
  colorParseCtx.fillRect(0, 0, 1, 1);
  const d = colorParseCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function colorsMatch(
  r1: number,
  g1: number,
  b1: number,
  a1: number,
  r2: number,
  g2: number,
  b2: number,
  a2: number,
  tolerance: number,
): boolean {
  return (
    Math.abs(r1 - r2) <= tolerance &&
    Math.abs(g1 - g2) <= tolerance &&
    Math.abs(b1 - b2) <= tolerance &&
    Math.abs(a1 - a2) <= tolerance
  );
}

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  for (const mixer of mixers.values()) {
    mixer.update(delta);
  }
  controls?.update();
  composer.render();
}
animate();

// --- Geometry Factories ---
function createGeometry(shape: string, params: Record<string, any>): THREE.BufferGeometry {
  switch (shape) {
    case "box":
      return new THREE.BoxGeometry(params.width ?? 1, params.height ?? 1, params.depth ?? 1);
    case "sphere":
      return new THREE.SphereGeometry(
        params.radius ?? 0.5,
        params.widthSegments ?? 32,
        params.heightSegments ?? 16,
      );
    case "cylinder":
      return new THREE.CylinderGeometry(
        params.radiusTop ?? 0.5,
        params.radiusBottom ?? 0.5,
        params.height ?? 1,
        params.radialSegments ?? 32,
      );
    case "cone":
      return new THREE.ConeGeometry(
        params.radius ?? 0.5,
        params.height ?? 1,
        params.radialSegments ?? 32,
      );
    case "torus":
      return new THREE.TorusGeometry(
        params.radius ?? 0.5,
        params.tube ?? 0.2,
        params.radialSegments ?? 16,
        params.tubularSegments ?? 48,
      );
    case "plane":
      return new THREE.PlaneGeometry(params.width ?? 1, params.height ?? 1);
    default:
      throw new Error(`Unknown shape: ${shape}`);
  }
}

// --- Post-Process Shader Definitions ---
function buildPostProcessShader(type: string, params: Record<string, any>): any {
  const currentResolution = renderer.getSize(new THREE.Vector2());

  const defaultVertex = [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");

  switch (type) {
    case "pixelate":
      return {
        uniforms: {
          tDiffuse: { value: null },
          resolution: { value: currentResolution.clone() },
          pixelSize: { value: params.pixelSize ?? 4.0 },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform vec2 resolution;",
          "uniform float pixelSize;",
          "varying vec2 vUv;",
          "void main() {",
          "  vec2 dxy = pixelSize / resolution;",
          "  vec2 coord = dxy * floor(vUv / dxy);",
          "  gl_FragColor = texture2D(tDiffuse, coord);",
          "}",
        ].join("\n"),
      };

    case "cel_shade":
      return {
        uniforms: {
          tDiffuse: { value: null },
          steps: { value: params.steps ?? 4.0 },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform float steps;",
          "varying vec2 vUv;",
          "void main() {",
          "  vec4 color = texture2D(tDiffuse, vUv);",
          "  color.rgb = floor(color.rgb * steps + 0.5) / steps;",
          "  gl_FragColor = color;",
          "}",
        ].join("\n"),
      };

    case "dither":
      return {
        uniforms: {
          tDiffuse: { value: null },
          strength: { value: params.strength ?? 0.5 },
          matrixSize: { value: params.matrixSize ?? 4.0 },
          resolution: { value: currentResolution.clone() },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform float strength;",
          "uniform float matrixSize;",
          "uniform vec2 resolution;",
          "varying vec2 vUv;",
          "",
          "float bayer2(vec2 a) {",
          "  a = floor(a);",
          "  return fract(a.x / 2.0 + a.y * a.y * 0.75);",
          "}",
          "",
          "float bayer(vec2 a, float size) {",
          "  float r = 0.0;",
          "  for (float i = 1.0; i <= 4.0; i += 1.0) {",
          "    if (i > size) break;",
          "    r += bayer2(a / exp2(i)) / exp2(i);",
          "  }",
          "  return r;",
          "}",
          "",
          "void main() {",
          "  vec4 color = texture2D(tDiffuse, vUv);",
          "  vec2 pixelCoord = vUv * resolution;",
          "  float threshold = bayer(pixelCoord, matrixSize);",
          "  color.rgb += (threshold - 0.5) * strength;",
          "  color.rgb = clamp(color.rgb, 0.0, 1.0);",
          "  gl_FragColor = color;",
          "}",
        ].join("\n"),
      };

    case "palette_quantize": {
      const palette: number[][] = params.palette ?? [
        [0, 0, 0],
        [1, 1, 1],
      ];
      const paletteSize = params.paletteSize ?? palette.length;
      // Build palette uniform as flat vec3 array
      const flatPalette: number[] = [];
      for (let i = 0; i < 16; i++) {
        if (i < palette.length) {
          flatPalette.push(palette[i][0], palette[i][1], palette[i][2]);
        } else {
          flatPalette.push(0, 0, 0);
        }
      }
      return {
        uniforms: {
          tDiffuse: { value: null },
          palette: { value: flatPalette },
          paletteSize: { value: paletteSize },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform vec3 palette[16];",
          "uniform int paletteSize;",
          "varying vec2 vUv;",
          "void main() {",
          "  vec4 color = texture2D(tDiffuse, vUv);",
          "  float bestDist = 99999.0;",
          "  vec3 bestColor = palette[0];",
          "  for (int i = 0; i < 16; i++) {",
          "    if (i >= paletteSize) break;",
          "    float d = distance(color.rgb, palette[i]);",
          "    if (d < bestDist) {",
          "      bestDist = d;",
          "      bestColor = palette[i];",
          "    }",
          "  }",
          "  gl_FragColor = vec4(bestColor, color.a);",
          "}",
        ].join("\n"),
      };
    }

    case "outline":
      return {
        uniforms: {
          tDiffuse: { value: null },
          resolution: { value: currentResolution.clone() },
          thickness: { value: params.thickness ?? 1.0 },
          threshold: { value: params.threshold ?? 0.1 },
          sensitivity: { value: params.sensitivity ?? 1.0 },
          outlineColor: {
            value: new THREE.Vector3(...(params.color ?? [0, 0, 0])),
          },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform vec2 resolution;",
          "uniform float thickness;",
          "uniform float threshold;",
          "uniform float sensitivity;",
          "uniform vec3 outlineColor;",
          "varying vec2 vUv;",
          "",
          "float luminance(vec3 c) {",
          "  return dot(c, vec3(0.299, 0.587, 0.114));",
          "}",
          "",
          "void main() {",
          "  vec2 texel = thickness / resolution;",
          "  float tl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y)).rgb);",
          "  float t  = luminance(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb);",
          "  float tr = luminance(texture2D(tDiffuse, vUv + vec2(texel.x, texel.y)).rgb);",
          "  float l  = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb);",
          "  float r  = luminance(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb);",
          "  float bl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb);",
          "  float b  = luminance(texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb);",
          "  float br = luminance(texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y)).rgb);",
          "  float gx = tl + 2.0*l + bl - tr - 2.0*r - br;",
          "  float gy = tl + 2.0*t + tr - bl - 2.0*b - br;",
          "  float edge = sqrt(gx*gx + gy*gy);",
          "  float edgeMask = smoothstep(threshold * 0.5, threshold, edge * sensitivity);",
          "  vec4 color = texture2D(tDiffuse, vUv);",
          "  color.rgb = mix(color.rgb, outlineColor, edgeMask);",
          "  gl_FragColor = color;",
          "}",
        ].join("\n"),
      };

    default:
      throw new Error(`Unknown post-process effect type: ${type}`);
  }
}

// --- Seeded RNG (browser-side) ---
function seededRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Value Noise (browser-side) ---
function valueNoise2D(x: number, y: number, seed: number): number {
  function hash(ix: number, iy: number): number {
    let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h = h ^ (h >>> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
  }
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smooth interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash(ix, iy);
  const v10 = hash(ix + 1, iy);
  const v01 = hash(ix, iy + 1);
  const v11 = hash(ix + 1, iy + 1);
  const a = v00 + sx * (v10 - v00);
  const b = v01 + sx * (v11 - v01);
  return a + sy * (b - a);
}

function fbmNoise2D(
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  persistence: number,
  seed: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

function noise3D(x: number, y: number, z: number, seed: number): number {
  function hash3(ix: number, iy: number, iz: number): number {
    let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 73856093) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h = h ^ (h >>> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
  }
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const v000 = hash3(ix, iy, iz),
    v100 = hash3(ix + 1, iy, iz);
  const v010 = hash3(ix, iy + 1, iz),
    v110 = hash3(ix + 1, iy + 1, iz);
  const v001 = hash3(ix, iy, iz + 1),
    v101 = hash3(ix + 1, iy, iz + 1);
  const v011 = hash3(ix, iy + 1, iz + 1),
    v111 = hash3(ix + 1, iy + 1, iz + 1);
  const a00 = v000 + sx * (v100 - v000);
  const a10 = v010 + sx * (v110 - v010);
  const a01 = v001 + sx * (v101 - v001);
  const a11 = v011 + sx * (v111 - v011);
  const b0 = a00 + sy * (a10 - a00);
  const b1 = a01 + sy * (a11 - a01);
  return b0 + sz * (b1 - b0);
}

// --- Command Handlers ---
type CommandHandler = (params: Record<string, any>) => any;

const commands: Record<string, CommandHandler> = {
  // Scene management
  createPrimitive(params) {
    const geometry = createGeometry(params.shape, params);
    const material = new THREE.MeshStandardMaterial({
      color: params.color ?? 0xcccccc,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = params.id;

    if (params.position) {
      mesh.position.set(params.position[0], params.position[1], params.position[2]);
    }
    if (params.rotation) {
      mesh.rotation.set(params.rotation[0], params.rotation[1], params.rotation[2]);
    }
    if (params.scale) {
      mesh.scale.set(params.scale[0], params.scale[1], params.scale[2]);
    }

    // Add to parent group or scene root
    if (params.parentId && objects.has(params.parentId)) {
      objects.get(params.parentId)!.add(mesh);
    } else {
      scene.add(mesh);
    }

    objects.set(params.id, mesh);
    return { id: params.id };
  },

  createMesh(params) {
    const geometry = new THREE.BufferGeometry();

    const vertices = new Float32Array(params.vertices);
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    if (params.faces) {
      geometry.setIndex(params.faces);
    }
    if (params.uvs) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(params.uvs), 2));
    }
    if (params.normals) {
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(params.normals), 3),
      );
    } else {
      geometry.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({ color: params.color ?? 0xcccccc });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = params.id;

    if (params.position) {
      mesh.position.set(params.position[0], params.position[1], params.position[2]);
    }

    if (params.parentId && objects.has(params.parentId)) {
      objects.get(params.parentId)!.add(mesh);
    } else {
      scene.add(mesh);
    }

    objects.set(params.id, mesh);
    return { id: params.id };
  },

  createGroup(params) {
    const group = new THREE.Group();
    group.name = params.id;

    if (params.parentId && objects.has(params.parentId)) {
      objects.get(params.parentId)!.add(group);
    } else {
      scene.add(group);
    }

    objects.set(params.id, group);
    return { id: params.id };
  },

  addToGroup(params) {
    const group = objects.get(params.groupId);
    const obj = objects.get(params.objectId);
    if (!group || !obj) throw new Error("Object not found");
    group.add(obj);
    return { ok: true };
  },

  transform(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);

    if (params.position) {
      obj.position.set(params.position[0], params.position[1], params.position[2]);
    }
    if (params.rotation) {
      obj.rotation.set(params.rotation[0], params.rotation[1], params.rotation[2]);
    }
    if (params.scale) {
      obj.scale.set(params.scale[0], params.scale[1], params.scale[2]);
    }
    return { ok: true };
  },

  setMaterial(params) {
    const obj = objects.get(params.objectId);
    if (!obj || !(obj instanceof THREE.Mesh)) throw new Error("Mesh not found");

    const matParams: any = {};
    if (params.color !== undefined) matParams.color = params.color;
    if (params.metalness !== undefined) matParams.metalness = params.metalness;
    if (params.roughness !== undefined) matParams.roughness = params.roughness;
    if (params.emissive !== undefined) matParams.emissive = params.emissive;
    if (params.emissiveIntensity !== undefined)
      matParams.emissiveIntensity = params.emissiveIntensity;
    if (params.opacity !== undefined) {
      matParams.opacity = params.opacity;
      matParams.transparent = params.opacity < 1;
    }
    if (params.wireframe !== undefined) matParams.wireframe = params.wireframe;
    if (params.flatShading !== undefined) matParams.flatShading = params.flatShading;

    obj.material = new THREE.MeshStandardMaterial(matParams);
    return { ok: true };
  },

  setCamera(params) {
    if (params.preset) {
      const presets: Record<string, { position: number[]; lookAt: number[] }> = {
        front: { position: [0, 2, 8], lookAt: [0, 0, 0] },
        three_quarter: { position: [5, 5, 5], lookAt: [0, 0, 0] },
        top_down: { position: [0, 10, 0.01], lookAt: [0, 0, 0] },
        isometric: { position: [7, 7, 7], lookAt: [0, 0, 0] },
        side: { position: [8, 2, 0], lookAt: [0, 0, 0] },
      };
      const p = presets[params.preset];
      if (p) {
        camera.position.set(p.position[0], p.position[1], p.position[2]);
        camera.lookAt(p.lookAt[0], p.lookAt[1], p.lookAt[2]);
      }
    }
    if (params.position) {
      camera.position.set(params.position[0], params.position[1], params.position[2]);
    }
    if (params.lookAt) {
      camera.lookAt(params.lookAt[0], params.lookAt[1], params.lookAt[2]);
    }
    if (params.fov) {
      camera.fov = params.fov;
      camera.updateProjectionMatrix();
    }
    // Sync OrbitControls target
    if (controls) {
      if (params.lookAt) {
        controls.target.set(params.lookAt[0], params.lookAt[1], params.lookAt[2]);
      } else if (params.preset) {
        controls.target.set(0, 0, 0);
      }
      controls.update();
    }
    return { ok: true };
  },

  setLight(params) {
    let light: THREE.Light;
    switch (params.type) {
      case "directional":
        light = new THREE.DirectionalLight(params.color ?? 0xffffff, params.intensity ?? 1);
        if (params.position) {
          light.position.set(params.position[0], params.position[1], params.position[2]);
        }
        break;
      case "ambient":
        light = new THREE.AmbientLight(params.color ?? 0x404040, params.intensity ?? 1);
        break;
      case "point":
        light = new THREE.PointLight(params.color ?? 0xffffff, params.intensity ?? 1);
        if (params.position) {
          light.position.set(params.position[0], params.position[1], params.position[2]);
        }
        break;
      default:
        throw new Error(`Unknown light type: ${params.type}`);
    }

    light.name = params.id;
    scene.add(light);
    objects.set(params.id, light);
    return { id: params.id };
  },

  booleanOp(params) {
    const target = objects.get(params.targetId);
    const tool = objects.get(params.toolId);
    if (!target || !(target instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.targetId}" not found`);
    if (!tool || !(tool instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.toolId}" not found`);

    const evaluator = new Evaluator();
    const brushA = new Brush(target.geometry.clone(), target.material as THREE.Material);
    brushA.position.copy(target.position);
    brushA.rotation.copy(target.rotation);
    brushA.scale.copy(target.scale);
    brushA.updateMatrixWorld(true);

    const brushB = new Brush(tool.geometry.clone(), tool.material as THREE.Material);
    brushB.position.copy(tool.position);
    brushB.rotation.copy(tool.rotation);
    brushB.scale.copy(tool.scale);
    brushB.updateMatrixWorld(true);

    let resultBrush: Brush;
    const op = params.operation;
    if (op === "subtract") {
      resultBrush = evaluator.evaluate(brushA, brushB, SUBTRACTION);
    } else if (op === "intersect") {
      resultBrush = evaluator.evaluate(brushA, brushB, INTERSECTION);
    } else {
      resultBrush = evaluator.evaluate(brushA, brushB, ADDITION);
    }

    const newGeo = resultBrush.geometry;
    newGeo.computeVertexNormals();
    target.geometry.dispose();
    target.geometry = newGeo;
    target.position.set(0, 0, 0);
    target.rotation.set(0, 0, 0);
    target.scale.set(1, 1, 1);

    tool.removeFromParent();
    if (tool.geometry) tool.geometry.dispose();
    if (tool.material instanceof THREE.Material) tool.material.dispose();
    objects.delete(params.toolId);

    return {
      targetId: params.targetId,
      operation: params.operation,
      vertexCount: newGeo.getAttribute("position").count,
    };
  },

  smoothMerge(params) {
    const objA = objects.get(params.objectIdA);
    const objB = objects.get(params.objectIdB);
    if (!objA || !(objA instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.objectIdA}" not found`);
    if (!objB || !(objB instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.objectIdB}" not found`);

    // Clone and apply world transforms
    const geoA = objA.geometry.clone();
    geoA.applyMatrix4(objA.matrixWorld);
    const geoB = objB.geometry.clone();
    geoB.applyMatrix4(objB.matrixWorld);

    // Merge geometries
    const merged = mergeGeometries([geoA, geoB], false);
    if (!merged) throw new Error("Failed to merge geometries");

    // Laplacian smoothing near intersection region
    const posAttr = merged.getAttribute("position");
    const smoothRadius = params.smoothRadius ?? 0.5;
    const iterations = params.iterations ?? 3;

    // Find vertices near the intersection (close to both meshes' bounding boxes overlap)
    const bbA = new THREE.Box3().setFromBufferAttribute(geoA.getAttribute("position"));
    const bbB = new THREE.Box3().setFromBufferAttribute(geoB.getAttribute("position"));
    const overlap = new THREE.Box3();
    overlap.copy(bbA).intersect(bbB);
    overlap.expandByScalar(smoothRadius);

    // Build adjacency
    if (!merged.index) {
      const idx: number[] = [];
      for (let i = 0; i < posAttr.count; i++) idx.push(i);
      merged.setIndex(idx);
    }
    const index = merged.index!;

    const neighbors: Set<number>[] = Array.from({ length: posAttr.count }, () => new Set());
    for (let t = 0; t < index.count / 3; t++) {
      const a = index.getX(t * 3),
        b = index.getX(t * 3 + 1),
        c = index.getX(t * 3 + 2);
      neighbors[a].add(b);
      neighbors[a].add(c);
      neighbors[b].add(a);
      neighbors[b].add(c);
      neighbors[c].add(a);
      neighbors[c].add(b);
    }

    // Identify vertices in the overlap zone
    const inZone: boolean[] = new Array(posAttr.count).fill(false);
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      if (overlap.containsPoint(v)) inZone[i] = true;
    }

    // Laplacian smooth only vertices in zone
    for (let iter = 0; iter < iterations; iter++) {
      const newPos = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        if (inZone[i] && neighbors[i].size > 0) {
          let sx = 0,
            sy = 0,
            sz = 0;
          for (const n of neighbors[i]) {
            sx += posAttr.getX(n);
            sy += posAttr.getY(n);
            sz += posAttr.getZ(n);
          }
          const count = neighbors[i].size;
          newPos[i * 3] = sx / count;
          newPos[i * 3 + 1] = sy / count;
          newPos[i * 3 + 2] = sz / count;
        } else {
          newPos[i * 3] = posAttr.getX(i);
          newPos[i * 3 + 1] = posAttr.getY(i);
          newPos[i * 3 + 2] = posAttr.getZ(i);
        }
      }
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(i, newPos[i * 3], newPos[i * 3 + 1], newPos[i * 3 + 2]);
      }
    }
    posAttr.needsUpdate = true;
    merged.computeVertexNormals();

    const material =
      objA.material instanceof THREE.Material
        ? objA.material.clone()
        : new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = params.newId;
    scene.add(mesh);
    objects.set(params.newId, mesh);

    // Remove originals if requested
    if (params.removeOriginals) {
      for (const oid of [params.objectIdA, params.objectIdB]) {
        const o = objects.get(oid);
        if (o) {
          o.removeFromParent();
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            if (o.material instanceof THREE.Material) o.material.dispose();
          }
          objects.delete(oid);
        }
      }
    }

    return { id: params.newId, vertexCount: posAttr.count };
  },

  smoothBoolean(params) {
    const objA = objects.get(params.objectIdA);
    const objB = objects.get(params.objectIdB);
    if (!objA || !(objA instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.objectIdA}" not found`);
    if (!objB || !(objB instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.objectIdB}" not found`);

    const resolution = Math.min(params.resolution ?? 32, 128);
    const smoothness = params.smoothness ?? 0.3;
    const operation = params.operation ?? "union";

    // Compute combined bounding box
    const bbA = new THREE.Box3().setFromObject(objA);
    const bbB = new THREE.Box3().setFromObject(objB);
    const bb = new THREE.Box3().copy(bbA).union(bbB);
    bb.expandByScalar(smoothness * 2);

    const size = new THREE.Vector3();
    bb.getSize(size);
    const step = Math.max(size.x, size.y, size.z) / resolution;

    const nx = Math.ceil(size.x / step) + 1;
    const ny = Math.ceil(size.y / step) + 1;
    const nz = Math.ceil(size.z / step) + 1;

    // Pre-compute simple distance field using bounding sphere approximation
    const centerA = new THREE.Vector3();
    bbA.getCenter(centerA);
    const centerB = new THREE.Vector3();
    bbB.getCenter(centerB);
    const sizeA = new THREE.Vector3();
    bbA.getSize(sizeA);
    const sizeB = new THREE.Vector3();
    bbB.getSize(sizeB);
    const radiusA = sizeA.length() / 2;
    const radiusB = sizeB.length() / 2;

    // Simple SDF approximation: signed distance to mesh surface
    function sdfSphere(
      p: THREE.Vector3,
      center: THREE.Vector3,
      radius: number,
    ): number {
      return p.distanceTo(center) - radius;
    }

    // Smooth min for union
    function smin(a: number, b: number, k: number): number {
      const h = Math.max(k - Math.abs(a - b), 0) / k;
      return Math.min(a, b) - h * h * k * 0.25;
    }

    // Evaluate SDF at grid points
    const field = new Float32Array(nx * ny * nz);
    const p = new THREE.Vector3();

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          p.set(
            bb.min.x + ix * step,
            bb.min.y + iy * step,
            bb.min.z + iz * step,
          );
          const dA = sdfSphere(p, centerA, radiusA);
          const dB = sdfSphere(p, centerB, radiusB);

          let d: number;
          if (operation === "union") d = smin(dA, dB, smoothness);
          else if (operation === "subtract")
            d = Math.max(dA, -smin(-dA, dB, smoothness));
          else d = smin(Math.max(dA, dB), Math.min(dA, dB), smoothness); // intersect

          field[iz * ny * nx + iy * nx + ix] = d;
        }
      }
    }

    // Marching cubes
    const sdfVertices: number[] = [];
    const sdfTriangles: number[] = [];

    function getField(ix: number, iy: number, iz: number): number {
      return field[iz * ny * nx + iy * nx + ix];
    }

    function interpVertex(
      x1: number, y1: number, z1: number, v1: number,
      x2: number, y2: number, z2: number, v2: number,
    ): number {
      if (Math.abs(v1) < 0.00001) {
        sdfVertices.push(x1, y1, z1);
        return sdfVertices.length / 3 - 1;
      }
      if (Math.abs(v2) < 0.00001) {
        sdfVertices.push(x2, y2, z2);
        return sdfVertices.length / 3 - 1;
      }
      const t = -v1 / (v2 - v1);
      sdfVertices.push(x1 + t * (x2 - x1), y1 + t * (y2 - y1), z1 + t * (z2 - z1));
      return sdfVertices.length / 3 - 1;
    }

    // Simplified marching cubes - process each cell
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let iy = 0; iy < ny - 1; iy++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          const x = bb.min.x + ix * step;
          const y = bb.min.y + iy * step;
          const z = bb.min.z + iz * step;

          const mcv = [
            getField(ix, iy, iz),
            getField(ix + 1, iy, iz),
            getField(ix + 1, iy + 1, iz),
            getField(ix, iy + 1, iz),
            getField(ix, iy, iz + 1),
            getField(ix + 1, iy, iz + 1),
            getField(ix + 1, iy + 1, iz + 1),
            getField(ix, iy + 1, iz + 1),
          ];

          // Determine inside/outside for each corner
          let cubeIndex = 0;
          for (let c = 0; c < 8; c++) {
            if (mcv[c] < 0) cubeIndex |= 1 << c;
          }
          if (cubeIndex === 0 || cubeIndex === 255) continue;

          const corners = [
            [x, y, z],
            [x + step, y, z],
            [x + step, y + step, z],
            [x, y + step, z],
            [x, y, z + step],
            [x + step, y, z + step],
            [x + step, y + step, z + step],
            [x, y + step, z + step],
          ];

          // Check each of 12 edges
          const edges: [number, number][] = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7],
          ];

          const edgeVerts: (number | null)[] = new Array(12).fill(null);
          for (let e = 0; e < 12; e++) {
            const [ea, eb] = edges[e];
            if (mcv[ea] < 0 !== mcv[eb] < 0) {
              edgeVerts[e] = interpVertex(
                corners[ea][0], corners[ea][1], corners[ea][2], mcv[ea],
                corners[eb][0], corners[eb][1], corners[eb][2], mcv[eb],
              );
            }
          }

          // Simple triangulation: connect edge vertices that form the isosurface
          const activeEdges = edgeVerts.filter((e): e is number => e !== null);
          if (activeEdges.length >= 3) {
            for (let t = 1; t < activeEdges.length - 1; t++) {
              sdfTriangles.push(activeEdges[0], activeEdges[t], activeEdges[t + 1]);
            }
          }
        }
      }
    }

    const sdfGeometry = new THREE.BufferGeometry();
    sdfGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(sdfVertices), 3),
    );
    sdfGeometry.setIndex(sdfTriangles);
    sdfGeometry.computeVertexNormals();

    const material =
      objA.material instanceof THREE.Material
        ? objA.material.clone()
        : new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const sdfMesh = new THREE.Mesh(sdfGeometry, material);
    sdfMesh.name = params.newId;
    scene.add(sdfMesh);
    objects.set(params.newId, sdfMesh);

    // Remove originals if requested
    if (params.removeOriginals) {
      for (const oid of [params.objectIdA, params.objectIdB]) {
        const o = objects.get(oid);
        if (o) {
          o.removeFromParent();
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            if (o.material instanceof THREE.Material) o.material.dispose();
          }
          objects.delete(oid);
        }
      }
    }

    return {
      id: params.newId,
      vertexCount: sdfVertices.length / 3,
      faceCount: sdfTriangles.length / 3,
      resolution,
    };
  },

  extrude(params) {
    const shape = new THREE.Shape();
    const pts: [number, number][] = params.points;
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i][0], pts[i][1]);
    }
    shape.closePath();

    const extrudeSettings = {
      depth: params.depth ?? 1,
      bevelEnabled: false,
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const material = new THREE.MeshStandardMaterial({ color: params.color ?? 0xcccccc });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = params.id;

    if (params.position) {
      mesh.position.set(params.position[0], params.position[1], params.position[2]);
    }

    scene.add(mesh);
    objects.set(params.id, mesh);
    return { id: params.id };
  },

  extrudeAlongPath(params) {
    // 2D profile points
    const profilePts: [number, number][] = params.profile;
    const shape = new THREE.Shape();
    shape.moveTo(profilePts[0][0], profilePts[0][1]);
    for (let i = 1; i < profilePts.length; i++) {
      shape.lineTo(profilePts[i][0], profilePts[i][1]);
    }
    shape.closePath();

    // 3D path points
    const pathPoints = (params.path as number[][]).map(
      (pt: number[]) => new THREE.Vector3(pt[0], pt[1], pt[2]),
    );
    const curve = new THREE.CatmullRomCurve3(pathPoints, params.closed ?? false);

    const segments = params.segments ?? 64;
    const frames = curve.computeFrenetFrames(segments, params.closed ?? false);
    const spacedPoints = curve.getSpacedPoints(segments);

    // Build geometry by sweeping profile along path
    const epVertices: number[] = [];
    const epIndices: number[] = [];
    const profileResolution = profilePts.length;

    for (let i = 0; i <= segments; i++) {
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];
      const point = spacedPoints[i];

      // Scale profile based on scalePath parameter
      let epScale = 1;
      if (params.scalePath && params.scalePath.length > 0) {
        const t = i / segments;
        const scaleIdx = t * (params.scalePath.length - 1);
        const sIdx = Math.floor(scaleIdx);
        const sFrac = scaleIdx - sIdx;
        const s0 = params.scalePath[Math.min(sIdx, params.scalePath.length - 1)];
        const s1 = params.scalePath[Math.min(sIdx + 1, params.scalePath.length - 1)];
        epScale = s0 + (s1 - s0) * sFrac;
      }

      // Apply twist
      let twistAngle = 0;
      if (params.twistAngle) {
        twistAngle = (params.twistAngle * i) / segments;
      }
      const cosT = Math.cos(twistAngle);
      const sinT = Math.sin(twistAngle);

      for (let j = 0; j < profileResolution; j++) {
        const px = profilePts[j][0] * epScale;
        const py = profilePts[j][1] * epScale;

        // Rotate profile point by twist angle
        const rpx = px * cosT - py * sinT;
        const rpy = px * sinT + py * cosT;

        // Transform to world space using Frenet frame
        const vx = point.x + rpx * normal.x + rpy * binormal.x;
        const vy = point.y + rpx * normal.y + rpy * binormal.y;
        const vz = point.z + rpx * normal.z + rpy * binormal.z;
        epVertices.push(vx, vy, vz);
      }
    }

    // Build triangle indices
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < profileResolution; j++) {
        const a = i * profileResolution + j;
        const b = i * profileResolution + ((j + 1) % profileResolution);
        const c = (i + 1) * profileResolution + ((j + 1) % profileResolution);
        const d = (i + 1) * profileResolution + j;
        epIndices.push(a, b, d);
        epIndices.push(b, c, d);
      }
    }

    const epGeometry = new THREE.BufferGeometry();
    epGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(epVertices), 3));
    epGeometry.setIndex(epIndices);
    epGeometry.computeVertexNormals();

    const epMaterial = new THREE.MeshStandardMaterial({ color: params.color ?? 0xcccccc });
    const epMesh = new THREE.Mesh(epGeometry, epMaterial);
    epMesh.name = params.id;
    if (params.position) {
      epMesh.position.set(params.position[0], params.position[1], params.position[2]);
    }
    scene.add(epMesh);
    objects.set(params.id, epMesh);
    return { id: params.id, vertexCount: epVertices.length / 3, faceCount: epIndices.length / 3 };
  },

  deform(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);
    if (!(obj instanceof THREE.Mesh)) throw new Error("Can only deform meshes");

    const geometry = obj.geometry;
    const posAttr = geometry.getAttribute("position");
    if (!posAttr) throw new Error("Mesh has no position attribute");

    const deformParams = params.params ?? {};

    switch (params.type) {
      case "noise": {
        const amplitude = deformParams.amplitude ?? 0.1;
        const seed = deformParams.seed ?? 0;
        // Simple pseudo-random noise displacement
        for (let i = 0; i < posAttr.count; i++) {
          const hash = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
          const noise = (hash - Math.floor(hash)) * 2 - 1;
          posAttr.setX(i, posAttr.getX(i) + noise * amplitude);
          posAttr.setY(i, posAttr.getY(i) + noise * amplitude * 0.7);
          posAttr.setZ(i, posAttr.getZ(i) + noise * amplitude * 0.5);
        }
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        return { objectId: params.objectId, type: "noise", verticesModified: posAttr.count };
      }
      case "bend": {
        const angle = deformParams.angle ?? Math.PI / 4;
        const axis = (deformParams.axis as string) ?? "y";
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const minVal = axisIdx === 0 ? bb.min.x : axisIdx === 1 ? bb.min.y : bb.min.z;
        const maxVal = axisIdx === 0 ? bb.max.x : axisIdx === 1 ? bb.max.y : bb.max.z;
        const range = maxVal - minVal;
        if (range < 0.0001) break;

        for (let i = 0; i < posAttr.count; i++) {
          const pos = [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)];
          const t = (pos[axisIdx] - minVal) / range;
          const bendAngle = angle * t;

          const [p1] = axisIdx === 0 ? [1, 2] : axisIdx === 1 ? [0, 2] : [0, 1];

          const cos = Math.cos(bendAngle);
          const sin = Math.sin(bendAngle);
          const origP1 = pos[p1];
          const origAxis = pos[axisIdx];
          pos[p1] = origP1 * cos - origAxis * sin;
          pos[axisIdx] = origP1 * sin + origAxis * cos;

          posAttr.setXYZ(i, pos[0], pos[1], pos[2]);
        }
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        return { objectId: params.objectId, type: "bend", verticesModified: posAttr.count };
      }
      case "twist": {
        const angle = deformParams.angle ?? Math.PI / 2;
        const axis = (deformParams.axis as string) ?? "y";
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const minVal = axisIdx === 0 ? bb.min.x : axisIdx === 1 ? bb.min.y : bb.min.z;
        const maxVal = axisIdx === 0 ? bb.max.x : axisIdx === 1 ? bb.max.y : bb.max.z;
        const range = maxVal - minVal;
        if (range < 0.0001) break;

        const [p1, p2] = axisIdx === 0 ? [1, 2] : axisIdx === 1 ? [0, 2] : [0, 1];

        for (let i = 0; i < posAttr.count; i++) {
          const pos = [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)];
          const t = (pos[axisIdx] - minVal) / range;
          const twistAngle = angle * t;
          const cos = Math.cos(twistAngle);
          const sin = Math.sin(twistAngle);
          const origP1 = pos[p1];
          const origP2 = pos[p2];
          pos[p1] = origP1 * cos - origP2 * sin;
          pos[p2] = origP1 * sin + origP2 * cos;
          posAttr.setXYZ(i, pos[0], pos[1], pos[2]);
        }
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        return { objectId: params.objectId, type: "twist", verticesModified: posAttr.count };
      }
      case "taper": {
        const factor = deformParams.factor ?? 0.5;
        const axis = (deformParams.axis as string) ?? "y";
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const minVal = axisIdx === 0 ? bb.min.x : axisIdx === 1 ? bb.min.y : bb.min.z;
        const maxVal = axisIdx === 0 ? bb.max.x : axisIdx === 1 ? bb.max.y : bb.max.z;
        const range = maxVal - minVal;
        if (range < 0.0001) break;

        const [p1, p2] = axisIdx === 0 ? [1, 2] : axisIdx === 1 ? [0, 2] : [0, 1];

        for (let i = 0; i < posAttr.count; i++) {
          const pos = [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)];
          const t = (pos[axisIdx] - minVal) / range;
          const scale = 1 + (factor - 1) * t;
          pos[p1] *= scale;
          pos[p2] *= scale;
          posAttr.setXYZ(i, pos[0], pos[1], pos[2]);
        }
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        return { objectId: params.objectId, type: "taper", verticesModified: posAttr.count };
      }
      default:
        throw new Error(`Unknown deform type: ${params.type}`);
    }
  },

  subdivide(params) {
    const obj = objects.get(params.objectId);
    if (!obj || !(obj instanceof THREE.Mesh)) throw new Error("Mesh not found");

    let geometry = obj.geometry;
    const levels = Math.min(params.levels ?? 1, 4);

    for (let level = 0; level < levels; level++) {
      // Ensure we have an indexed geometry
      if (!geometry.index) {
        const posAttr = geometry.getAttribute("position");
        const indices: number[] = [];
        for (let i = 0; i < posAttr.count; i++) indices.push(i);
        geometry.setIndex(indices);
      }

      const posAttr = geometry.getAttribute("position");
      const index = geometry.index!;
      const positions: number[] = [];

      // Copy existing positions
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }

      // Edge map: "min_max" -> { midIndex }
      const edgeMap = new Map<string, { midIdx: number; v0: number; v1: number }>();
      const newIndices: number[] = [];

      function getEdgeMid(a: number, b: number): number {
        const key = Math.min(a, b) + "_" + Math.max(a, b);
        if (edgeMap.has(key)) return edgeMap.get(key)!.midIdx;

        const midIdx = positions.length / 3;
        const ax = positions[a * 3],
          ay = positions[a * 3 + 1],
          az = positions[a * 3 + 2];
        const bx = positions[b * 3],
          by = positions[b * 3 + 1],
          bz = positions[b * 3 + 2];
        positions.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        edgeMap.set(key, { midIdx, v0: a, v1: b });
        return midIdx;
      }

      // For each triangle, split into 4
      const triCount = index.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index.getX(t * 3);
        const i1 = index.getX(t * 3 + 1);
        const i2 = index.getX(t * 3 + 2);

        const m01 = getEdgeMid(i0, i1);
        const m12 = getEdgeMid(i1, i2);
        const m20 = getEdgeMid(i2, i0);

        // 4 new triangles
        newIndices.push(i0, m01, m20);
        newIndices.push(m01, i1, m12);
        newIndices.push(m20, m12, i2);
        newIndices.push(m01, m12, m20);
      }

      // If not preserving edges, apply smoothing to original vertices
      if (!params.preserveEdges) {
        const vertCount = posAttr.count;
        const neighbors: Set<number>[] = Array.from({ length: vertCount }, () => new Set());
        for (let t = 0; t < triCount; t++) {
          const i0 = index.getX(t * 3);
          const i1 = index.getX(t * 3 + 1);
          const i2 = index.getX(t * 3 + 2);
          neighbors[i0].add(i1);
          neighbors[i0].add(i2);
          neighbors[i1].add(i0);
          neighbors[i1].add(i2);
          neighbors[i2].add(i0);
          neighbors[i2].add(i1);
        }

        for (let v = 0; v < vertCount; v++) {
          const n = neighbors[v].size;
          if (n < 2) continue;
          const beta = n > 3 ? 3 / (8 * n) : 3 / 16;
          let sx = 0,
            sy = 0,
            sz = 0;
          for (const nb of neighbors[v]) {
            sx += positions[nb * 3];
            sy += positions[nb * 3 + 1];
            sz += positions[nb * 3 + 2];
          }
          const ox = posAttr.getX(v),
            oy = posAttr.getY(v),
            oz = posAttr.getZ(v);
          positions[v * 3] = (1 - n * beta) * ox + beta * sx;
          positions[v * 3 + 1] = (1 - n * beta) * oy + beta * sy;
          positions[v * 3 + 2] = (1 - n * beta) * oz + beta * sz;
        }
      }

      // Build new geometry
      const newGeo = new THREE.BufferGeometry();
      newGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      newGeo.setIndex(newIndices);
      newGeo.computeVertexNormals();

      geometry.dispose();
      geometry = newGeo;
    }

    obj.geometry = geometry;
    return {
      objectId: params.objectId,
      levels,
      vertexCount: geometry.getAttribute("position").count,
      faceCount: geometry.index ? geometry.index.count / 3 : 0,
    };
  },

  getVertices(params) {
    const obj = objects.get(params.objectId);
    if (!obj || !(obj instanceof THREE.Mesh)) throw new Error("Mesh not found");
    const posAttr = obj.geometry.getAttribute("position");
    const start = params.start ?? 0;
    const count = params.count ?? posAttr.count;
    const end = Math.min(start + count, posAttr.count);
    const gvVertices: number[][] = [];
    for (let i = start; i < end; i++) {
      gvVertices.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
    }
    return {
      objectId: params.objectId,
      totalVertices: posAttr.count,
      start,
      count: gvVertices.length,
      vertices: gvVertices,
    };
  },

  setVertices(params) {
    const obj = objects.get(params.objectId);
    if (!obj || !(obj instanceof THREE.Mesh)) throw new Error("Mesh not found");
    const posAttr = obj.geometry.getAttribute("position");
    const positions: number[] = params.positions;
    const indices: number[] | undefined = params.indices;

    if (indices) {
      // Partial update — set specific vertex indices
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx >= 0 && idx < posAttr.count) {
          posAttr.setXYZ(idx, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        }
      }
    } else {
      // Full update — replace all positions
      const svCount = Math.min(positions.length / 3, posAttr.count);
      for (let i = 0; i < svCount; i++) {
        posAttr.setXYZ(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      }
    }
    posAttr.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    return { objectId: params.objectId, verticesModified: indices ? indices.length : posAttr.count };
  },

  pushPull(params) {
    const obj = objects.get(params.objectId);
    if (!obj || !(obj instanceof THREE.Mesh)) throw new Error("Mesh not found");
    const ppGeometry = obj.geometry;
    const posAttr = ppGeometry.getAttribute("position");
    const normalAttr = ppGeometry.getAttribute("normal");
    if (!normalAttr) {
      ppGeometry.computeVertexNormals();
    }
    const normals = ppGeometry.getAttribute("normal");

    const distance = params.distance ?? 0.1;
    const selection = params.selection ?? "all";
    const falloff = params.falloff ?? "linear";

    // Determine which vertices to affect
    const affected: { index: number; weight: number }[] = [];

    if (selection === "all") {
      for (let i = 0; i < posAttr.count; i++) {
        affected.push({ index: i, weight: 1 });
      }
    } else if (Array.isArray(params.indices)) {
      for (const idx of params.indices) {
        if (idx >= 0 && idx < posAttr.count) {
          affected.push({ index: idx, weight: 1 });
        }
      }
    } else if (params.sphere) {
      // Sphere selection with falloff
      const cx = params.sphere.center[0],
        cy = params.sphere.center[1],
        cz = params.sphere.center[2];
      const radius = params.sphere.radius;
      for (let i = 0; i < posAttr.count; i++) {
        const dx = posAttr.getX(i) - cx;
        const dy = posAttr.getY(i) - cy;
        const dz = posAttr.getZ(i) - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= radius) {
          let weight = 1 - dist / radius;
          if (falloff === "smooth") weight = weight * weight * (3 - 2 * weight);
          else if (falloff === "sharp") weight = weight * weight;
          affected.push({ index: i, weight });
        }
      }
    } else if (params.box) {
      const bmin = params.box.min,
        bmax = params.box.max;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i),
          y = posAttr.getY(i),
          z = posAttr.getZ(i);
        if (
          x >= bmin[0] &&
          x <= bmax[0] &&
          y >= bmin[1] &&
          y <= bmax[1] &&
          z >= bmin[2] &&
          z <= bmax[2]
        ) {
          affected.push({ index: i, weight: 1 });
        }
      }
    }

    // Apply displacement along normals
    for (const { index, weight } of affected) {
      const nx = normals.getX(index),
        ny = normals.getY(index),
        nz = normals.getZ(index);
      const d = distance * weight;
      posAttr.setXYZ(
        index,
        posAttr.getX(index) + nx * d,
        posAttr.getY(index) + ny * d,
        posAttr.getZ(index) + nz * d,
      );
    }
    posAttr.needsUpdate = true;
    ppGeometry.computeVertexNormals();
    return { objectId: params.objectId, verticesAffected: affected.length };
  },

  removeObject(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);
    obj.removeFromParent();
    objects.delete(params.objectId);

    // Dispose geometry/material if mesh
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) obj.material.dispose();
    }
    return { ok: true };
  },

  clearScene() {
    // Remove all user objects, keep default lighting and grid
    for (const [id, obj] of objects) {
      obj.removeFromParent();
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
      objects.delete(id);
    }
    return { ok: true };
  },

  setBackground(params) {
    const color = params.color ?? 0xffffff;
    const alpha = params.alpha ?? 1;
    currentBgColor = typeof color === "string" ? new THREE.Color(color).getHex() : color;
    currentBgAlpha = alpha;
    renderer.setClearColor(currentBgColor, currentBgAlpha);
    return { color: currentBgColor, alpha: currentBgAlpha };
  },

  listObjects() {
    const result: any[] = [];
    for (const [id, obj] of objects) {
      result.push({
        id,
        name: obj.name,
        type: obj.type,
        position: obj.position.toArray(),
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: obj.scale.toArray(),
      });
    }
    return result;
  },

  resize(params) {
    renderer.setSize(params.width, params.height);
    composer.setSize(params.width, params.height);
    camera.aspect = params.width / params.height;
    camera.updateProjectionMatrix();
    // Update resolution uniforms on all existing effect passes
    const res = new THREE.Vector2(params.width, params.height);
    for (const pass of effectPasses.values()) {
      if (pass.uniforms.resolution) {
        pass.uniforms.resolution.value = res.clone();
      }
    }
    return { ok: true };
  },

  setRenderMode(params) {
    renderMode = params.mode;
    return { ok: true };
  },

  // 2D Canvas commands
  createCanvas(params) {
    canvas2d = new OffscreenCanvas(params.width, params.height);
    ctx2d = canvas2d.getContext("2d")!;
    if (params.background) {
      ctx2d.fillStyle = params.background;
      ctx2d.fillRect(0, 0, params.width, params.height);
    }
    return { width: params.width, height: params.height };
  },

  drawShape(params) {
    if (!ctx2d) throw new Error("No 2D canvas. Call createCanvas first.");
    ctx2d.beginPath();
    switch (params.shape) {
      case "rect":
        if (params.fill) {
          ctx2d.fillStyle = params.fill;
          ctx2d.fillRect(params.x, params.y, params.width, params.height);
        }
        if (params.stroke) {
          ctx2d.strokeStyle = params.stroke;
          ctx2d.lineWidth = params.lineWidth ?? 1;
          ctx2d.strokeRect(params.x, params.y, params.width, params.height);
        }
        break;
      case "circle":
        ctx2d.arc(params.x, params.y, params.radius, 0, Math.PI * 2);
        if (params.fill) {
          ctx2d.fillStyle = params.fill;
          ctx2d.fill();
        }
        if (params.stroke) {
          ctx2d.strokeStyle = params.stroke;
          ctx2d.lineWidth = params.lineWidth ?? 1;
          ctx2d.stroke();
        }
        break;
      case "ellipse":
        ctx2d.ellipse(params.x, params.y, params.radiusX, params.radiusY, 0, 0, Math.PI * 2);
        if (params.fill) {
          ctx2d.fillStyle = params.fill;
          ctx2d.fill();
        }
        if (params.stroke) {
          ctx2d.strokeStyle = params.stroke;
          ctx2d.lineWidth = params.lineWidth ?? 1;
          ctx2d.stroke();
        }
        break;
      case "polygon":
        if (params.points && params.points.length >= 2) {
          ctx2d.moveTo(params.points[0][0], params.points[0][1]);
          for (let i = 1; i < params.points.length; i++) {
            ctx2d.lineTo(params.points[i][0], params.points[i][1]);
          }
          ctx2d.closePath();
          if (params.fill) {
            ctx2d.fillStyle = params.fill;
            ctx2d.fill();
          }
          if (params.stroke) {
            ctx2d.strokeStyle = params.stroke;
            ctx2d.lineWidth = params.lineWidth ?? 1;
            ctx2d.stroke();
          }
        }
        break;
    }
    return { ok: true };
  },

  drawLine(params) {
    if (!ctx2d) throw new Error("No 2D canvas. Call createCanvas first.");
    if (!params.points || params.points.length < 2) return { ok: false };
    ctx2d.beginPath();
    ctx2d.moveTo(params.points[0][0], params.points[0][1]);
    for (let i = 1; i < params.points.length; i++) {
      ctx2d.lineTo(params.points[i][0], params.points[i][1]);
    }
    ctx2d.strokeStyle = params.color ?? "#ffffff";
    ctx2d.lineWidth = params.width ?? 1;
    ctx2d.stroke();
    return { ok: true };
  },

  setPixel(params) {
    if (!ctx2d) throw new Error("No 2D canvas. Call createCanvas first.");
    const pixels: Array<{ x: number; y: number; color: string }> = params.pixels;
    for (const p of pixels) {
      ctx2d.fillStyle = p.color;
      ctx2d.fillRect(p.x, p.y, 1, 1);
    }
    return { count: pixels.length };
  },

  // --- Animation commands ---
  createSkeleton(params) {
    const rootBone = new THREE.Bone();
    rootBone.name = params.name + "_root";
    const bones = new Map<string, THREE.Bone>();
    skeletonRoots.set(params.id, { root: rootBone, bones });
    objects.set(params.id, rootBone);
    return { id: params.id };
  },

  addBone(params) {
    const skelData = skeletonRoots.get(params.skeletonId);
    if (!skelData) throw new Error(`Skeleton "${params.skeletonId}" not found`);

    const bone = new THREE.Bone();
    bone.name = params.name;
    bone.position.set(params.position[0], params.position[1], params.position[2]);
    bone.rotation.set(params.rotation[0], params.rotation[1], params.rotation[2]);

    // Attach to parent bone or skeleton root
    if (params.parentBoneId && skelData.bones.has(params.parentBoneId)) {
      skelData.bones.get(params.parentBoneId)!.add(bone);
    } else {
      skelData.root.add(bone);
    }

    skelData.bones.set(params.boneId, bone);
    return { boneId: params.boneId };
  },

  skinMesh(params) {
    const meshObj = objects.get(params.meshId);
    if (!meshObj || !(meshObj instanceof THREE.Mesh))
      throw new Error(`Mesh "${params.meshId}" not found`);

    const skelData = skeletonRoots.get(params.skeletonId);
    if (!skelData) throw new Error(`Skeleton "${params.skeletonId}" not found`);

    // Collect all bones in order: root first, then children
    const allBones: THREE.Bone[] = [skelData.root];
    skelData.root.traverse((child) => {
      if (child !== skelData.root && child instanceof THREE.Bone) {
        allBones.push(child);
      }
    });

    const skeleton = new THREE.Skeleton(allBones);

    const geometry = meshObj.geometry.clone();
    const vertexCount = geometry.getAttribute("position").count;

    // Generate skinning attributes
    const skinIndices = new Float32Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);

    if (params.weights && params.weights.length > 0) {
      // Use explicit weights — build a map of boneId to bone index
      const boneIdToIndex = new Map<string, number>();
      boneIdToIndex.set("__root__", 0);
      let bIdx = 1;
      for (const [boneId] of skelData.bones) {
        boneIdToIndex.set(boneId, bIdx++);
      }
      for (const w of params.weights) {
        const bi = boneIdToIndex.get(w.boneId) ?? 0;
        const vi = w.vertexIndex;
        for (let s = 0; s < 4; s++) {
          if (skinWeights[vi * 4 + s] === 0) {
            skinIndices[vi * 4 + s] = bi;
            skinWeights[vi * 4 + s] = w.weight;
            break;
          }
        }
      }
    } else {
      // Auto-generate weights based on vertex distance to bones
      const posAttr = geometry.getAttribute("position");
      const bonePositions: THREE.Vector3[] = allBones.map((b) => {
        const v = new THREE.Vector3();
        b.updateWorldMatrix(true, false);
        b.getWorldPosition(v);
        return v;
      });

      for (let vi = 0; vi < vertexCount; vi++) {
        const vPos = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));

        const distances = bonePositions.map((bp, i) => ({
          index: i,
          dist: vPos.distanceTo(bp),
        }));
        distances.sort((a, b) => a.dist - b.dist);

        const maxInfluences = Math.min(4, distances.length);
        let totalWeight = 0;
        for (let s = 0; s < maxInfluences; s++) {
          const invDist = 1 / (distances[s].dist + 0.001);
          skinIndices[vi * 4 + s] = distances[s].index;
          skinWeights[vi * 4 + s] = invDist;
          totalWeight += invDist;
        }
        if (totalWeight > 0) {
          for (let s = 0; s < maxInfluences; s++) {
            skinWeights[vi * 4 + s] /= totalWeight;
          }
        }
      }
    }

    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(skinIndices), 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));

    const material =
      meshObj.material instanceof THREE.Material
        ? meshObj.material.clone()
        : new THREE.MeshStandardMaterial();

    const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
    skinnedMesh.name = meshObj.name;
    skinnedMesh.add(allBones[0]);
    skinnedMesh.bind(skeleton);

    skinnedMesh.position.copy(meshObj.position);
    skinnedMesh.rotation.copy(meshObj.rotation);
    skinnedMesh.scale.copy(meshObj.scale);

    const parent = meshObj.parent ?? scene;
    parent.remove(meshObj);
    parent.add(skinnedMesh);

    meshObj.geometry.dispose();
    if (meshObj.material instanceof THREE.Material) meshObj.material.dispose();

    objects.set(params.meshId, skinnedMesh);
    return { meshId: params.meshId, skinned: true, boneCount: allBones.length };
  },

  createAnimationClip(params) {
    clipStore.set(params.id, new THREE.AnimationClip(params.name, params.duration, []));
    return { id: params.id };
  },

  addKeyframe(params) {
    const clip = clipStore.get(params.clipId);
    if (!clip) throw new Error(`Animation clip "${params.clipId}" not found`);

    const boneName = params.boneId;
    const theClip = clip;

    // Helper to upsert a VectorKeyframeTrack
    function upsertTrack(property: string, values: number[]) {
      const trackName = `${boneName}.${property}`;
      const existing = theClip.tracks.find((t) => t.name === trackName);
      if (!existing) {
        theClip.tracks.push(new THREE.VectorKeyframeTrack(trackName, [params.time], values));
      } else {
        const times = [...existing.times, params.time];
        const vals = [...existing.values, ...values];
        const stride = values.length;
        const pairs = times.map((t, i) => ({
          t,
          v: vals.slice(i * stride, i * stride + stride),
        }));
        pairs.sort((a, b) => a.t - b.t);
        const newTrack = new THREE.VectorKeyframeTrack(
          trackName,
          pairs.map((p) => p.t),
          pairs.flatMap((p) => p.v),
        );
        theClip.tracks[theClip.tracks.indexOf(existing)] = newTrack;
      }
    }

    if (params.position) upsertTrack("position", params.position);
    if (params.rotation) upsertTrack("rotation", params.rotation);
    if (params.scale) upsertTrack("scale", params.scale);

    return { clipId: params.clipId, boneId: params.boneId, time: params.time };
  },

  playAnimation(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);

    const clip = clipStore.get(params.clipId);
    if (!clip) throw new Error(`Animation clip "${params.clipId}" not found`);

    let mixer = mixers.get(params.objectId);
    if (!mixer) {
      mixer = new THREE.AnimationMixer(obj);
      mixers.set(params.objectId, mixer);
    }

    const action = mixer.clipAction(clip);
    action.reset();
    action.play();

    return { objectId: params.objectId, clipId: params.clipId, playing: true };
  },

  setAnimationFrame(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);

    const clip = clipStore.get(params.clipId);
    if (!clip) throw new Error(`Animation clip "${params.clipId}" not found`);

    let mixer = mixers.get(params.objectId);
    if (!mixer) {
      mixer = new THREE.AnimationMixer(obj);
      mixers.set(params.objectId, mixer);
    }

    const action = mixer.clipAction(clip);
    action.reset();
    action.play();
    action.paused = true;
    mixer.setTime(params.time);

    return {
      objectId: params.objectId,
      clipId: params.clipId,
      time: params.time,
      paused: true,
    };
  },

  // --- Modeling Commands (WT3) ---
  clone(params) {
    const source = objects.get(params.sourceId);
    if (!source) throw new Error(`Object "${params.sourceId}" not found`);
    const cloned = source.clone(true);
    cloned.name = params.newId;
    if (params.position) {
      cloned.position.set(params.position[0], params.position[1], params.position[2]);
    }
    if (params.rotation) {
      cloned.rotation.set(params.rotation[0], params.rotation[1], params.rotation[2]);
    }
    if (params.scale) {
      cloned.scale.set(params.scale[0], params.scale[1], params.scale[2]);
    }
    scene.add(cloned);
    objects.set(params.newId, cloned);
    return { id: params.newId };
  },

  mirror(params) {
    const source = objects.get(params.sourceId);
    if (!source) throw new Error(`Object "${params.sourceId}" not found`);
    const mirrored = source.clone(true);
    mirrored.name = params.newId;

    // Copy position, then mirror it
    mirrored.position.copy(source.position);
    const axisIndex = { x: 0, y: 1, z: 2 }[params.axis as "x" | "y" | "z"];
    const posArr = mirrored.position.toArray();
    posArr[axisIndex] = -posArr[axisIndex] + (params.offset ?? 0) * 2;
    mirrored.position.fromArray(posArr);

    // Mirror scale on axis
    const scaleArr = mirrored.scale.toArray();
    scaleArr[axisIndex] = -scaleArr[axisIndex];
    mirrored.scale.fromArray(scaleArr);

    scene.add(mirrored);
    objects.set(params.newId, mirrored);
    return { id: params.newId };
  },

  createTube(params) {
    const points = (params.points as number[][]).map(
      (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]),
    );
    const curve = new THREE.CatmullRomCurve3(points, params.closed ?? false);
    const geometry = new THREE.TubeGeometry(
      curve,
      params.segments ?? 64,
      params.radius ?? 0.1,
      params.radialSegments ?? 8,
      params.closed ?? false,
    );
    const material = new THREE.MeshStandardMaterial({ color: params.color ?? 0xcccccc });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = params.id;
    if (params.position) {
      mesh.position.set(params.position[0], params.position[1], params.position[2]);
    }
    scene.add(mesh);
    objects.set(params.id, mesh);
    return { id: params.id };
  },

  createLathe(params) {
    const points = (params.points as number[][]).map(
      (p: number[]) => new THREE.Vector2(p[0], p[1]),
    );
    const geometry = new THREE.LatheGeometry(
      points,
      params.segments ?? 32,
      0,
      params.phiLength ?? Math.PI * 2,
    );
    const material = new THREE.MeshStandardMaterial({ color: params.color ?? 0xcccccc });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = params.id;
    if (params.position) {
      mesh.position.set(params.position[0], params.position[1], params.position[2]);
    }
    scene.add(mesh);
    objects.set(params.id, mesh);
    return { id: params.id };
  },

  merge(params) {
    const geometries: THREE.BufferGeometry[] = [];
    let firstMaterial: THREE.Material | null = null;

    for (const oid of params.objectIds as string[]) {
      const obj = objects.get(oid);
      if (!obj || !(obj instanceof THREE.Mesh)) {
        throw new Error(`Object "${oid}" is not a mesh`);
      }
      // Apply world transforms to geometry before merging
      const clonedGeo = obj.geometry.clone();
      clonedGeo.applyMatrix4(obj.matrixWorld);
      geometries.push(clonedGeo);
      if (!firstMaterial && obj.material instanceof THREE.Material) {
        firstMaterial = obj.material.clone();
      }
    }

    const mergedGeo = mergeGeometries(geometries, false);
    if (!mergedGeo) throw new Error("Failed to merge geometries");

    const mesh = new THREE.Mesh(
      mergedGeo,
      firstMaterial ?? new THREE.MeshStandardMaterial({ color: 0xcccccc }),
    );
    mesh.name = params.newId;
    scene.add(mesh);
    objects.set(params.newId, mesh);

    // Remove originals if requested
    if (params.removeOriginals) {
      for (const oid of params.objectIds as string[]) {
        const obj = objects.get(oid);
        if (obj) {
          obj.removeFromParent();
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (obj.material instanceof THREE.Material) obj.material.dispose();
          }
          objects.delete(oid);
        }
      }
    }

    return { id: params.newId };
  },

  scatter(params) {
    const source = objects.get(params.sourceId);
    if (!source) throw new Error(`Object "${params.sourceId}" not found`);

    const ids: string[] = [];
    for (const inst of params.instances as Array<{
      id: string;
      position: number[];
      rotation: number[];
      scale: number[];
    }>) {
      const clone = source.clone(true);
      clone.name = inst.id;
      clone.position.set(inst.position[0], inst.position[1], inst.position[2]);
      clone.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
      clone.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      scene.add(clone);
      objects.set(inst.id, clone);
      ids.push(inst.id);
    }
    return { count: ids.length, ids };
  },

  // --- Procedural Generation Commands (WT4) ---
  generateTree(params) {
    const {
      groupId,
      style,
      height,
      trunkRadius,
      branchDepth,
      branchAngle,
      branchLengthFactor,
      leafDensity,
      leafSize,
      seed,
      trunkColor,
      leafColor,
      position,
    } = params;

    const group = new THREE.Group();
    group.name = groupId;
    if (position) group.position.set(position[0], position[1], position[2]);

    const rng = seededRNG(seed ?? 42);
    let partCount = 0;

    // Trunk
    const trunkHeight = height * 0.4;
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor ?? "#8B4513" });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight / 2;
    group.add(trunk);
    partCount++;

    // Recursive branches
    function addBranch(
      parent: THREE.Object3D,
      baseY: number,
      length: number,
      radius: number,
      depth: number,
    ) {
      if (depth <= 0) return;
      const branchCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < branchCount; i++) {
        const angle = rng() * Math.PI * 2;
        const tilt = branchAngle + (rng() - 0.5) * 0.3;
        const bLen = length * branchLengthFactor;
        const bRad = radius * 0.6;

        const geo = new THREE.CylinderGeometry(bRad * 0.5, bRad, bLen, 6);
        const mesh = new THREE.Mesh(geo, trunkMat);
        mesh.position.y = baseY + bLen / 2;
        mesh.rotation.z = tilt;
        mesh.rotation.y = angle;
        parent.add(mesh);
        partCount++;

        addBranch(mesh, bLen / 2, bLen, bRad, depth - 1);
      }
    }

    addBranch(trunk, trunkHeight / 2, trunkHeight * 0.5, trunkRadius * 0.5, branchDepth ?? 2);

    // Foliage
    const foliageMat = new THREE.MeshStandardMaterial({ color: leafColor ?? "#228B22" });
    const canopyY = trunkHeight;

    if (style === "pine") {
      const layers = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < layers; i++) {
        const layerRadius = (leafSize ?? 0.3) * (3 - i * 0.6) * (1 + leafDensity);
        const coneGeo = new THREE.ConeGeometry(layerRadius, height * 0.2, 8);
        const cone = new THREE.Mesh(coneGeo, foliageMat);
        cone.position.y = canopyY + i * height * 0.15;
        group.add(cone);
        partCount++;
      }
    } else if (style === "palm") {
      // Crown of fronds as elongated cones
      const frondCount = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < frondCount; i++) {
        const ang = (i / frondCount) * Math.PI * 2;
        const frondLen = height * 0.4 * (leafSize ?? 0.3) * 3;
        const frondGeo = new THREE.ConeGeometry(0.15, frondLen, 4);
        const frond = new THREE.Mesh(frondGeo, foliageMat);
        frond.position.y = canopyY + height * 0.05;
        frond.position.x = Math.cos(ang) * 0.5;
        frond.position.z = Math.sin(ang) * 0.5;
        frond.rotation.z = Math.cos(ang) * 1.2;
        frond.rotation.x = Math.sin(ang) * 1.2;
        group.add(frond);
        partCount++;
      }
    } else if (style === "willow") {
      // Round canopy with drooping tubes
      const canopyGeo = new THREE.SphereGeometry(
        height * 0.25 * (1 + leafDensity * 0.5),
        8,
        8,
      );
      const canopy = new THREE.Mesh(canopyGeo, foliageMat);
      canopy.position.y = canopyY + height * 0.15;
      group.add(canopy);
      partCount++;
      // Drooping strands
      const strandCount = Math.floor(8 * (leafDensity + 0.5));
      for (let i = 0; i < strandCount; i++) {
        const ang = (i / strandCount) * Math.PI * 2;
        const strandGeo = new THREE.CylinderGeometry(0.02, 0.02, height * 0.4, 4);
        const strand = new THREE.Mesh(strandGeo, foliageMat);
        strand.position.y = canopyY;
        strand.position.x = Math.cos(ang) * height * 0.2;
        strand.position.z = Math.sin(ang) * height * 0.2;
        group.add(strand);
        partCount++;
      }
    } else {
      // Oak — clustered spheres
      const clusterCount = 3 + Math.floor(rng() * 4 * leafDensity);
      for (let i = 0; i < clusterCount; i++) {
        const cr = (leafSize ?? 0.3) * (2 + rng());
        const sphereGeo = new THREE.SphereGeometry(cr, 8, 6);
        const sphere = new THREE.Mesh(sphereGeo, foliageMat);
        sphere.position.y = canopyY + height * 0.1 + rng() * height * 0.2;
        sphere.position.x = (rng() - 0.5) * height * 0.3;
        sphere.position.z = (rng() - 0.5) * height * 0.3;
        group.add(sphere);
        partCount++;
      }
    }

    scene.add(group);
    objects.set(groupId, group);
    return { groupId, partCount };
  },

  generateTerrain(params) {
    const {
      id,
      width,
      depth: terrainDepth,
      resolution,
      amplitude,
      octaves,
      lacunarity,
      persistence,
      seed,
      colorByHeight,
      heightColors,
      position,
    } = params;

    const res = resolution ?? 64;
    const geo = new THREE.PlaneGeometry(width ?? 10, terrainDepth ?? 10, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.getAttribute("position");
    let minY = Infinity,
      maxY = -Infinity;

    // Apply noise displacement
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const nx = (x / (width ?? 10)) * 4;
      const nz = (z / (terrainDepth ?? 10)) * 4;
      const h =
        fbmNoise2D(nx, nz, octaves ?? 4, lacunarity ?? 2, persistence ?? 0.5, seed ?? 42) *
        (amplitude ?? 2);
      posAttr.setY(i, h);
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    // Vertex colors by height
    let material: THREE.Material;
    if (colorByHeight ?? true) {
      const defaultBands = [
        { threshold: 0.15, color: "#1a5276" }, // water (deep blue)
        { threshold: 0.25, color: "#2e86c1" }, // shallow water
        { threshold: 0.3, color: "#f0e68c" }, // sand
        { threshold: 0.5, color: "#228b22" }, // grass
        { threshold: 0.7, color: "#556b2f" }, // dark green
        { threshold: 0.85, color: "#808080" }, // rock
        { threshold: 1.0, color: "#ffffff" }, // snow
      ];
      const bands = (heightColors as any[]) ?? defaultBands;

      const colors = new Float32Array(posAttr.count * 3);
      const tmpColor = new THREE.Color();
      const range = maxY - minY || 1;

      for (let i = 0; i < posAttr.count; i++) {
        const h = (posAttr.getY(i) - minY) / range;
        let bandColor = bands[bands.length - 1].color;
        for (const band of bands) {
          if (h <= band.threshold) {
            bandColor = band.color;
            break;
          }
        }
        tmpColor.set(bandColor);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    } else {
      material = new THREE.MeshStandardMaterial({ color: 0x558833, flatShading: true });
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = id;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    scene.add(mesh);
    objects.set(id, mesh);
    return { id, vertexCount: posAttr.count };
  },

  generateRock(params) {
    const { id, radius, roughness, seed, segments, color, flatShading, position } = params;
    const r = radius ?? 0.5;
    const segs = segments ?? 16;
    const geo = new THREE.SphereGeometry(r, segs, segs);
    const posAttr = geo.getAttribute("position");

    const rng = seededRNG(seed ?? 42);
    // Non-uniform scale for organic shape
    const scaleX = 0.8 + rng() * 0.4;
    const scaleY = 0.7 + rng() * 0.3;
    const scaleZ = 0.8 + rng() * 0.4;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const n = noise3D(x * 3, y * 3, z * 3, seed ?? 42);
      const displacement = 1 + (n - 0.5) * (roughness ?? 0.4) * 2;
      posAttr.setX(i, x * scaleX * displacement);
      posAttr.setY(i, y * scaleY * displacement);
      posAttr.setZ(i, z * scaleZ * displacement);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: color ?? "#888888",
      flatShading: flatShading ?? true,
      roughness: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = id;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    scene.add(mesh);
    objects.set(id, mesh);
    return { id };
  },

  generateBuilding(params) {
    const {
      groupId,
      width,
      depth: bDepth,
      floors,
      floorHeight,
      roofStyle,
      windowPattern,
      wallColor,
      windowColor,
      roofColor,
      position,
    } = params;

    const w = width ?? 3;
    const d = bDepth ?? 3;
    const fh = floorHeight ?? 1.2;
    const nFloors = floors ?? 2;
    const totalHeight = nFloors * fh;
    const wp = windowPattern ?? { rows: 2, cols: 3, width: 0.3, height: 0.4, inset: 0.02 };

    const group = new THREE.Group();
    group.name = groupId;
    if (position) group.position.set(position[0], position[1], position[2]);

    let partCount = 0;

    // Walls — single box
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor ?? "#D2B48C" });
    const wallGeo = new THREE.BoxGeometry(w, totalHeight, d);
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = totalHeight / 2;
    group.add(walls);
    partCount++;

    // Windows — surface-mounted planes
    const winMat = new THREE.MeshStandardMaterial({
      color: windowColor ?? "#87CEEB",
      emissive: windowColor ?? "#87CEEB",
      emissiveIntensity: 0.2,
    });
    const winW = wp.width ?? 0.3;
    const winH = wp.height ?? 0.4;
    const winInset = wp.inset ?? 0.02;
    const winCols = wp.cols ?? 3;

    // Add windows to front and back walls
    for (let floor = 0; floor < nFloors; floor++) {
      const floorBaseY = floor * fh + fh * 0.5;
      for (let col = 0; col < winCols; col++) {
        const winX = -w / 2 + (w / (winCols + 1)) * (col + 1);

        // Front wall
        const winGeoF = new THREE.PlaneGeometry(winW, winH);
        const winF = new THREE.Mesh(winGeoF, winMat);
        winF.position.set(winX, floorBaseY, d / 2 + winInset);
        group.add(winF);
        partCount++;

        // Back wall
        const winB = new THREE.Mesh(winGeoF, winMat);
        winB.position.set(winX, floorBaseY, -d / 2 - winInset);
        winB.rotation.y = Math.PI;
        group.add(winB);
        partCount++;
      }
      // Side windows (fewer)
      const sideCols = Math.max(1, Math.floor(winCols * d / w));
      for (let col = 0; col < sideCols; col++) {
        const winZ = -d / 2 + (d / (sideCols + 1)) * (col + 1);

        const winGeoS = new THREE.PlaneGeometry(winW, winH);
        const winL = new THREE.Mesh(winGeoS, winMat);
        winL.position.set(-w / 2 - winInset, floorBaseY, winZ);
        winL.rotation.y = -Math.PI / 2;
        group.add(winL);
        partCount++;

        const winR = new THREE.Mesh(winGeoS, winMat);
        winR.position.set(w / 2 + winInset, floorBaseY, winZ);
        winR.rotation.y = Math.PI / 2;
        group.add(winR);
        partCount++;
      }
    }

    // Roof
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor ?? "#8B0000" });
    if (roofStyle === "gabled") {
      // Triangular prism
      const roofHeight = Math.min(w, d) * 0.4;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(0, roofHeight);
      shape.closePath();
      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: d,
        bevelEnabled: false,
      });
      const roof = new THREE.Mesh(extrudeGeo, roofMat);
      roof.position.set(0, totalHeight, -d / 2);
      group.add(roof);
      partCount++;
    } else if (roofStyle === "hip") {
      // Pyramid
      const roofHeight = Math.min(w, d) * 0.35;
      const roofGeo = new THREE.ConeGeometry(
        Math.sqrt(w * w + d * d) / 2,
        roofHeight,
        4,
      );
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = totalHeight + roofHeight / 2;
      roof.rotation.y = Math.atan2(d, w);
      group.add(roof);
      partCount++;
    } else {
      // Flat roof — thin box
      const roofGeo = new THREE.BoxGeometry(w + 0.2, 0.1, d + 0.2);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = totalHeight + 0.05;
      group.add(roof);
      partCount++;
    }

    scene.add(group);
    objects.set(groupId, group);
    return { groupId, partCount };
  },

  // --- Clone/Measure Commands (WT5) ---
  cloneObject(params) {
    const source = objects.get(params.sourceId);
    if (!source) throw new Error(`Object "${params.sourceId}" not found`);
    const cloned = source.clone(true);
    cloned.name = params.newId;
    if (params.position) {
      cloned.position.set(params.position[0], params.position[1], params.position[2]);
    }
    if (params.rotation) {
      cloned.rotation.set(params.rotation[0], params.rotation[1], params.rotation[2]);
    }
    if (params.scale) {
      cloned.scale.set(params.scale[0], params.scale[1], params.scale[2]);
    }
    if (params.colorShift !== undefined && cloned instanceof THREE.Mesh) {
      const mat = cloned.material as THREE.MeshStandardMaterial;
      if (mat && mat.color) {
        const hsl = { h: 0, s: 0, l: 0 };
        mat.color.getHSL(hsl);
        hsl.h = (hsl.h + params.colorShift + 1) % 1;
        mat.color.setHSL(hsl.h, hsl.s, hsl.l);
      }
    }
    scene.add(cloned);
    objects.set(params.newId, cloned);
    return { id: params.newId };
  },

  measureObject(params) {
    const obj = objects.get(params.objectId);
    if (!obj) throw new Error(`Object "${params.objectId}" not found`);
    const box = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    return {
      min: box.min.toArray(),
      max: box.max.toArray(),
      center: center.toArray(),
      size: size.toArray(),
    };
  },

  // --- Post-Processing Commands ---
  applyPostProcess(params) {
    const { id, type, params: effectParams } = params;
    const shaderDef = buildPostProcessShader(type, effectParams ?? {});
    const pass = new ShaderPass(shaderDef);
    (pass as any).name = id;
    addEffectPass(pass);
    effectPasses.set(id, pass);
    return { id, type };
  },

  removePostProcess(params) {
    const pass = effectPasses.get(params.id);
    if (!pass) throw new Error(`Effect "${params.id}" not found`);
    composer.removePass(pass);
    pass.dispose();
    effectPasses.delete(params.id);
    return { removed: params.id };
  },

  clearPostProcess() {
    for (const [, pass] of effectPasses) {
      composer.removePass(pass);
      pass.dispose();
    }
    effectPasses.clear();
    // OutputPass remains in the chain (RenderPass -> OutputPass)
    return { cleared: true };
  },

  writeShader(params) {
    const { id, fragmentShader, vertexShader, uniforms } = params;

    const threeUniforms: Record<string, { value: any }> = {
      tDiffuse: { value: null },
    };
    if (uniforms) {
      for (const [name, def] of Object.entries(uniforms as Record<string, any>)) {
        threeUniforms[name] = { value: def.value };
      }
    }

    const shaderDef = {
      uniforms: threeUniforms,
      vertexShader:
        vertexShader ??
        [
          "varying vec2 vUv;",
          "void main() {",
          "  vUv = uv;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "}",
        ].join("\n"),
      fragmentShader,
    };

    const pass = new ShaderPass(shaderDef);
    (pass as any).name = id;
    addEffectPass(pass);
    effectPasses.set(id, pass);
    // Force a render to trigger shader compilation
    composer.render();

    return { id, status: "compiled" };
  },

  setUniform(params) {
    const { shaderId, uniformName, value } = params;
    const pass = effectPasses.get(shaderId);
    if (!pass) throw new Error(`Shader "${shaderId}" not found`);
    if (!pass.uniforms[uniformName]) {
      throw new Error(`Uniform "${uniformName}" not found on shader "${shaderId}"`);
    }
    pass.uniforms[uniformName].value = value;
    return { shaderId, uniformName, updated: true };
  },

  getScreenshot() {
    // Force a render
    composer.render();
    return renderer.domElement.toDataURL("image/png").split(",")[1];
  },

  renderPreview(params) {
    const transparent = params.transparent ?? false;
    const format: string = params.format ?? "png";
    const quality: number = params.quality ?? 0.92;

    if (transparent) {
      renderer.setClearColor(0xffffff, 0);
    } else {
      renderer.setClearColor(currentBgColor, currentBgAlpha);
    }

    composer.render();

    // Restore background
    renderer.setClearColor(currentBgColor, currentBgAlpha);

    if (format === "jpeg") {
      return renderer.domElement.toDataURL("image/jpeg", quality / 100).split(",")[1];
    }
    return renderer.domElement.toDataURL("image/png").split(",")[1];
  },
};

// --- Async Command Handlers ---
type AsyncCommandHandler = (params: Record<string, any>) => Promise<any>;

const asyncCommands: Record<string, AsyncCommandHandler> = {
  async exportGltf(params) {
    const exporter = new GLTFExporter();

    // Export specific object or entire scene
    let target: THREE.Object3D = scene;
    if (params.objectId) {
      const obj = objects.get(params.objectId);
      if (!obj) throw new Error(`Object "${params.objectId}" not found`);
      target = obj;
    }

    const result = await exporter.parseAsync(target, { binary: true });
    // result is an ArrayBuffer for binary GLB
    const bytes = new Uint8Array(result as ArrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },

  async renderSpritesheet(params) {
    const frameCount = params.frameCount as number;
    const cols = params.cols as number;
    const frameWidth = params.frameWidth as number;
    const frameHeight = params.frameHeight as number;
    const animationClipId = params.animationClipId as string | undefined;

    const rows = Math.ceil(frameCount / cols);
    const sheetWidth = cols * frameWidth;
    const sheetHeight = rows * frameHeight;

    // Save current renderer size
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);

    // Set renderer and composer to frame size
    renderer.setSize(frameWidth, frameHeight);
    composer.setSize(frameWidth, frameHeight);
    camera.aspect = frameWidth / frameHeight;
    camera.updateProjectionMatrix();

    // Create composite canvas
    const sheetCanvas = new OffscreenCanvas(sheetWidth, sheetHeight);
    const sheetCtx = sheetCanvas.getContext("2d")!;

    // Determine animation clip and mixer if animation mode
    let clip: THREE.AnimationClip | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let action: THREE.AnimationAction | undefined;

    if (animationClipId && clipStore.has(animationClipId)) {
      clip = clipStore.get(animationClipId)!;
      mixer = new THREE.AnimationMixer(scene);
      action = mixer.clipAction(clip);
      action.play();
    }

    const frameRects: Array<{ x: number; y: number; w: number; h: number }> = [];

    // Save camera state for rotation mode
    const savedCamPos = camera.position.clone();
    const savedCamTarget = new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < frameCount; i++) {
      if (clip && mixer && action) {
        // Animation mode: seek to frame time
        const duration = clip.duration;
        const frameTime = (duration / frameCount) * i;
        mixer.setTime(frameTime);
      } else {
        // Rotation mode: rotate camera around origin
        const angle = (Math.PI * 2 * i) / frameCount;
        const radius = savedCamPos.length();
        const elevation = Math.atan2(
          savedCamPos.y,
          Math.sqrt(savedCamPos.x ** 2 + savedCamPos.z ** 2),
        );
        camera.position.set(
          radius * Math.cos(elevation) * Math.sin(angle),
          radius * Math.sin(elevation),
          radius * Math.cos(elevation) * Math.cos(angle),
        );
        camera.lookAt(savedCamTarget);
      }

      // Render frame
      composer.render();

      // Create an ImageBitmap from the renderer canvas and draw to sheet
      const frameBitmap = await createImageBitmap(renderer.domElement);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * frameWidth;
      const y = row * frameHeight;
      sheetCtx.drawImage(frameBitmap, x, y, frameWidth, frameHeight);
      frameBitmap.close();

      frameRects.push({ x, y, w: frameWidth, h: frameHeight });
    }

    // Restore camera
    camera.position.copy(savedCamPos);
    camera.lookAt(savedCamTarget);

    // Restore renderer and composer size
    renderer.setSize(prevSize.x, prevSize.y);
    composer.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevSize.x / prevSize.y;
    camera.updateProjectionMatrix();

    // Stop animation action if used
    if (action) action.stop();

    // Convert sheet to base64 PNG
    const blob = await sheetCanvas.convertToBlob({ type: "image/png" });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return {
      image: base64,
      metadata: {
        frameCount,
        cols,
        rows,
        frameWidth,
        frameHeight,
        sheetWidth,
        sheetHeight,
        frames: frameRects,
      },
    };
  },

  async importModel(params) {
    const { id, data, format, position, scale: scaleParam, mergeGeometry } = params;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

    let resultObj: THREE.Object3D;

    if (format === "glb" || format === "gltf") {
      const loader = new GLTFLoader();
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      try {
        const gltf = await loader.loadAsync(url);
        resultObj = gltf.scene;
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (format === "obj") {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(bytes);
      resultObj = loader.parse(text);
    } else if (format === "stl") {
      const loader = new STLLoader();
      const stlGeometry = loader.parse(bytes.buffer);
      stlGeometry.computeVertexNormals();
      const stlMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      resultObj = new THREE.Mesh(stlGeometry, stlMaterial);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

    resultObj.name = id;

    if (position) {
      resultObj.position.set(position[0], position[1], position[2]);
    }
    if (scaleParam) {
      if (typeof scaleParam === "number") {
        resultObj.scale.setScalar(scaleParam);
      } else {
        resultObj.scale.set(scaleParam[0], scaleParam[1], scaleParam[2]);
      }
    }

    // Optionally merge all child geometries into one mesh
    if (mergeGeometry && resultObj.children.length > 0) {
      const geometries: THREE.BufferGeometry[] = [];
      let firstMat: THREE.Material | null = null;
      resultObj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const geo = child.geometry.clone();
          geo.applyMatrix4(child.matrixWorld);
          geometries.push(geo);
          if (!firstMat && child.material instanceof THREE.Material) {
            firstMat = child.material.clone();
          }
        }
      });
      if (geometries.length > 0) {
        const mergedGeo = mergeGeometries(geometries, false);
        if (mergedGeo) {
          const mergedMesh = new THREE.Mesh(
            mergedGeo,
            firstMat ?? new THREE.MeshStandardMaterial({ color: 0xcccccc }),
          );
          mergedMesh.name = id;
          if (position) mergedMesh.position.set(position[0], position[1], position[2]);
          if (scaleParam) {
            if (typeof scaleParam === "number") mergedMesh.scale.setScalar(scaleParam);
            else mergedMesh.scale.set(scaleParam[0], scaleParam[1], scaleParam[2]);
          }
          resultObj = mergedMesh;
        }
      }
    }

    scene.add(resultObj);
    objects.set(id, resultObj);

    // Count vertices
    let vertexCount = 0;
    resultObj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        vertexCount += child.geometry.getAttribute("position")?.count ?? 0;
      }
    });

    return { id, format, vertexCount, childCount: resultObj.children.length };
  },
};

// --- RPC Interface ---
interface AtelierRPC {
  execute(
    command: string,
    params: Record<string, any>,
  ): Promise<{ ok: boolean; data?: any; error?: string }>;
  getScreenshot(): string;
}

// --- Command Relay via Vite HMR ---
// Commands that should NOT be relayed (read-only / render operations)
const noRelayCommands = new Set([
  "renderPreview",
  "getScreenshot",
  "exportGltf",
  "renderSpritesheet",
  "listObjects",
  "getBounds",
]);

/**
 * Execute a command locally (no relay). Used by both direct calls and relay receiver.
 */
async function executeLocal(
  command: string,
  params: Record<string, any>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const asyncHandler = asyncCommands[command];
    if (asyncHandler) {
      const data = await asyncHandler(params);
      if (!isHeadless) updateUI();
      return { ok: true, data };
    }

    const handler = commands[command];
    if (!handler) {
      return { ok: false, error: `Unknown command: ${command}` };
    }
    const data = handler(params);
    if (!isHeadless) updateUI();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

// User browser: listen for relayed commands and execute them locally
if (!isHeadless && import.meta.hot) {
  import.meta.hot.on("atelier:command", async (data: { command: string; params: any }) => {
    console.log("[atelier relay] received:", data.command);
    await executeLocal(data.command, data.params);
    // Re-render so the user sees the update
    composer.render();
  });
}

(window as any).__atelier__ = {
  async execute(command: string, params: Record<string, any>) {
    const result = await executeLocal(command, params);

    // Headless browser: relay scene-mutating commands to user browsers
    if (isHeadless && result.ok && !noRelayCommands.has(command) && import.meta.hot) {
      import.meta.hot.send("atelier:command", { command, params });
    }

    return result;
  },
  getScreenshot() {
    composer.render();
    return renderer.domElement.toDataURL("image/png").split(",")[1];
  },
} satisfies AtelierRPC;

// Initialize UI panel for user browser only
if (!isHeadless) {
  initUI({ scene, camera, renderer, objects, grid });
}
