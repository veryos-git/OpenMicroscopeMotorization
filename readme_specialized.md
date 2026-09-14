# Role & Context

You are a senior full-stack developer working on an open-source 3D-printable microscope motorization project. The stack is:

- **Backend**: Deno.js webserver
- **Frontend**: Vanilla JavaScript (served by Deno)
- **Hardware comm**: WebSocket connection to ESP32 controlling 28BYJ-48 stepper motors (X, Y, Z axes)
- **Data**: X/Y/Z position tracking already exists

# Task

Implement a **real-time minimap canvas visualization** for the microscope's XY stage movement. Think of it like a minimap in an RTS game — it provides a bird's-eye overview of the entire cartesian workspace.

# Requirements

## Core Features
1. **HTML5 Canvas minimap** that renders in the browser UI
2. **Movement trace**: Draw the path the stage center has traveled (like a breadcrumb trail)
3. **Current position indicator**: Clearly show where the stage is *right now* (e.g., crosshair, dot, or reticle)
4. **Coordinate system**: Render subtle grid lines and axis labels so the user understands scale and orientation
5. **Auto-scaling / viewport**: The minimap should adapt as the explored area grows — zoom to fit all visited positions, with some padding

## Interaction
6. **Click-to-move** (optional but desirable): Clicking a point on the minimap sends a move command to that XY coordinate
7. **Zoom controls**: Allow the user to zoom in/out of the minimap independently

## Architecture
8. Keep it **modular** — the minimap should be a self-contained component/class (e.g., `MinimapCanvas`) that receives position updates and renders independently
9. Design the trace data store so it can **later accept image tiles** — each visited position could have an associated image blob. For now, just store `{ x, y, z, timestamp }`, but leave a clear extension point like `{ x, y, z, timestamp, image?: Blob }` for future webcam stitching
10. The minimap must **not block** the main control UI — use `requestAnimationFrame` for rendering

## Style & UX
11. Dark background with a light trace line (microscopy aesthetic)
12. The minimap should be resizable or have a reasonable default size (e.g., 300×300px, expandable)
13. Show coordinate readout on hover

# Constraints
- No build tools or bundlers — vanilla JS, ES modules served directly by Deno
- Must work in modern browsers (Chrome/Firefox)
- Keep dependencies minimal (zero npm packages preferred for the frontend)
- All code should include clear comments explaining the design decisions

# Output Format
Provide:
1. The **minimap module** (JS class/module)
2. Any **CSS** needed
3. **Integration instructions** — how to wire it into the existing WebSocket message handler and UI
4. A brief **architecture note** on how image-stitching can be layered on later

Start with the minimap module code, then show integration.