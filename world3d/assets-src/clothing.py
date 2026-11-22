# clothing.py — STAGE 06: the Clothing Co. exterior, modeled.
# Run: blender -b --python clothing.py
#
# Footprint EXACTLY matches the in-game shell: 24 wide (X) x 14 deep,
# front faces -Y in Blender (= +Z in three.js), door opening centered
# at local X +7.44 (the game's door/interaction point for the clothing
# interior), origin at ground center. Identity: a fashion boutique —
# sage + cream walls, big display windows with mannequin silhouettes,
# a striped canvas awning over the storefront, hanging sign, window
# boxes, warm teal + brass accents. Distinct from the cafe next door.
import bpy, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "architecture")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

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

CREAM = mat("boutique_cream", (0.93, 0.885, 0.78), 0.88)
SAGE = mat("sage_panels", (0.475, 0.565, 0.425), 0.85)
SAGE_D = mat("sage_dark", (0.345, 0.43, 0.315), 0.85)
TIMBER = mat("timber_walnut", (0.295, 0.185, 0.105), 0.8)
TIMBER_D = mat("timber_dark", (0.20, 0.125, 0.075), 0.82)
BRONZE = mat("frame_bronze", (0.16, 0.145, 0.13), 0.45, metallic=0.65)
BRASS = mat("brass", (0.72, 0.52, 0.22), 0.35, metallic=0.8)
STONE = mat("stone_foundation", (0.52, 0.475, 0.42), 0.98)
GLASS = mat("glass_warm", (1.0, 0.80, 0.50), 0.12, emission=(1.0, 0.68, 0.34), estr=0.75)
TEAL = mat("awning_teal", (0.10, 0.33, 0.315), 0.9)
TEAL_L = mat("awning_teal_light", (0.85, 0.87, 0.80), 0.9)
TERRA = mat("planter_terracotta", (0.56, 0.29, 0.19), 0.9)
SHRUB = mat("shrub_green", (0.23, 0.36, 0.17), 0.95)
LAMP = mat("lamp_glow", (1.0, 0.76, 0.42), 0.4, emission=(1.0, 0.68, 0.30), estr=1.6)
SIGN_M = mat("sign_sage", (0.16, 0.24, 0.20), 0.7)

def boutique_texture():
    img = bpy.data.images.new("boutique_interior", 256, 128)
    px = []
    for y in range(128):
        for x in range(256):
            v = y / 127.0
            r, g, b = 0.96 * (0.52 + 0.48 * v), 0.80 * (0.48 + 0.5 * v), 0.55 * (0.44 + 0.48 * v)
            # clothing rails
            if y in (58, 59): r, g, b = 0.35, 0.26, 0.18
            if 30 <= y <= 57 and (x % 30) < 15:
                tone = ((x // 30) % 3)
                r, g, b = [(0.62, 0.30, 0.28), (0.30, 0.38, 0.55), (0.55, 0.48, 0.30)][tone]
            # mannequin silhouettes
            for mx in (52, 128, 204):
                if abs(x - mx) < 7 and 62 <= y <= 112: r, g, b = 0.30, 0.24, 0.20
                if abs(x - mx) < 11 and 100 <= y <= 112: r, g, b = 0.30, 0.24, 0.20
            if y < 20: r, g, b = 0.42, 0.32, 0.22
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new("interior_lit")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.65
    bsdf.inputs["Roughness"].default_value = 0.9
    return m
INTERIOR_M = boutique_texture()

def stripe_texture():
    img = bpy.data.images.new("awning_stripes", 128, 32)
    px = []
    for y in range(32):
        for x in range(128):
            if (x // 16) % 2: r, g, b = 0.85, 0.87, 0.80
            else: r, g, b = 0.10, 0.33, 0.315
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new("awning_stripes")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    return m
AWN_M = stripe_texture()

def tile_texture():
    img = bpy.data.images.new("roof_tiles", 128, 128)
    px = []
    for y in range(128):
        row = (y // 16) % 2
        for x in range(128):
            off = 16 if row else 0
            seam = ((x + off) % 32) < 2 or (y % 16) < 2
            tone = 0.82 if ((x + off) // 32 + row) % 2 else 1.0
            r, g, b = 0.42 * tone, 0.40 * tone, 0.34 * tone
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

# ---------------- helpers ----------------
def box(name, sx, sy, sz, x, y, z, material, bevel=0.0, rx=0.0, ry=0.0, rz=0.0):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
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

def rail_frame(cx, plane, cz, w, h, depth, mat, vertical=False):
    t = 0.16
    if not vertical:
        box("frame_rail", w + t, depth, t, cx, plane, cz + h / 2 + t / 2, mat)
        box("frame_rail", w + t, depth, t, cx, plane, cz - h / 2 - t / 2, mat)
        box("frame_rail", t, depth, h, cx - w / 2 - t / 2, plane, cz, mat)
        box("frame_rail", t, depth, h, cx + w / 2 + t / 2, plane, cz, mat)
    else:
        box("frame_rail", depth, w + t, t, plane, cx, cz + h / 2 + t / 2, mat)
        box("frame_rail", depth, w + t, t, plane, cx, cz - h / 2 - t / 2, mat)
        box("frame_rail", depth, t, h, plane, cx - w / 2 - t / 2, cz, mat)
        box("frame_rail", depth, t, h, plane, cx + w / 2 + t / 2, cz, mat)

# ---------------- shell ----------------
shell = box("walls", 24, 14, 7.6, 0, 0, 0.6 + 3.8, CREAM)
# two big display windows (front), door at +7.44
for wx in (-7.6, -1.4):
    cut(shell, 4.6, 1.2, 3.6, wx, -7.0, 0.9 + 1.8)
cut(shell, 2.3, 1.2, 4.0, 7.44, -7.0, 0.6 + 2.0)
# upper front windows x3
for wx in (-7.5, 0.0, 7.5):
    cut(shell, 1.8, 1.2, 1.8, wx, -7.0, 6.6)
# side windows
for sx in (-12.0, 12.0):
    for wz in (-3.4, 3.4):
        cut(shell, 1.2, 2.6, 2.2, sx, wz, 3.8)
# back window + door
cut(shell, 2.6, 1.2, 2.0, -4.0, 7.0, 3.8)
cut(shell, 1.9, 1.2, 3.6, 5.0, 7.0, 0.6 + 1.8)

# foundation + sage panel band + corner boards
box("foundation", 24.7, 14.7, 0.85, 0, 0, 0.42, STONE, bevel=0.04)
box("sage_band", 24.3, 14.3, 1.5, 0, 0, 1.6, SAGE, bevel=0.02)
box("belt", 24.3, 14.3, 0.26, 0, 0, 5.55, SAGE_D)
for cx in (-11.9, 11.9):
    for cy in (-6.9, 6.9):
        box("corner_board", 0.5, 0.5, 7.6, cx, cy, 4.4, SAGE_D, bevel=0.03)

# ---------------- roof: shallow gable, sage-grey tiles ----------------
pitch = math.atan2(3.4, 13.0)
slope_len = math.hypot(13.0, 3.4) + 0.4
for sgn in (-1, 1):
    r = box("roof_slab", slope_len, 16.4, 0.24, sgn * 6.5, 0, 9.9, ROOF_M)
    r.rotation_euler = (0, sgn * pitch, 0)
    r.location = (sgn * 6.35, 0, 9.98)
box("ridge_cap", 0.45, 16.6, 0.28, 0, 0, 11.62, TIMBER_D, bevel=0.05)
for sgn in (-1, 1):
    box("fascia", 0.18, 16.4, 0.8, sgn * 13.05, 0, 7.95, SAGE_D)
verts = [(-12, -0.15, 8.2), (12, -0.15, 8.2), (0, -0.15, 11.5),
         (-12, 0.15, 8.2), (12, 0.15, 8.2), (0, 0.15, 11.5)]
faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
me = bpy.data.meshes.new("gable")
me.from_pydata(verts, [], faces)
for yy in (-6.85, 6.85):
    gb = bpy.data.objects.new("gable", me)
    bpy.context.collection.objects.link(gb)
    gb.location = (0, yy, 0)
    gb.data.materials.append(SAGE)

# ---------------- storefront: display windows + awning ----------------
for wx in (-7.6, -1.4):
    rail_frame(wx, -7.06, 0.9 + 1.8, 4.6, 3.6, 0.3, BRONZE)
    box("win_glass", 4.6, 0.05, 3.6, wx, -7.13, 0.9 + 1.8, GLASS)
    box("win_interior", 4.6, 0.06, 3.6, wx, -6.4, 0.9 + 1.8, INTERIOR_M)
    box("win_mullion", 0.09, 0.06, 3.6, wx, -7.17, 0.9 + 1.8, BRONZE)
    box("win_box", 4.9, 0.55, 0.5, wx, -7.3, 0.62, TERRA, bevel=0.04)
    for fx in (-1.8, -0.6, 0.6, 1.8):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.16, radius2=0.03, depth=0.4, location=(wx + fx, -7.3, 1.05))
        fl = bpy.context.active_object; fl.name = "win_flower"; fl.data.materials.append(SHRUB)
# the long striped awning over both display windows
awn = box("awning", 13.4, 2.2, 0.1, -4.5, -7.9, 5.1, AWN_M)
awn.rotation_euler = (0.5, 0, 0)
for bx in (-10.6, -4.5, 1.6):
    box("awn_arm", 0.07, 1.9, 0.07, bx, -7.55, 4.6, BRONZE, rx=0.5)
# upper windows: frames + glass + sage shutters
for wx in (-7.5, 0.0, 7.5):
    rail_frame(wx, -7.05, 6.6, 1.8, 1.8, 0.26, BRONZE)
    box("up_glass", 1.8, 0.05, 1.8, wx, -7.13, 6.6, GLASS)
    for sgn in (-1, 1):
        box("shutter", 0.55, 0.06, 1.8, wx + sgn * 1.25, -7.08, 6.6, SAGE)
# side + back windows
for sx in (-12.0, 12.0):
    sgn = 1 if sx > 0 else -1
    for wz in (-3.4, 3.4):
        rail_frame(wz, sx + sgn * 0.05, 3.8, 2.6, 2.2, 0.26, BRONZE, vertical=True)
        box("side_glass", 0.05, 2.6, 2.2, sx + sgn * 0.12, wz, 3.8, GLASS)
rail_frame(-4.0, 7.05, 3.8, 2.6, 2.0, 0.26, BRONZE)
box("back_glass", 2.6, 0.05, 2.0, -4.0, 7.13, 3.8, GLASS)

# ---------------- entrance: framed sage door + step + lanterns ----------------
box("door_frame_top", 2.9, 0.35, 0.3, 7.44, -7.1, 4.75, SAGE_D)
for sgn in (-1, 1):
    box("door_frame_side", 0.3, 0.35, 4.2, 7.44 + sgn * 1.3, -7.1, 2.7, SAGE_D)
door = box("door_leaf", 2.3, 0.12, 4.0, 7.44, -7.05, 0.6 + 2.0, SAGE_D, bevel=0.03)
box("door_glass", 1.1, 0.05, 1.7, 7.44, -7.14, 3.3, GLASS)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.075, location=(6.55, -7.2, 2.6))
kb = bpy.context.active_object; kb.name = "door_knob"; kb.data.materials.append(BRASS)
box("door_step", 3.4, 1.1, 0.28, 7.44, -7.6, 0.42, STONE)
for lx in (5.3, 9.6):
    box("lantern_cap", 0.24, 0.24, 0.09, lx, -7.24, 4.35, BRONZE)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.085, location=(lx, -7.28, 4.14))
    lm = bpy.context.active_object; lm.name = "lantern_glow"; lm.data.materials.append(LAMP)
# planters flanking the storefront
for px in (-11.3, 3.4):
    box("planter", 1.5, 0.85, 0.68, px, -7.7, 1.0, TERRA, bevel=0.05)
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.5, radius2=0.12, depth=0.85, location=(px, -7.7, 1.75))
    sh = bpy.context.active_object; sh.name = "planter_shrub"; sh.data.materials.append(SHRUB)

# ---------------- hanging sign: sage board, cream letters ----------------
box("sign_board", 9.6, 0.2, 1.55, -1.5, -7.55, 7.35, SIGN_M, bevel=0.05)
box("sign_trim", 9.8, 0.24, 0.13, -1.5, -7.53, 8.16, BRASS)
box("sign_trim", 9.8, 0.24, 0.13, -1.5, -7.53, 6.54, BRASS)
box("sign_glow", 9.4, 0.05, 0.07, -1.5, -7.65, 6.42, LAMP)

def make_sign_text(body_text):
    td = bpy.data.curves.new("signtext", "FONT")
    td.body = body_text
    td.size = 1.0
    td.extrude = 0.055
    td.bevel_depth = 0.012
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = bpy.data.objects.new("sign_text", td)
    bpy.context.collection.objects.link(o)
    o.location = (-1.5, -7.71, 7.35)
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    dec = o.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.32; dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
    o.data.materials.append(mat("sign_cream", (0.96, 0.92, 0.80), 0.5))
    return len(o.data.vertices)

verts = make_sign_text("CLOTHING CO.")
if verts < 100:
    print("SIGN FALLBACK, verts:", verts)

# ---------------- join + stats + export ----------------
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

tris = 0; meshes = 0
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        meshes += 1
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
print("STATS tris:", tris, "meshes:", meshes, "materials:", len(bpy.data.materials))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "clothing.glb"),
                          export_format="GLB", export_apply=True, export_yup=True)
print("EXPORTED clothing v1")
