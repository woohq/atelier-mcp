import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
renderer.setClearColor(0xffffff);
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
const composer = new EffectComposer(renderer);
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
          outlineColor: {
            value: new THREE.Vector3(...(params.color ?? [0, 0, 0])),
          },
        },
        vertexShader: defaultVertex,
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform vec2 resolution;",
          "uniform float thickness;",
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
          "  vec4 color = texture2D(tDiffuse, vUv);",
          "  color.rgb = mix(color.rgb, outlineColor, clamp(edge, 0.0, 1.0));",
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
    // CSG not yet implemented — stub that returns a message
    const target = objects.get(params.targetId);
    const tool = objects.get(params.toolId);
    if (!target) throw new Error(`Object "${params.targetId}" not found`);
    if (!tool) throw new Error(`Object "${params.toolId}" not found`);
    return {
      status: "not_yet_implemented",
      message: `Boolean ${params.operation} between "${params.targetId}" and "${params.toolId}" requires CSG library. Stub only.`,
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
      case "bend":
      case "twist":
      case "taper":
        return {
          objectId: params.objectId,
          type: params.type,
          status: "not_yet_implemented",
          message: `Deform type "${params.type}" is a stub.`,
        };
      default:
        throw new Error(`Unknown deform type: ${params.type}`);
    }
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
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(0xffffff, 1);
    }

    composer.render();

    if (transparent) {
      renderer.setClearColor(0xffffff, 1);
    }

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
