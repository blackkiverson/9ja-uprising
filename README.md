# 9ja: Naija Uprising

Browser-based open-world simulation of Nigeria. Three.js, TypeScript, Vite. Currently building **Prototype 0.1: First Month in Lagos**.

## Run

```
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
npm test           # rules tests
npm run typecheck
npm run build
```

## Controls

| Input | Action |
|---|---|
| Click / tap | Walk to point |
| WASD / arrow keys | Walk (screen-relative; camera never rotates) |
| Space | Jump |
| Mouse wheel / pinch / `+` `-` | Zoom |

## Layout

| Path | What |
|---|---|
| `packages/shared` | Game rules with no rendering: save object, world clock, `applyAction`. Runs in browser now, on the server later. |
| `packages/client` | Three.js client: toon shading, fixed angled camera, click-to-move, HUD. |
| `packages/server` | Placeholder. Colyseus multiplayer after 0.1. |
| `assets/blender` | Blender source files (Git LFS). Export GLB to `packages/client/public/models`. |

## Key decisions

- **Time:** GTA Online model. One shared world clock (1 game day = 48 real minutes); energy and progress are personal. Sleep restores energy and advances your personal day; it never skips world time.
- **Rules live in `shared`:** every state change goes through `applyAction`, so the server can validate the same actions when multiplayer lands.
- **Outlines:** inverted hull rather than a post-processing pass, for mid-range phone performance.
- **World:** generated from a fixed seed (`scene/world.ts`), so every player gets the same Surulere. Leafy suburb compounds in the west blend into the commercial strip in the east. Vegetation is instanced and buildings are merged per building to keep draw calls low.
- **Art pipeline:** Blender with flat colours, export GLB, toon material and outline applied at runtime.
