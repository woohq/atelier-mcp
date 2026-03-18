# Atelier MCP

An MCP server that gives LLM agents tools to create game art programmatically. Instead of generating images with diffusion models, the LLM composes art using a vocabulary of constrained operations — geometry, shaders, materials, rendering. The aesthetic lives in the tools, not the model.

## How It Works

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

The server maintains a persistent Three.js scene across tool calls. The LLM builds up scenes incrementally — adding geometry, adjusting materials, tweaking post-processing — and gets back rendered previews as images after each step.

**Two-phase workflow:**

1. **Tool authoring** — Pair-program with an LLM to build tools that encode your visual style (palette, shaders, proportions, export pipeline)
2. **Asset creation** — The LLM uses those custom tools to produce game assets at scale with guaranteed consistency

Change a shader parameter in one tool file, re-export everything, and the entire game stays visually coherent.

## Quick Start

### Prerequisites

- Node.js >= 20
- npm

### Install

```bash
git clone https://github.com/your-org/atelier-mcp.git
cd atelier-mcp
npm install
npx playwright install chromium
```

### Build & Run

```bash
npm run build
npm start
```

### Development

```bash
npm run build          # compile TypeScript
npm run dev            # start Vite preview server + MCP server with hot reload
npm run preview        # start only the Vite preview server
```

### Connect from an MCP Client

Add to your MCP client configuration (e.g. `.mcp.json`):

```json
{
  "mcpServers": {
    "atelier-mcp": {
      "command": "node",
      "args": ["dist/server/index.js"],
      "cwd": "/path/to/atelier-mcp"
    }
  }
}
```

## Tools

Atelier ships with ~80 built-in tools across these categories:

### Geometry

Create and manipulate 3D shapes.

| Tool | Description |
|------|-------------|
| `create_primitive` | Box, sphere, cylinder, torus, cone, plane with dimensions |
| `create_mesh` | Raw vertices + faces for custom geometry |
| `boolean_op` | Union, subtract, intersect between meshes |
| `smooth_boolean` | Boolean ops with smooth blending |
| `extrude` | Extrude a 2D profile along an axis |
| `extrude_along_path` | Extrude a profile along a curve path |
| `deform` | Bend, twist, taper, noise displacement |
| `subdivide` | Subdivision surface smoothing |
| `push_pull` | Push/pull faces on a mesh |
| `smooth_merge` | Merge meshes with smooth blending |
| `get_vertices` / `set_vertices` | Direct vertex manipulation |
| `create_morph_target` / `set_morph_influence` | Blend shape animation |
| `create_curve` / `sample_curve` / `curve_to_mesh` | Spline curves and mesh conversion |
| `create_text` | 3D text geometry |
| `analyze_mesh` | Mesh statistics and diagnostics |

### Scene

Organize and control the scene.

| Tool | Description |
|------|-------------|
| `create_group` / `add_to_group` | Hierarchical scene composition |
| `transform` | Position, rotation, scale any object |
| `clone` / `mirror` | Duplicate and mirror objects |
| `scatter` | Scatter instances across a surface |
| `align_objects` / `distribute_objects` | Layout helpers |
| `snap_to_ground` | Ground-plane alignment |
| `set_camera` | Presets (front, three_quarter, isometric) or custom |
| `save_camera` / `restore_camera` | Save and recall camera positions |
| `set_light` | Directional, ambient, point lights |
| `set_shadow` | Shadow configuration |
| `set_environment` | Environment map and background |
| `set_grid` | Grid helper visibility and sizing |
| `set_symmetry` | Mirror symmetry for modeling |
| `list_objects` / `remove_object` / `clear_scene` | Scene management |

### Materials & Textures

| Tool | Description |
|------|-------------|
| `set_material` | Color, metalness, roughness per object |
| `set_texture` / `generate_texture` | Apply or procedurally generate textures |
| `set_palette` / `apply_palette` | Define and apply color palettes |
| `generate_palette` / `extract_palette` / `palette_swap` | Palette generation and manipulation |
| `paint_vertex_colors` | Per-vertex color painting |

### Shader / Post-Processing

Scene-wide artistic treatment applied uniformly.

| Tool | Description |
|------|-------------|
| `apply_post_process` | Add to the shader chain (16 effects — see below) |
| `clear_post_process` | Reset the pipeline |
| `write_shader` | Custom GLSL fragment shaders |
| `set_uniform` | Set shader uniform values |
| `load_aesthetic` | Load preset aesthetic styles |
| `apply_style` / `list_styles` | Named style presets |

**Post-processing effects:** pixelate, cel_shade, dither, palette_quantize, outline, bloom, vignette, chromatic_aberration, film_grain, halftone, color_grade, sharpen, invert, edge_glow, crosshatch, watercolor

### Canvas / 2D

A 2D drawing layer that composites with the 3D scene.

| Tool | Description |
|------|-------------|
| `create_canvas` / `create_layer` / `blend_layers` | Canvas and layer management |
| `draw_shape` / `draw_line` / `draw_bezier` / `draw_arc` | Vector drawing |
| `draw_text` | Text rendering on canvas |
| `fill` / `set_pixel` | Pixel-level operations |
| `fill_pattern` / `fill_dither` | Pattern and dither fills |
| `set_mask` / `clear_mask` | Clip regions |
| `set_canvas_transform` / `clear_region` | Transform and erase |
| `render_to_canvas` | Stamp 3D render onto 2D canvas |

### SDF Modeling

Signed distance field modeling with marching cubes meshing.

| Tool | Description |
|------|-------------|
| `create_sdf_shape` | SDF primitives (sphere, box, cylinder, capsule, torus) |
| `sdf_combine` | Smooth union, subtract, intersect |
| `sdf_to_mesh` | Marching cubes mesh extraction |
| `mesh_to_sdf` | Convert mesh to SDF via BVH |
| `sculpt` | Sculpt brushes (smooth, pinch, crease, flatten, move) |
| `loft` | Loft between cross-sections |

### Character & Silhouette

| Tool | Description |
|------|-------------|
| `create_character_base` / `create_head` | High-level character helpers |
| `extract_silhouette` / `draw_silhouette` | Silhouette extraction and drawing |
| `render_silhouette_mask` | Mask rendering for compositing |
| `silhouette_to_mesh` | Convert 2D silhouette to 3D mesh |

### Animation

| Tool | Description |
|------|-------------|
| `create_skeleton` / `add_bone` / `skin_mesh` | Skeletal setup |
| `create_animation_clip` / `add_keyframe` | Keyframe animation |
| `play_animation` / `set_animation_frame` | Playback control |
| `pose_bone` / `reset_pose` | Posing |
| `add_constraint` / `remove_constraint` | Bone constraints |

### Procedural Generation

| Tool | Description |
|------|-------------|
| `generate_tree` | Tree generation (4 styles) |
| `generate_terrain` | Heightmap terrain |
| `generate_rock` | Rock generation |
| `generate_building` | Building generation |
| `create_tube` / `create_lathe` | Tube and lathe geometry |
| `create_variations` | Generate object variations |

### Rendering & Export

| Tool | Description |
|------|-------------|
| `render_preview` | Screenshot scene, returns image to LLM (3d/2d/composite modes) |
| `render_spritesheet` | Render rotations/frames into sprite sheet PNG |
| `render_turnaround` / `render_multi_view` | Multi-angle renders |
| `export_gltf` | Export as .glb |
| `export_metadata` | Godot .tres SpriteFrames or JSON frame data |
| `batch_export` | Bulk export |
| `bake_normal_map` / `bake_ao` | Texture baking |

### Particles

| Tool | Description |
|------|-------------|
| `create_emitter` | Create particle emitter |
| `set_emitter_param` | Configure particle parameters |

### Session & Assets

| Tool | Description |
|------|-------------|
| `save_prefab` / `load_prefab` / `list_prefabs` | Reusable prefab library |
| `save_session` / `load_session` | Session persistence |
| `import_model` | Import external 3D models |
| `undo` / `redo` | Undo/redo support |

### Scripting

| Tool | Description |
|------|-------------|
| `execute_script` | Run arbitrary JavaScript in the Three.js context |

### Custom Tools

User-created tools live in `tools/` at the project root (gitignored). Each tool is a single `.ts` file using the `defineTool()` helper:

```ts
import { defineTool } from "atelier-mcp";

export default defineTool({
  name: "my_custom_tool",
  description: "Does something custom",
  schema: { /* zod schema */ },
  execute: async (params, ctx) => {
    // compose built-in operations
  },
});
```

Tools hot-reload on file change — no server restart needed.

## Architecture

### Key Components

- **MCP Server** — Registers tools, handles tool calls, returns rendered previews as image content
- **Scene Manager** — Maintains Three.js scene state across tool calls within a session
- **Shader Pipeline** — Configurable post-processing chain applied scene-wide
- **Tool Plugin System** — File-based tools with `defineTool()` helper and hot reload
- **Preview Bridge** — Playwright controls a headless Chromium running the Three.js preview page
- **Export Pipeline** — glTF/GLB for 3D, PNG sprite sheets for 2D, optional Godot `.tres` metadata

### Directory Structure

```
atelier-mcp/
├── src/
│   ├── server/           # MCP server setup, event bus
│   ├── engine/           # Scene, palettes, shaders, animations, sessions
│   ├── bridge/           # Playwright browser bridge
│   ├── tools/
│   │   ├── builtin/      # Built-in tool registrations (~21 files)
│   │   └── plugin.ts     # Tool plugin loader, hot reload, defineTool()
│   ├── animation/        # Skeleton and animation clip registry
│   ├── plugins/          # defineTool() DSL
│   ├── types/            # Shared types, errors, events
│   └── util/             # Logger, utilities
├── preview/              # Vite app: Three.js canvas
│   ├── src/main.ts       # Entry point
│   ├── src/ctx.ts        # AtelierCtx shared context
│   ├── src/commands/     # Command modules (geometry, scene, materials, etc.)
│   └── src/utils/        # Shader pipeline, SDF, contour extraction, etc.
├── tools/                # User-created tools (gitignored)
├── tests/                # Unit + integration tests
└── palettes/             # Color palette definitions
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js >= 20, ESM |
| Language | TypeScript (strict) |
| MCP | `@modelcontextprotocol/sdk` |
| 3D Engine | Three.js |
| Browser | Playwright (headless Chromium) |
| Preview | Vite dev server |
| CSG | `three-bvh-csg` |
| Validation | Zod |
| Testing | Vitest |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Preview server + MCP server with hot reload |
| `npm start` | Start the MCP server |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:integration` | Run integration tests |
| `npm run lint` | Run ESLint |
| `npm run check` | Type-check + lint + test |
| `npm run format` | Format with Prettier |

## Design Decisions

- **Playwright over headless-gl** — Full WebGL2/WebGPU in real Chromium. The preview page doubles as a live preview you can open in your browser.
- **Three.js over Blender** — Faster iteration cycle, runs in-process, native glTF export. Blender is more powerful but too slow for the tight feedback loop this needs.
- **File-based tool plugins** — Tools are just files. Edit them directly during pair programming. No configuration beyond `defineTool()`.
- **Post-processing chain over per-material shaders** — The "look" should be scene-wide and consistent. Materials set color/roughness, the post-processing chain handles artistic treatment uniformly.
- **Stateful scene** — Objects persist across tool calls. The LLM builds up a scene incrementally, not in one shot.

## License

MIT
