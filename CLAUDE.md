# Atelier MCP

## What Is This?

An MCP server that gives LLM agents tools to create game art programmatically. Instead of generating images with diffusion models, the LLM composes art using a vocabulary of constrained operations — geometry, shaders, materials, rendering. The aesthetic lives in the tools, not the model.

**Two-phase workflow:**
1. **Tool authoring** — User pair-programs with an LLM to build/refine tools that encode their visual style (palette, shaders, proportions, export pipeline)
2. **Asset creation** — LLM uses those custom tools to produce game assets at scale with guaranteed consistency

The tools are the art style. Change a shader parameter in one tool file → re-export everything → entire game stays visually coherent.

## Core Architecture

```
LLM Agent (MCP client)
    ↕ MCP protocol (tool calls + image responses)
Atelier MCP Server (TypeScript, Node.js)
    ↕ Playwright bridge
Three.js Preview Page (Vite dev server)
    → renders scene to canvas
    → Playwright screenshots canvas → returns to LLM as image
    → exports glTF/PNG/sprite sheets to disk
```

### Key Components

- **MCP Server** — Registers tools, handles tool calls, returns rendered previews as image content
- **Scene Manager** — Maintains Three.js scene state (meshes, groups, materials, lights, camera) across tool calls within a session
- **Shader Pipeline** — Post-processing chain: pixelate → cel-shade → dither → palette quantize → outline. Each step is configurable. Users create preset tools that lock in their settings
- **Tool Plugin System** — Each tool is a single `.ts` file in `tools/`. `defineTool()` helper provides schema + execute function. Hot reload on file change. User-created tools live alongside built-in tools
- **Preview Bridge** — Playwright controls a headless browser running the Three.js preview page. Sends scene commands via `page.evaluate()`, captures screenshots, returns as MCP image content
- **Export Pipeline** — glTF/GLB for 3D assets, PNG sprite sheets for 2D, optional `.tres` metadata for Godot SpriteFrames

### Directory Structure

```
atelier-mcp/
├── src/
│   ├── server/           # MCP server setup, tool registration
│   ├── scene/            # Three.js scene manager, object graph
│   ├── shaders/          # GLSL shaders, post-processing pipeline
│   ├── bridge/           # Playwright browser bridge
│   ├── export/           # glTF, PNG, sprite sheet, .tres exporters
│   ├── tools/
│   │   ├── builtin/      # Ships with server: primitives, materials, camera, render, export
│   │   └── plugin.ts     # Tool plugin loader, hot reload, defineTool()
│   └── types/            # Shared types
├── preview/              # Vite app: Three.js canvas, receives commands from bridge
├── tools/                # User-created tools live here (gitignored in server repo, per-project)
├── palettes/             # Color palette definitions (JSON)
├── tests/
├── CLAUDE.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Tech Stack

- **Runtime**: Node.js >= 20, ESM
- **Language**: TypeScript (strict)
- **MCP**: `@modelcontextprotocol/sdk`
- **3D**: Three.js (scene graph, geometry, materials, lighting)
- **Rendering**: Playwright (headless Chromium) controlling preview page
- **Preview**: Vite dev server serving Three.js canvas app
- **Export**: Three.js GLTFExporter, node-canvas or sharp for sprite sheet composition
- **Testing**: Vitest

## Built-in Tool Categories

### Geometry
- `primitive` — box, sphere, cylinder, torus, cone, plane with dimensions
- `create_mesh` — raw vertices + faces for custom geometry
- `boolean_op` — union, subtract, intersect between meshes
- `extrude` — extrude a 2D profile along an axis
- `deform` — bend, twist, taper, noise displacement

### Scene
- `create_group` — named group for hierarchical composition
- `add_to_group` — attach object to group with transform
- `transform` — position, rotation, scale any object
- `set_camera` — presets (front, three_quarter, top_down, isometric) or custom
- `set_light` — directional, ambient, point with color/intensity/angle

### Material
- `set_material` — color, metalness, roughness per object or by name pattern
- `set_palette` — define named color palette from array of hex colors
- `apply_palette` — map object colors to nearest palette entry

### Shader / Post-Processing
- `apply_post_process` — add step to the post-processing chain:
  - `pixelate` — reduce render resolution
  - `cel_shade` — quantize lighting to N steps
  - `dither` — bayer, blue_noise, or custom pattern with strength
  - `palette_quantize` — force all colors to nearest palette color
  - `outline` — edge detection outline with thickness and color
- `write_shader` — raw GLSL fragment for custom effects
- `set_uniform` — set shader uniform values
- `clear_post_process` — reset the pipeline

### Render / Export
- `render_preview` — screenshot current scene, return as image to LLM
- `render_spritesheet` — render N rotations/frames into a sprite sheet PNG
- `export_gltf` — export scene or object as .glb
- `export_metadata` — emit Godot .tres SpriteFrames or generic JSON frame data

## Design Principles

1. **Tools encode aesthetics** — The rendering pipeline (palette + shaders + resolution) is what makes art consistent. Users lock these into tool presets.
2. **Low floor, no ceiling** — Base tools are mid-level (primitives, shader presets). Users can go lower (raw mesh, raw GLSL) or higher (custom tools composing base tools).
3. **Preview is instant** — The iterate-and-see loop must be fast. Playwright screenshot round-trip should be <500ms.
4. **Output is engine-agnostic** — glTF + PNG work everywhere. Godot-specific exports (.tres) are opt-in.
5. **Tools are files** — Each tool is a single .ts file. Easy to read, write, modify, version control. Hot reload means no restart needed.
6. **Scene is stateful** — Objects persist across tool calls within a session. The LLM builds up a scene incrementally, not in one shot.

## Code Style

- Prettier: double quotes, semicolons, trailing commas, 100 char width, 2-space indent
- ESLint: typescript-eslint recommended
- Strict TypeScript
- Tests mirror src/ structure in tests/

## Commands

- `npm run dev` — start preview server + MCP server in dev mode
- `npm run build` — tsc
- `npm test` — vitest run
- `npm run check` — tsc --noEmit + eslint + vitest

## Key Design Decisions

- **Playwright over headless-gl**: headless-gl is fragile and limited. Playwright gives full WebGL2/WebGPU in real Chromium. The preview page also doubles as a live preview the user can open in their browser.
- **Three.js over Blender**: faster iteration cycle, runs in-process with Node, native glTF export. Blender is more powerful but too slow for the tight feedback loop this needs.
- **File-based tool plugins over a registry API**: tools are just files. Users edit them directly during pair programming. No configuration, no registration boilerplate beyond `defineTool()`.
- **Post-processing chain over per-material shaders**: the "look" should be scene-wide and consistent. Individual materials set color/roughness, the post-processing chain handles the artistic treatment uniformly.
