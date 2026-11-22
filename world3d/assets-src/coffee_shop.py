# coffee_shop.py — STAGE 01: the coffee shop exterior, properly modeled.
# Run: blender -b --python coffee_shop.py
#
# Footprint EXACTLY matches the in-game shell it replaces: 24 wide (X)
# x 14 deep, front faces -Y in Blender (= +Z in three.js), door opening
# centered at local X +7.4 (the game's door/interaction point), origin
# at ground center. Art direction: modern cozy town cafe — warm cream
# plaster, walnut timber, sage accents, charcoal-bronze frames, warm
# lit glass, terracotta gable roof, stone foundation.
import bpy, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "architecture")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------- materials ----------------
def mat(name, color, rough=0.9, metallic=0.0, emission=None, estr=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Alpha"].default_value = alpha
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = estr
    if alpha < 1.0:
        m.surface_render_method = "DITHERED"
    return m

PLASTER = mat("painted_plaster", (0.905, 0.845, 0.70), 0.88)
PLASTER2 = mat("plaster_shade", (0.845, 0.775, 0.625), 0.9)
TIMBER = mat("timber_walnut", (0.295, 0.185, 0.105), 0.8)
TIMBER_D = mat("timber_dark", (0.20, 0.125, 0.075), 0.82)
BRONZE = mat("frame_bronze", (0.16, 0.145, 0.13), 0.45, metallic=0.65)
STONE = mat("stone_foundation", (0.52, 0.475, 0.42), 0.98)
SAGE = mat("sage_accent", (0.42, 0.50, 0.36), 0.85)
DOOR_M = mat("door_painted", (0.40, 0.145, 0.115), 0.6)
BRASS = mat("brass", (0.72, 0.52, 0.22), 0.35, metallic=0.8)
GLASS = mat("glass_warm", (1.0, 0.78, 0.47), 0.12, emission=(1.0, 0.66, 0.32), estr=0.85)
GLASS_UP = mat("glass_upper", (1.0, 0.80, 0.52), 0.15, emission=(1.0, 0.70, 0.36), estr=0.6)
TERRA = mat("planter_terracotta", (0.56, 0.29, 0.19), 0.9)
SHRUB = mat("shrub_green", (0.23, 0.36, 0.17), 0.95)
CHALK = mat("chalkboard", (0.13, 0.15, 0.14), 0.92)
LAMP = mat("lamp_glow", (1.0, 0.76, 0.42), 0.4, emission=(1.0, 0.68, 0.30), estr=1.6)

# roof tiles: a small painted texture (rows of offset tiles, 2 tones)
def tile_texture():
    img = bpy.data.images.new("roof_tiles", 128, 128)
    px = []
    for y in range(128):
        row = (y // 16) % 2
        for x in range(128):
            off = 16 if row else 0
            seam = ((x + off) % 32) < 2 or (y % 16) < 2
            tone = 0.82 if ((x + off) // 32 + row) % 2 else 1.0
            r, g, b = 0.565 * tone, 0.285 * tone, 0.20 * tone
            if seam: r, g, b = r * 0.55, g * 0.55, b * 0.55
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new("roof_tiles")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m
ROOF_M = tile_texture()

# interior diorama: warm room painted on a small canvas (shelves,
# counter silhouettes, hanging lamps) seen through the storefront glass
def diorama_texture():
    img = bpy.data.images.new("cafe_interior", 256, 128)
    px = []
    for y in range(128):
        for x in range(256):
            v = y / 127.0
            r, g, b = 0.98 * (0.55 + 0.45 * v), 0.72 * (0.5 + 0.5 * v), 0.42 * (0.45 + 0.4 * v)
            # shelf bands
            if y in (84, 85, 86, 100, 101, 102): r, g, b = 0.30, 0.18, 0.10
            # jars on shelves
            if 88 <= y <= 99 and (x % 36) < 14: r, g, b = 0.55, 0.36, 0.18
            if 104 <= y <= 115 and (x % 44) < 16: r, g, b = 0.48, 0.30, 0.15
            # counter block low
            if y < 34: r, g, b = 0.36, 0.22, 0.13
            if y in (34, 35): r, g, b = 0.85, 0.76, 0.62
            # hanging lamp glows
            for lx in (48, 128, 208):
                d = ((x - lx) ** 2 + (y - 66) ** 2) ** 0.5
                if d < 9: r, g, b = 1.0, 0.85, 0.55
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new("interior_lit")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.7
    bsdf.inputs["Roughness"].default_value = 0.9
    return m
INTERIOR_M = diorama_texture()

# ---------------- helpers ----------------
def box(name, sx, sy, sz, x, y, z, material, bevel=0.0, rx=0.0, ry=0.0, rz=0.0):
    # STAGE 04 FIX: build at the origin, apply scale, THEN set location.
    # transform_apply(scale=True) in this Blender build bakes any existing
    # location into the geometry and zeroes it, so parts created at their
    # final position ended up world-baked with origin pivots - every rotated
    # part (roof slabs, canopies, arms) swung around the world origin.
    # Centered geometry + object transform = exactly one transform.
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    o.location = (x, y, z)
    o.rotation_euler = (rx, ry, rz)
    if bevel > 0:
        mod = o.modifiers.new("bev", "BEVEL"); mod.width = bevel; mod.segments = 2
    o.data.materials.append(material)
    return o

def cut(target, sx, sy, sz, x, y, z):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    c = bpy.context.active_object
    c.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"; mod.solver = "EXACT"; mod.object = c
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(c, do_unlink=True)

def prism_x(name, x0, x1, y, thick, zbase, zapex, material):
    """triangle prism (gable infill) spanning x0..x1 at depth y."""
    verts = [(x0, -thick / 2, zbase), (x1, -thick / 2, zbase), (0, -thick / 2, zapex),
             (x0, thick / 2, zbase), (x1, thick / 2, zbase), (0, thick / 2, zapex)]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (0, y, 0)
    o.data.materials.append(material)
    return o

# ---------------- shell: walls with real openings ----------------
shell = box("walls", 24, 14, 7.4, 0, 0, 0.6 + 3.7, PLASTER)
# storefront windows (front, y=-7): three large panes
for wx in (-8.4, -3.6, 1.2):
    cut(shell, 3.8, 1.2, 3.3, wx, -7.0, 1.15 + 1.65)
# upper front windows
for wx in (-6.0, 3.0):
    cut(shell, 1.7, 1.2, 1.7, wx, -7.0, 6.35)
# door opening at +7.4
cut(shell, 2.3, 1.2, 3.9, 7.4, -7.0, 0.6 + 1.95)
# side windows
for sx in (-12.0, 12.0):
    for wz in (-3.4, 3.4):
        cut(shell, 1.2, 2.6, 2.2, sx, wz, 3.6)
# back: door + window
cut(shell, 1.9, 1.2, 3.6, -5.0, 7.0, 0.6 + 1.8)
cut(shell, 2.6, 1.2, 2.0, 4.5, 7.0, 3.8)

# foundation + plinth + belt course + corner boards
box("foundation", 24.7, 14.7, 0.85, 0, 0, 0.42, STONE, bevel=0.04)
box("plinth_trim", 24.35, 14.35, 0.22, 0, 0, 0.92, TIMBER_D)
box("belt_course", 24.3, 14.3, 0.28, 0, 0, 5.02, TIMBER)
for cx in (-11.9, 11.9):
    for cy in (-6.9, 6.9):
        box("corner_board", 0.55, 0.55, 7.4, cx, cy, 4.3, TIMBER, bevel=0.03)

# ---------------- gable roof ----------------
# ridge along Y at z 12.4, eaves z 8.0 at x +-13 (1.0 overhang)
pitch = math.atan2(4.4, 13.0)
slope_len = math.hypot(13.0, 4.4) + 0.4
for sgn in (-1, 1):
    box("roof_slab", slope_len, 16.4, 0.26, sgn * 6.5, 0, 10.2, ROOF_M, ry=sgn * pitch)
box("ridge_cap", 0.5, 16.6, 0.3, 0, 0, 12.52, TIMBER_D, bevel=0.05)
# fascia along both eaves
for sgn in (-1, 1):
    box("fascia", 0.18, 16.4, 0.85, sgn * 13.05, 0, 7.85, TIMBER_D)
# gable infills (front + back) with timber framing on the front
prism_x("gable_front", -12, 12, -6.85, 0.3, 8.0, 12.4, PLASTER2)
prism_x("gable_back", -12, 12, 6.85, 0.3, 8.0, 12.4, PLASTER2)
for bx in (-6, 0, 6):
    box("gable_batten", 0.34, 0.1, 4.1, bx, -7.06, 10.1, TIMBER)
box("gable_beam", 12.5, 0.12, 0.34, 0, -7.06, 8.35, TIMBER)
# bargeboards cut: at the gable plane they read as floating planks
# against the slab overhang — the fascia trim carries the roof edge
# eaves brackets under the front overhang
for bx in (-10.5, -7, -3.5, 0, 3.5, 7, 10.5):
    box("bracket", 0.22, 0.22, 0.9, bx, -7.15, 7.62, TIMBER_D, rx=0.6)

def rail_frame(cx, cy, cz, w, h, depth_pos, mat, vertical=False):
    """4 rails around an opening — never a solid slab. depth_pos is the
    wall-plane coordinate (y for front/back walls, x for side walls)."""
    t = 0.17
    if not vertical:
        box("frame_rail", w + t, depth_pos[1], t, cx, depth_pos[0], cz + h / 2 + t / 2, mat)
        box("frame_rail", w + t, depth_pos[1], t, cx, depth_pos[0], cz - h / 2 - t / 2, mat)
        box("frame_rail", t, depth_pos[1], h, cx - w / 2 - t / 2, depth_pos[0], cz, mat)
        box("frame_rail", t, depth_pos[1], h, cx + w / 2 + t / 2, depth_pos[0], cz, mat)
    else:
        box("frame_rail", depth_pos[1], w + t, t, depth_pos[0], cx, cz + h / 2 + t / 2, mat)
        box("frame_rail", depth_pos[1], w + t, t, depth_pos[0], cx, cz - h / 2 - t / 2, mat)
        box("frame_rail", depth_pos[1], t, h, depth_pos[0], cx - w / 2 - t / 2, cz, mat)
        box("frame_rail", depth_pos[1], t, h, depth_pos[0], cx + w / 2 + t / 2, cz, mat)

# ---------------- storefront: deep frames, glass, lit interior ----------------
for wx in (-8.4, -3.6, 1.2):
    rail_frame(wx, -7.06, 2.8, 3.8, 3.3, (-7.06, 0.3), BRONZE)
    box("win_interior", 3.8, 0.06, 3.3, wx, -6.45, 2.8, INTERIOR_M)
    box("win_glass", 3.8, 0.05, 3.3, wx, -7.16, 2.8, GLASS)
    for dx in (-0.64, 0.64):
        box("win_mullion", 0.09, 0.1, 3.3, wx + dx, -7.14, 2.8, BRONZE)
    box("win_sill", 4.3, 0.5, 0.24, wx, -7.1, 1.02, STONE, bevel=0.03)
    # flower box under each storefront window
    box("flower_box", 3.4, 0.7, 0.5, wx, -7.45, 0.72, SAGE, bevel=0.04)
    for fi in range(5):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.16, location=(wx - 1.3 + fi * 0.65, -7.45, 1.05))
        f = bpy.context.active_object; f.name = "flower"
        f.data.materials.append(mat("flower_pink", (0.95, 0.55, 0.68), 0.9) if fi % 2 else mat("flower_cream", (0.96, 0.90, 0.75), 0.9))
# upper windows: frames + warm glass + shutters
for wx in (-6.0, 3.0):
    rail_frame(wx, -7.05, 6.35, 1.7, 1.7, (-7.05, 0.26), BRONZE)
    box("up_glass", 1.7, 0.05, 1.7, wx, -7.14, 6.35, GLASS_UP)
    box("up_sill", 2.15, 0.4, 0.2, wx, -7.08, 5.28, TIMBER_D)
    for sgn in (-1, 1):
        box("shutter", 0.62, 0.08, 1.9, wx + sgn * 1.35, -7.1, 6.35, SAGE, bevel=0.02)
# side + back windows: frames and glass
for sx in (-12.0, 12.0):
    for wz in (-3.4, 3.4):
        rail_frame(wz, sx, 3.6, 2.6, 2.2, (sx, 0.26), BRONZE, vertical=True)
        box("side_glass", 0.05, 2.6, 2.2, sx * 1.005, wz, 3.6, GLASS_UP)
rail_frame(4.5, 7.05, 3.8, 2.6, 2.0, (7.05, 0.26), BRONZE)
box("back_glass", 2.6, 0.05, 2.0, 4.5, 7.14, 3.8, GLASS_UP)
box("back_door", 1.9, 0.12, 3.6, -5.0, 7.02, 2.4, TIMBER_D, bevel=0.02)

# ---------------- entrance: recessed porch, door, lanterns ----------------
box("porch_beam", 4.6, 0.3, 0.35, 7.4, -8.15, 4.62, TIMBER_D, bevel=0.03)
for px in (5.35, 9.45):
    box("porch_post", 0.24, 0.24, 4.0, px, -8.15, 2.6, TIMBER, bevel=0.03)
    box("post_base", 0.4, 0.4, 0.5, px, -8.15, 0.85, STONE, bevel=0.03)
# porch canopy: small sloped roof echoing the main gable
can = box("porch_canopy", 5.2, 2.2, 0.16, 7.4, -7.85, 5.15, ROOF_M)
can.rotation_euler = (0.42, 0, 0)
box("door_frame", 2.7, 0.26, 4.3, 7.4, -7.04, 2.55, TIMBER_D, bevel=0.03)
box("door_leaf", 2.15, 0.1, 3.75, 7.4, -7.1, 2.42, DOOR_M, bevel=0.02)
box("door_glass", 1.15, 0.04, 1.5, 7.4, -7.17, 3.0, GLASS)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.075, location=(6.62, -7.22, 2.35))
knob = bpy.context.active_object; knob.name = "door_knob"; knob.data.materials.append(BRASS)
box("door_step", 3.6, 1.7, 0.22, 7.4, -7.75, 0.71, STONE, bevel=0.03)
# STAGE 04: ground stair under the porch landing (rises 0.32 -> 0.60 -> 0.82).
box("stair_a", 3.4, 2.1, 0.32, 7.4, -8.05, 0.16, STONE, bevel=0.02)
box("stair_b", 3.0, 1.6, 0.32, 7.4, -7.85, 0.44, STONE, bevel=0.02)
# lanterns flanking the door + at the storefront ends
for lx in (5.35, 9.45, -11.2, 3.6):
    box("lantern_cap", 0.24, 0.24, 0.09, lx, -7.22, 3.82, BRONZE)
    box("lantern_arm", 0.06, 0.3, 0.06, lx, -7.1, 3.9, BRONZE)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.085, location=(lx, -7.26, 3.62))
    lm = bpy.context.active_object; lm.name = "lantern_glow"; lm.data.materials.append(LAMP)

# ---------------- the sign: modeled board + raised letters ----------------
box("sign_board", 8.4, 0.22, 1.6, 0, -7.5, 7.0, TIMBER_D, bevel=0.05)
box("sign_trim", 8.6, 0.26, 0.14, 0, -7.48, 7.86, BRASS)
box("sign_trim", 8.6, 0.26, 0.14, 0, -7.48, 6.14, BRASS)
for bx in (-3.4, 3.4):
    box("sign_bracket", 0.12, 0.7, 0.9, bx, -7.25, 7.95, BRONZE, rx=0.5)
box("sign_glow", 8.2, 0.05, 0.07, 0, -7.6, 6.05, LAMP)

def make_sign_text(body_text):
    td = bpy.data.curves.new("signtext", "FONT")
    td.body = body_text
    td.size = 1.02
    td.extrude = 0.055
    td.bevel_depth = 0.012
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = bpy.data.objects.new("sign_text", td)
    bpy.context.collection.objects.link(o)
    o.location = (0, -7.66, 7.0)
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    dec = o.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.32; dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
    o.data.materials.append(mat("sign_cream", (0.96, 0.90, 0.76), 0.5))
    return len(o.data.vertices)

verts = make_sign_text("STARLIGHT CAFÉ")
if verts < 100:  # fallback if the accented glyph is missing
    print("SIGN FALLBACK, verts:", verts)

# ---------------- outdoor details ----------------
# planters flanking the entrance
for px in (4.35, 10.45):
    box("planter", 1.5, 0.85, 0.68, px, -7.7, 0.34, TERRA, bevel=0.05)
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.5, radius2=0.12, depth=0.85, location=(px, -7.7, 1.0))
    sh = bpy.context.active_object; sh.name = "planter_shrub"; sh.data.materials.append(SHRUB)
# A-frame chalkboard by the door
af1 = box("aframe", 0.95, 0.08, 1.25, 3.1, -8.35, 1.15, TIMBER_D); af1.rotation_euler = (0.28, 0.35, 0)
af2 = box("aframe_board", 0.8, 0.03, 1.05, 3.16, -8.42, 1.18, CHALK); af2.rotation_euler = (0.28, 0.35, 0)
# drainpipe at the back-right corner
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.07, depth=7.6, location=(12.25, 6.6, 4.4))
dp = bpy.context.active_object; dp.name = "drainpipe"; dp.data.materials.append(BRONZE)

# ---------------- join static parts per material ----------------
# one mesh per material = far fewer draw calls; parts are static and
# share transforms, so joining loses nothing.
from collections import defaultdict
groups = defaultdict(list)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and len(o.data.materials) == 1 and o.data.materials[0]:
        groups[o.data.materials[0].name].append(o)
for mname, objs in groups.items():
    if len(objs) < 2: continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = "joined_" + mname


# STAGE 04: bake world transforms into the joined meshes before export.
# A joined group keeps its first part's frame as its node transform, and
# that frame does not survive the glTF round trip when it is rotated -
# the roof groups landed swung in-game while Blender showed them correct.
# World-baked verts + identity nodes are loader-exact.
bpy.context.view_layer.update()
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.startswith("joined_"):
        o.data.transform(o.matrix_world)
        o.location = (0, 0, 0)
        o.rotation_euler = (0, 0, 0)
        o.scale = (1, 1, 1)

# ---------------- stats + export ----------------
tris = 0; meshes = 0
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        meshes += 1
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
print("STATS tris:", tris, "meshes:", meshes, "materials:", len(bpy.data.materials))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "coffee_shop.glb"),
                          export_format="GLB", export_apply=True, export_yup=True)
print("EXPORTED coffee_shop v2")
