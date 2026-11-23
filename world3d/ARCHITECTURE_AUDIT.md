# Architecture Audit — Stage 04 (2026-11-22)

Method: (1) source inspection of every builder script + client construction code;
(2) automated geometry validation at the source level (`validate_src.py`);
(3) **decisive**: per-part world-space bounding boxes measured in the running
game via the real GLTFLoader (`probe-parts.mjs`, 61 asset swaps, 0 page errors).
Blender-side pre-join checks proved unreliable for transformed parts (see D1),
so every defect below is confirmed by in-game measurement, not by script reading.

## Inventory (all existing buildings)

| Building | Position | Footprint | Walls top | Roof | Door point | Interior |
|---|---|---|---|---|---|---|
| Coffee Shop (GLB) | (-36,-44) | 24×14 | 8.0 | gable, ridge ∥Y | (-28.6,-35.0) | café (2000,±9) |
| 6IXNETWORKS Hall (GLB) | (0,-50) | 30×16 | 10.5 | 4-slab hip approx | visual only | none |
| Clothing Co. (GLB) | (36,-44) | 24×14 | 8.2 | gable, ridge ∥Y | (43.4,-35.0) | clothing (2080,±9) |
| Arcade (GLB) | (-62,-52) | 26×16 | 12.2 | hip pyramid | (-62,-42.8) | arcade (2040,±9) |
| Library (GLB) | (58,-54) | 26×16 | 12.2 | hip pyramid + porch | (58,-44.8) | library (2120,±9) |
| Apartments (GLB) | (-64,46) | 22×13 | 9.2 | gable, ridge ∥Y | (-64,38.3) | apt (2200,±9) |
| Rec Center (GLB) | (62,48) | 22×13 | 9.2 | hip pyramid | (62,40.3) | rec (2160,±9) |
| 6IX Music (GLB) | (0,-80) | 30×14 | 8.2 | hip pyramid | (0,-72.6) | none |
| Houses ×3 (GLB) | (-108,-28) ry.5, (-116,6) ry.9, (-104,40) ry.25 | 11×9 | 5.5 | gable, ridge ∥X | visual | none |
| Gazebo / Wishing Well | plaza (0,0) area | r9.5 posts | — | cone | — | — |
| Interiors ×6 | x 1990–2210 bands | 22×18 rooms | — | roomShell ceilings | warp pairs | — |

## Defects confirmed by in-game measurement

### D1 — ROOT CAUSE: rotated parts pivot around the world origin (CRITICAL)
Every builder script's `box()` helper creates the cube at its final position,
sets dimensions, then calls `transform_apply(scale=True)`. In this Blender
build (4.2.3) that apply **bakes the location into the geometry and zeroes the
object location** (proven by isolated reproduction). Any rotation set after —
via `box(rx/ry/rz)` or a post-hoc `rotation_euler =` line — therefore rotates
the part around the WORLD ORIGIN instead of its own center. Parts whose
centers sit far from the origin swing wildly; parts near it look almost right,
which is why this survived four stages of screenshot review.

### D2 — Coffee shop roof exploded (from D1)
In-game: `joined_roof_tiles` spans x 48.2 (building: 24), y **−7.4..29.4**
(should be 7.9..12.5). Slabs + porch canopy swung around the origin; sections
dive below ground and others float ~17 units above the ridge. The gable
infills (from_pydata, identity transform) are correct at y 8.0..12.4 — the
roof surface simply isn't on them.

### D3 — Clothing Co. roof exploded (from D1)
In-game: `joined_roof_tiles` x span 43.8, y 5.4..27.0 (should top at ~11.6).

### D4 — Hall roof misplaced (from D1)
In-game: `joined_roof_slate` x span 24.6 (building 30 wide), y 9.7..22.5
(should be ~10.5..15.5). The 4-slab hip approximation also cannot close its
corners even with correct pivots (front slabs 24.5 long vs 30-wide building).

### D5 — Apartments + house gable roofs exploded (from D1)
Apartments `joined_roof_apartments` y −0.1..16.3 (should be 9.1..12.3);
houses `joined_roof_house` y −0.8..14.5 (should be 5.4..8.5), all 3 houses.

### D6 — Library porch canopy swung (from D1)
Library `joined_roof_library` (pyramid + canopy in one material group) spans
y 0.4..18.8; the pyramid itself is exact (same construction as arcade/rec/
music, verified correct), the rotated-box porch canopy is the outlier.

### D7 — Planters float 0.66–0.69 above ground (EVERY building)
`planter()` in all four scripts places the box center at z 1.0–1.05 with
height 0.68–0.72 → bottom edge at 0.66–0.69. In-game confirmation:
`joined_planter_terracotta` y 0.7..1.3 at coffee, clothing, hall, arcade,
library, apartments, rec, music, and all 3 houses. The shrub cones sit
correctly relative to the planters, so the pairs float together, masked at
ground level by grass and foundation faces.

### D8 — Small rotated fittings misplaced (from D1)
Marquee/canopy support arms (`rx=0.5`), coffee eaves brackets (`rx=0.6`),
coffee A-frame chalkboard, clothing awning arms — all rotated around the
origin; displacements of ~0.5–2.5 units on small parts.

## Verified CORRECT in-game (no action)
- Hip pyramid roofs: arcade (y 12.2..15.6, spans exact), rec (9.2..12.0),
  music (8.2..10.8) — from_pydata, identity transforms.
- All walls (bases 0.6 on foundations 0..~1.1), all door leaves (y 0.5..4.3,
  aligned with their frames and the server door points), all signs (proud of
  the facade, above door heads), all window glass/frames within wall bands.
- Gable infills everywhere; apartments balconies (slab tops 5.85 vs upper
  sills 5.90); hall columns on their bases; door steps embedded in
  foundations with tops at sill level.

## Fixes applied (Stage 04) + validation evidence

1. **`box()` helper rebuilt in all 4 architecture scripts** (the CKPT2
   coordinate fix + the spec's Part-11 component rule): parts are created at
   the origin, scale-applied, THEN located/rotated — one exact transform,
   rotations pivot on the part's own center. Broken-regime eyeball nudges
   (coffee/clothing slab location overrides) removed; the districts gable
   slab center is now derived: (W/2 + overhang)/2.
2. **Joined meshes are world-baked before export** (`o.data.transform(
   o.matrix_world)` + identity node): a joined group otherwise keeps its
   first part's rotated frame, which the glTF round trip does not preserve —
   Blender showed the roofs correct while the game rendered them swung.
3. **Hall roof replaced**: the 4-slab hip approximation (corner gaps by
   construction) is now an exact from_pydata gable prism — base = footprint
   + 0.9/side resting on the cornice (11.85), apex 15.3, ridge along Y
   behind the portico pediment, gold ridge bar + ridge-end finials.
4. **Planters grounded** in all 4 scripts (center z 1.0–1.05 → 0.34–0.36;
   shrubs reseated on the planter tops).
5. **Real entrance stairs**: districts + houses + coffee gained 2-step
   ground stairs (rises 0.32/0.28/landing); clothing gained its ground
   step; hall's existing 3×0.30 stair verified correct. The stage-12
   procedural door slabs + duplicate planters were removed from
   `buildEntrances` (the GLBs carry both now).
6. **Fences**: two rails per run tie the residential pickets together.
7. **Chimneys**: placed in each house's local (rotated) frame on the back
   slope, base embedded, stone cap on top; the floating porch glow dots
   were deleted (the GLB bracket lantern is the porch light).
8. **Interiors**: rec pool-table body extended to the floor and into its
   rail; rec sofas gained plinth bases + backrests. A rest-height census
   of all 6 interiors flagged 57 meshes — every other flag resolved as a
   joined-mesh part (chair seats over separate leg meshes), hanging
   garments, plant foliage on pots, or NPC rig parts.
9. **Bus stop**: bench gained legs (it floated unsupported).

**In-game re-measurement after fixes (probe-parts, 61 swaps, 0 errors):**
coffee roof y 4.6..12.6 ✓ (was −7.4..29.4) · clothing roof y 8..11.8 ✓
(was 5.4..27) · hall prism y 11.9..15.3, x ±15.9 ✓ · apartments roof
y 4.6..12.5 ✓ (canopy + ridge) · library roof y 4.6..15.6 ✓ · houses
y 3.5..8.7 ✓ · planters y 0..0.7 at all 11 buildings ✓ · coffee
timber_dark below-ground tail gone (0.4..12.7) · hip pyramids unchanged ✓.
Source validator re-run: planter flags zero everywhere; remaining flags
are documented exceptions (landing steps embedded in foundations, balcony
rail tops vs sills, hall columns on their bases, gable beam on the gable
face, hall prism base on the cornice). Smoke: ALL PASS.

## Client-side (procedural) items audited
- Stage-12 entrance dressing adds a stone step at each district door where
  the GLB already has one → doubled, intersecting steps (fix: remove the
  procedural steps, keep mats/planters/lantern posts).
- Residential picket fences: posts grounded on the plateau but NO rails —
  reads as disconnected sticks (fix: two rails per run).
- Stage-12 house chimneys: center y 6.4, top ~7.2 vs roof slope ~7.76 at
  their z offset → buried inside the roof (fix: raise to emerge).
- Interiors: furniture rest-height census runs with the CKPT8 pass.

## V578 correction — residential house roof was inverted (2026-11-23)

The Stage-04 re-measurement above ("houses y 3.5..8.7 ✓") is
**superseded as roof evidence**: it checked height BOUNDS only,
and a valley roof has the same bounds as a gable roof. The house
main roof in the shipped house.glb was in fact inverted — both
slabs formed a butterfly/valley roof. Measured on the exported
GLB itself (roof_house vertices): inner edge (near ridge line)
maxY 5.56, outer edge (eaves) maxY 8.65 — eaves at ridge height,
ridge line at wall top, ridge cap floating ~2.9 above the valley.

Root cause: districts.py house roof used
`r.rotation_euler = (sgn * pitch, 0, 0)`, copying the sign pattern
of the district/coffee gables. Those slope across X with a Y
rotation (z' = -x*sin, far edge falls). The house slabs slope
across Y with an X rotation (z' = +y*sin, far edge rises) — the
same signed pattern inverts. Fix: one sign,
`r.rotation_euler = (-sgn * pitch, 0, 0)`, dimensions unchanged.
The porch roof (Y rotation) and the district, coffee and
clothing gables (Y rotation) were simulated and are CORRECT as
written; hall gable and all hip roofs are exact from_pydata
geometry. Do not "unify" these signs.

Corrected measurements (fixed asset): source simulation, GLB
vertices, and in-game world-space vertices at all three houses
(yaws 0.5 / 0.9 / 0.25) agree — inner 8.65, outer 5.56 on both
halves of every house. Ridge cap (y 8.44..8.72, x ±6.3) now
meets the slab tops at the ridge; gable apex 8.40 matches the
roof profile; eaves at y 5.56 overhang the walls (face ±4.5) by
~1.08. Client chimneys (local 2.6, -1.2, span y 6.6..8.4 + cap)
verified against the corrected slope: roof surface there is
7.99, so the base is embedded and the top emerges — the
"buried chimney" note above was written against the inverted
roof and no longer applies. Standing gate: world3d/tests/
roof.test.mjs asserts slope DIRECTION from the source
parameters, the exported GLB, and the porch — run it after any
roof change; bounds checks alone do not count.
