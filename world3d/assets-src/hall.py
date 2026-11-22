# hall.py — STAGE 05: the 6IXNETWORKS grand hall exterior, modeled.
# Run: blender -b --python hall.py
#
# Footprint EXACTLY matches the in-game shell: 30 wide (X) x 16 deep,
# front faces -Y in Blender (= +Z in three.js), origin at ground
# center. Identity: the crown-gold landmark — cream stone, columns,
# pediment with a gold crown, tall arched windows glowing warm,
# slate hip roof. No door interaction exists for the hall (landmark
# shell); the modeled door is visual, exactly like the procedural one.
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

CREAM = mat("hall_stone", (0.87, 0.815, 0.70), 0.85)
CREAM2 = mat("hall_stone_shade", (0.79, 0.73, 0.615), 0.88)
STONE = mat("stone_foundation", (0.52, 0.475, 0.42), 0.98)
WALNUT = mat("walnut_dark", (0.24, 0.15, 0.09), 0.75)
GOLD = mat("crown_gold", (0.85, 0.63, 0.22), 0.32, metallic=0.85)
BRONZE = mat("frame_bronze", (0.16, 0.145, 0.13), 0.45, metallic=0.65)
GLASS = mat("glass_warm", (1.0, 0.79, 0.48), 0.12, emission=(1.0, 0.67, 0.33), estr=0.8)
SLATE = mat("roof_slate", (0.235, 0.23, 0.29), 0.9)
TERRA = mat("planter_terracotta", (0.56, 0.29, 0.19), 0.9)
SHRUB = mat("shrub_green", (0.23, 0.36, 0.17), 0.95)
LAMP = mat("lamp_glow", (1.0, 0.76, 0.42), 0.4, emission=(1.0, 0.68, 0.30), estr=1.6)
DARK = mat("door_recess", (0.08, 0.06, 0.05), 0.95)

def hall_texture():
    img = bpy.data.images.new("hall_interior", 256, 128)
    px = []
    for y in range(128):
        for x in range(256):
            v = y / 127.0
            r, g, b = 0.95 * (0.5 + 0.5 * v), 0.74 * (0.45 + 0.5 * v), 0.40 * (0.4 + 0.45 * v)
            if x % 64 < 10: r, g, b = 0.42, 0.30, 0.16  # columns
            if y < 26: r, g, b = 0.38, 0.25, 0.12        # floor band
            for lx in (42, 128, 214):                    # chandelier glows
                d = ((x - lx) ** 2 + (y - 88) ** 2) ** 0.5
                if d < 10: r, g, b = 1.0, 0.86, 0.55
                if d < 4: r, g, b = 1.0, 0.95, 0.75
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
INTERIOR_M = hall_texture()

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

def cyl(name, r, depth, x, y, z, material, verts=14):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
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

def cut_arch(target, cx, y, w, zbase, hrect, vertical=False):
    """arched opening: rect + half-cylinder cap. y is the wall plane
    coord (front/back) unless vertical (side walls: cx is z, y is x)."""
    r = w / 2
    if not vertical:
        cut(target, w, 1.4, hrect, cx, y, zbase + hrect / 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=1.4, location=(cx, y, zbase + hrect))
        c = bpy.context.active_object
        c.rotation_euler = (math.radians(90), 0, 0)
        mod = target.modifiers.new("cut", "BOOLEAN")
        mod.operation = "DIFFERENCE"; mod.solver = "EXACT"; mod.object = c
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="cut")
        bpy.data.objects.remove(c, do_unlink=True)
    else:
        cut(target, 1.4, w, hrect, y, cx, zbase + hrect / 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=1.4, location=(y, cx, zbase + hrect))
        c = bpy.context.active_object
        c.rotation_euler = (0, math.radians(90), 0)
        mod = target.modifiers.new("cut", "BOOLEAN")
        mod.operation = "DIFFERENCE"; mod.solver = "EXACT"; mod.object = c
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="cut")
        bpy.data.objects.remove(c, do_unlink=True)

def rail_frame(cx, plane, cz, w, h, depth, mat, vertical=False):
    t = 0.18
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

def arch_glass(cx, plane, cz, w, hrect, inset, vertical=False):
    """warm glass filling an arched opening: rect + half-disc."""
    if not vertical:
        box("arch_glass", w, 0.06, hrect, cx, plane + inset, cz + hrect / 2, GLASS)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=w / 2, depth=0.06, location=(cx, plane + inset, cz + hrect))
        c = bpy.context.active_object; c.name = "arch_glass_cap"
        c.rotation_euler = (math.radians(90), 0, 0)
        c.data.materials.append(GLASS)
    else:
        box("arch_glass", 0.06, w, hrect, plane + inset, cx, cz + hrect / 2, GLASS)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=w / 2, depth=0.06, location=(plane + inset, cx, cz + hrect))
        c = bpy.context.active_object; c.name = "arch_glass_cap"
        c.rotation_euler = (0, math.radians(90), 0)
        c.data.materials.append(GLASS)

# ---------------- shell with arched openings ----------------
shell = box("walls", 30, 16, 10.5, 0, 0, 0.9 + 5.25, CREAM)
FRONT = -8.0
for wx in (-12.5, -6.0, 6.0, 12.5):
    cut_arch(shell, wx, FRONT, 2.6, 1.6, 3.9)
cut(shell, 3.6, 1.4, 5.6, 0, FRONT, 0.9 + 2.8)          # door opening
for sx in (-15.0, 15.0):
    for wz in (-4.6, 0.0, 4.6):
        cut_arch(shell, wz, sx, 2.2, 2.0, 3.2, vertical=True)
for wx in (-8.0, 8.0):
    cut_arch(shell, wx, 8.0, 2.2, 2.0, 3.2)
cut(shell, 2.0, 1.4, 3.8, 0, 8.0, 0.9 + 1.9)            # back door

# foundation + steps + cornice + parapet
box("foundation", 30.7, 16.7, 0.9, 0, 0, 0.45, STONE, bevel=0.04)
box("step1", 11.0, 1.6, 0.3, 0, -8.8, 0.15, STONE)
box("step2", 10.0, 1.0, 0.3, 0, -8.5, 0.45, STONE)
box("step3", 9.2, 0.55, 0.3, 0, -8.25, 0.75, STONE)
box("cornice", 30.5, 16.5, 0.55, 0, 0, 11.65, CREAM2, bevel=0.04)
box("belt", 30.3, 16.3, 0.3, 0, 0, 6.4, CREAM2)

# ---------------- portico: columns, entablature, pediment ----------------
for cx in (-9.0, -3.0, 3.0, 9.0):
    box("col_base", 1.5, 1.5, 0.5, cx, -9.7, 1.15, STONE)
    cyl("column", 0.52, 7.3, cx, -9.7, 4.95, CREAM, verts=16)
    box("col_cap", 1.4, 1.4, 0.4, cx, -9.7, 8.75, CREAM2)
box("entablature", 26.0, 1.5, 1.25, 0, -9.7, 9.55, CREAM2, bevel=0.04)
# pediment: triangular prism over the center
verts = [(-8.5, -0.65, 10.15), (8.5, -0.65, 10.15), (0, -0.65, 13.1),
         (-8.5, 0.65, 10.15), (8.5, 0.65, 10.15), (0, 0.65, 13.1)]
faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
me = bpy.data.meshes.new("pediment")
me.from_pydata(verts, [], faces)
ped = bpy.data.objects.new("pediment", me)
bpy.context.collection.objects.link(ped)
ped.location = (0, -9.7, 0)
ped.data.materials.append(CREAM)

# gold crown emblem on the pediment face
crown_pts = [(-1.15, -0.55), (-1.15, 0.38), (-0.64, -0.02), (0.0, 0.58), (0.64, -0.02), (1.15, 0.38), (1.15, -0.55)]
cv = [(x, 0, z) for (x, z) in crown_pts]
bv = [(x, -0.3, z) for (x, z) in crown_pts]
verts = cv + bv
n = len(crown_pts)
faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
for i in range(n):
    j = (i + 1) % n
    faces.append((i, j, n + j, n + i))
me = bpy.data.meshes.new("crown")
me.from_pydata(verts, [], faces)
cr = bpy.data.objects.new("crown", me)
bpy.context.collection.objects.link(cr)
cr.location = (0, -10.42, 11.55)
cr.data.materials.append(GOLD)

# ---------------- gable roof (slate prism, ridge along Y) + gold trim ----------------
# STAGE 04: the old 4-slab hip approximation could never close its corners
# (front slabs 24.5 long on a 30-wide building) and the box() pivot bug had
# swung the slabs around the world origin. This prism derives the roof from
# the wall box exactly: base = footprint + 0.9 overhang per side, resting on
# the cornice (top 11.92), apex on the center line. The portico pediment
# stands proud of its front triangle.
_hw, _hd, _base, _apex = 15.0 + 0.9, 8.0 + 0.9, 11.85, 15.3
_verts = [(-_hw, -_hd, _base), (_hw, -_hd, _base), (0, -_hd, _apex),
          (-_hw, _hd, _base), (_hw, _hd, _base), (0, _hd, _apex)]
_faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
_me = bpy.data.meshes.new("gable_roof")
_me.from_pydata(_verts, [], _faces)
_roof = bpy.data.objects.new("gable_roof", _me)
bpy.context.collection.objects.link(_roof)
_roof.data.materials.append(SLATE)
box("ridge_gold", 0.2, 17.9, 0.2, 0, 0, 15.42, GOLD)
for fy in (-8.95, 8.95):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.26, location=(0, fy, 15.42))
    fn = bpy.context.active_object; fn.name = "finial"; fn.data.materials.append(GOLD)

# ---------------- windows: frames, glass, lit interior ----------------
for wx in (-12.5, -6.0, 6.0, 12.5):
    rail_frame(wx, FRONT - 0.06, 1.6 + 1.95, 2.6, 3.9, 0.3, BRONZE)
    arch_glass(wx, FRONT, 1.6, 2.6, 3.9, 0.1)
    box("win_interior", 2.6, 0.06, 5.2, wx, FRONT + 0.75, 1.6 + 2.6, INTERIOR_M)
    box("win_sill", 3.1, 0.5, 0.24, wx, FRONT - 0.12, 1.45, STONE)
for sx in (-15.0, 15.0):
    sgn = 1 if sx > 0 else -1
    for wz in (-4.6, 0.0, 4.6):
        rail_frame(wz, sx + sgn * 0.06, 2.0 + 1.6, 2.2, 3.2, 0.3, BRONZE, vertical=True)
        arch_glass(wz, sx, 2.0, 2.2, 3.2, -sgn * 0.1, vertical=True)
for wx in (-8.0, 8.0):
    rail_frame(wx, 8.06, 2.0 + 1.6, 2.2, 3.2, 0.3, BRONZE)
    arch_glass(wx, 8.0, 2.0, 2.2, 3.2, -0.1)

# ---------------- the great door (visual) + lanterns + planters ----------------
box("door_recess", 3.6, 0.3, 5.6, 0, FRONT + 0.3, 0.9 + 2.8, DARK)
for sgn in (-1, 1):
    d = box("door_leaf", 1.65, 0.14, 5.2, sgn * 0.86, FRONT - 0.05, 0.9 + 2.6, WALNUT, bevel=0.03)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.09, location=(sgn * 0.22, FRONT - 0.2, 3.4))
    kb = bpy.context.active_object; kb.name = "door_knob"; kb.data.materials.append(GOLD)
box("door_fanlight", 3.0, 0.06, 0.8, 0, FRONT - 0.02, 6.15, GLASS)
for lx in (-2.7, 2.7):
    box("lantern_cap", 0.26, 0.26, 0.1, lx, FRONT - 0.25, 5.6, BRONZE)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.09, location=(lx, FRONT - 0.3, 5.38))
    lm = bpy.context.active_object; lm.name = "lantern_glow"; lm.data.materials.append(LAMP)
for px in (-7.6, 7.6):
    box("planter", 1.7, 0.95, 0.72, px, -9.6, 0.36, TERRA, bevel=0.05)
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.55, radius2=0.13, depth=0.95, location=(px, -9.6, 1.1))
    sh = bpy.context.active_object; sh.name = "planter_shrub"; sh.data.materials.append(SHRUB)

# ---------------- the sign: modeled board + raised gold letters ----------------
box("sign_board", 13.5, 0.22, 1.7, 0, -10.55, 9.55, WALNUT, bevel=0.05)
box("sign_trim", 13.7, 0.26, 0.14, 0, -10.53, 10.45, GOLD)
box("sign_trim", 13.7, 0.26, 0.14, 0, -10.53, 8.65, GOLD)

def make_sign_text(body_text):
    td = bpy.data.curves.new("signtext", "FONT")
    td.body = body_text
    td.size = 1.12
    td.extrude = 0.055
    td.bevel_depth = 0.012
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = bpy.data.objects.new("sign_text", td)
    bpy.context.collection.objects.link(o)
    o.location = (0, -10.72, 9.55)
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    dec = o.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.32; dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
    o.data.materials.append(GOLD)
    return len(o.data.vertices)

verts = make_sign_text("6IXNETWORKS")
if verts < 100:
    print("SIGN FALLBACK, verts:", verts)

# ---------------- join static parts per material ----------------
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
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "hall.glb"),
                          export_format="GLB", export_apply=True, export_yup=True)
print("EXPORTED hall v1")
