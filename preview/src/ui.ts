import type * as THREE from "three";

interface UIRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  objects: Map<string, THREE.Object3D>;
  grid: THREE.GridHelper;
}

let panel: HTMLDivElement;
let objectCountEl: HTMLSpanElement;
let objectListEl: HTMLDivElement;
let refs: UIRefs;

export function initUI(r: UIRefs): void {
  refs = r;

  panel = document.createElement("div");
  panel.id = "atelier-ui";
  panel.innerHTML = `
    <style>
      #atelier-ui {
        position: fixed;
        top: 12px;
        right: 12px;
        background: rgba(0, 0, 0, 0.75);
        color: #ccc;
        font-family: monospace;
        font-size: 12px;
        padding: 10px 14px;
        border-radius: 6px;
        z-index: 1000;
        min-width: 180px;
        user-select: none;
      }
      #atelier-ui h3 {
        margin: 0 0 8px 0;
        color: #fff;
        font-size: 13px;
      }
      #atelier-ui label {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 4px 0;
        cursor: pointer;
      }
      #atelier-ui input[type="checkbox"] {
        cursor: pointer;
      }
      #atelier-ui input[type="color"] {
        border: none;
        background: none;
        cursor: pointer;
        width: 24px;
        height: 20px;
        padding: 0;
      }
      .atelier-obj-list {
        max-height: 200px;
        overflow-y: auto;
        margin-top: 6px;
        border-top: 1px solid #444;
        padding-top: 4px;
      }
      .atelier-obj-list div {
        padding: 1px 0;
        color: #999;
        font-size: 11px;
      }
      .atelier-toggle-btn {
        background: none;
        border: 1px solid #555;
        color: #ccc;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        font-family: monospace;
      }
      .atelier-toggle-btn:hover {
        border-color: #888;
        color: #fff;
      }
    </style>
    <h3>Atelier</h3>
    <div>Objects: <span id="atelier-obj-count">0</span></div>
    <label><input type="checkbox" id="atelier-grid-toggle" checked /> Grid</label>
    <label><input type="checkbox" id="atelier-wireframe-toggle" /> Wireframe</label>
    <label>BG <input type="color" id="atelier-bg-color" value="#222222" /></label>
    <button class="atelier-toggle-btn" id="atelier-obj-toggle">Objects &#9660;</button>
    <div class="atelier-obj-list" id="atelier-obj-list" style="display:none"></div>
  `;
  document.body.appendChild(panel);

  objectCountEl = document.getElementById("atelier-obj-count") as HTMLSpanElement;
  objectListEl = document.getElementById("atelier-obj-list") as HTMLDivElement;

  // Grid toggle
  const gridToggle = document.getElementById("atelier-grid-toggle") as HTMLInputElement;
  gridToggle.addEventListener("change", () => {
    refs.grid.visible = gridToggle.checked;
  });

  // Wireframe toggle
  const wireToggle = document.getElementById("atelier-wireframe-toggle") as HTMLInputElement;
  wireToggle.addEventListener("change", () => {
    refs.scene.traverse((obj) => {
      if ((obj as any).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.material && "wireframe" in mesh.material) {
          (mesh.material as any).wireframe = wireToggle.checked;
        }
      }
    });
  });

  // Background color picker
  const bgColor = document.getElementById("atelier-bg-color") as HTMLInputElement;
  bgColor.addEventListener("input", () => {
    refs.renderer.setClearColor(bgColor.value);
  });

  // Object list toggle
  const objToggle = document.getElementById("atelier-obj-toggle") as HTMLButtonElement;
  objToggle.addEventListener("click", () => {
    const visible = objectListEl.style.display !== "none";
    objectListEl.style.display = visible ? "none" : "block";
    objToggle.textContent = visible ? "Objects \u25BC" : "Objects \u25B2";
  });

  updateUI();
}

export function updateUI(): void {
  if (!panel || !refs) return;

  const count = refs.objects.size;
  objectCountEl.textContent = String(count);

  // Update object list
  objectListEl.innerHTML = "";
  for (const [id, obj] of refs.objects) {
    const div = document.createElement("div");
    div.textContent = `${id} (${obj.type})`;
    objectListEl.appendChild(div);
  }
}
