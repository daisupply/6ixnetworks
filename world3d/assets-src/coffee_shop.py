# coffee_shop.py — the coffee shop exterior, modeled as an
# architecture kit build in Blender: boolean-cut window/door
# openings, framed glass, hip roof with trim, awning, planters.
# Run: blender -b --python coffee_shop.py
# Footprint matches the in-game shell it replaces: 24 wide (X),
# 14 deep, walls 10.5 high. Front faces -Y in Blender (= +Z in
# three.js after export). The door opening sits at local X +7.4,
# matching the game's door point. Origin: ground center.
import bpy, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "architecture")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.9, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    return m

CREAM = mat("painted_cream", (0.90, 0.83, 0.68))
TRIM = mat("trim_walnut", (0.30, 0.19, 0.11))
ROOFM = mat("roof_terracotta", (0.55, 0.28, 0.19))
GLASS = mat("glass_warm", (0.98, 0.80, 0.52), 0.25)
GLASS.inputs if False else None
# make the glass glow like lit windows: emission via node tree
nt = GLASS.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Emission Color"].default_value = (1.0, 0.72, 0.38, 1.0)
bsdf.inputs["Emission Strength"].default_value = 0.55
AWN = mat("awning_stripe", (0.62, 0.22, 0.20))
AWN2 = mat("awning_cream", (0.92, 0.86, 0.72))
STONE = mat("stone_base", (0.55, 0.49, 0.42))

def box(sx, sy, sz, x, y, z, material, bevel=0.0, rz=0.0, rx=0.0):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    o = bpy.context.active_object
    o.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    o.rotation_euler.z = rz
    o.rotation_euler.x = rx
    if bevel > 0:
        mod = o.modifiers.new("bev", "BEVEL"); mod.width = bevel; mod.segments = 2
    o.data.materials.append(material)
    return o

def cut(target, sx, sy, sz, x, y, z):
    """boolean-difference a hole in target using a temp cutter box."""
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    c = bpy.context.active_object
    c.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    c.display_type = "WIRE"
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = c
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(c, do_unlink=True)

# ---- main shell with real openings ----
shell = box(24, 14, 10.5, 0, 0, 5.25, CREAM)
# front (y=-7) openings: door at x +7.4, three shop windows
cut(shell, 2.2, 1.0, 4.6, 7.4, -7.0, 2.3)                    # door
for wx in (-8.2, -3.4, 1.4):
    cut(shell, 3.6, 1.0, 3.4, wx, -7.0, 3.1)                 # windows
# side windows (x faces)
for wz in (-3.5, 3.5):
    cut(shell, 1.0, 3.2, 2.6, -12.0, wz, 3.4)
    cut(shell, 1.0, 3.2, 2.6, 12.0, wz, 3.4)
# back door
cut(shell, 1.8, 1.0, 4.0, -5.0, 7.0, 2.0)

# stone base + cornice trim
box(24.5, 14.5, 0.7, 0, 0, 0.35, STONE, bevel=0.05)
box(24.6, 14.6, 0.5, 0, 0, 10.35, TRIM, bevel=0.04)
box(24.4, 14.4, 0.35, 0, 0, 9.6, TRIM)

# ---- window frames + glass (front) ----
for wx in (-8.2, -3.4, 1.4):
    box(3.9, 0.18, 3.7, wx, -7.02, 3.1, TRIM)                # frame block (behind glass)
    box(3.6, 0.06, 3.4, wx, -7.12, 3.1, GLASS)               # pane
    box(0.14, 0.1, 3.4, wx, -7.1, 3.1, TRIM)                 # mullion
    box(4.1, 0.5, 0.22, wx, -7.05, 1.28, TRIM)               # sill
for wz in (-3.5, 3.5):
    for sx in (-12.0, 12.0):
        box(0.18, 3.5, 2.9, sx, wz, 3.4, TRIM)
        box(0.06, 3.2, 2.6, sx * 1.005, wz, 3.4, GLASS)

# ---- the door: framed, with a real leaf + step ----
box(2.6, 0.2, 5.0, 7.4, -7.05, 2.5, TRIM)                    # frame
box(2.0, 0.09, 4.4, 7.4, -6.98, 2.2, mat("door_red", (0.48, 0.16, 0.14)), bevel=0.02)
box(1.2, 0.05, 1.6, 7.4, -7.04, 3.1, GLASS)                  # door window
box(3.4, 1.6, 0.24, 7.4, -7.7, 0.12, STONE, bevel=0.04)      # step

# ---- hip roof: 4-sided cone squashed + ridge + trim ----
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=19.5, radius2=0.5, depth=4.6, location=(0, 0, 12.6))
roof = bpy.context.active_object
roof.rotation_euler.z = 0.785398
roof.scale = (1.0, 0.72, 1.0)
bpy.ops.object.transform_apply(scale=True)
roof.data.materials.append(ROOFM)
box(3.2, 0.5, 0.4, 0, 0, 14.95, TRIM)                        # ridge cap

# ---- awning over the front windows: striped slabs ----
for i, wx in enumerate((-8.2, -3.4, 1.4)):
    box(4.4, 2.0, 0.12, wx, -7.9, 5.35, AWN if i % 2 == 0 else AWN2, rx=-0.5)
box(11.0, 2.0, 0.12, 7.4, -7.9, 5.6, AWN2, rx=-0.5)          # door canopy

# ---- planters flanking the door ----
for px in (4.6, 10.2):
    box(1.6, 0.9, 0.7, px, -7.6, 0.35, mat("planter_terracotta", (0.58, 0.30, 0.20)), bevel=0.05)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.55, location=(px, -7.6, 0.95))
    sh = bpy.context.active_object
    sh.data.materials.append(mat("shrub", (0.25, 0.38, 0.18)))

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "coffee_shop.glb"),
                          export_format="GLB", export_apply=True, export_yup=True)
print("EXPORTED coffee_shop")
