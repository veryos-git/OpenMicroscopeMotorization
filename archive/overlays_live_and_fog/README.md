# Archived overlays: Live stitch + Fog-of-war

Archived 2026-08-25.

These are the two **old** live-mosaic overlays, replaced by the new
**Grow** overlay (`o_component__grow_stitch.js` + `grow_stitch.module.js` +
`grow_stitch.py`), which uses the
[`image_stitching2`](https://github.com/veryos-git/image_stitching2)
`IncrementalStitcher` (SuperPoint + SuperGlue) to grow a map frame-by-frame.

| file | what it was |
| --- | --- |
| `stitch_functions.module.js` | server side of the **Live stitch** panel (spawned `stitch.py watch`). Also contained `f_o_stitch_run`, which the **scan** panel still needs — that function lives on in the root `stitch_functions.module.js`. |
| `o_component__live_stitch.js` | the **Live stitch** client panel (capture-on-standstill). |
| `fog_of_war.module.js` | server side of the **Fog-of-war** panel (re-ran `stitch.py` over all frames). |
| `o_component__fog_of_war.js` | the **Fog-of-war** client panel (interval capture + minimap). |
| `fog_of_war.py` | the older ML incremental registration script (SuperPoint + LightGlue); was already reference-only. |

## Why they were archived

The Live stitch panel chained frame-to-frame placement (drift-prone), and the
Fog-of-war panel re-ran the all-pairs batch solve every few seconds (O(n²)).
Both are superseded by `grow_stitch.py`, which keeps one `IncrementalStitcher`
in memory and merges each frame into the accumulated map — no drift, no
re-solving the whole graph, and it rejects non-overlapping frames without
damage.
