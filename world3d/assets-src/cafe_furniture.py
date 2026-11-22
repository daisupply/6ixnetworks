# cafe_furniture.py — modeled café set for the 3D coffee shop.
# Run: blender -b --python cafe_furniture.py
# Pieces are modeled at real scale (meters = world units), origin at
# ground center, chair/sofa face +Z... (Blender -Y front exports to +Z
# in three.js with export_yup; pieces are symmetric enough that the
# client rotations from the old build carry over.)
import bpy, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "furniture")
os.makedirs(OUT, exist_ok=True)

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m

def box(sx, sy, sz, x, y, z, material, bevel=0.0, rz=0.0):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    o = bpy.context.active_object
    o.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    o.rotation_euler.z = rz
    if bevel > 0:
        mod = o.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    o.data.materials.append(material)
    return o

def cyl(r1, r2, h, x, y, z, material, verts=18):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=(x, y, z))
    o = bpy.context.active_object
    o.data.materials.append(material)
    return o

def export(name):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"),
                              export_format="GLB", export_apply=True, export_yup=True)
    print("EXPORTED", name)

WOOD = (0.36, 0.23, 0.13)
WOOD_L = (0.48, 0.32, 0.18)
DARK = (0.16, 0.11, 0.08)

# ---------- table: beveled round top, turned pedestal ----------
def table():
    clean()
    wood = mat("wood", WOOD); woodl = mat("wood_light", WOOD_L)
    cyl(0.58, 0.58, 0.07, 0, 0, 0.9, woodl, 24)          # top slab
    cyl(0.62, 0.62, 0.03, 0, 0, 0.855, wood, 24)         # edge band
    cyl(0.07, 0.10, 0.78, 0, 0, 0.45, wood, 12)          # pedestal
    cyl(0.30, 0.34, 0.05, 0, 0, 0.03, wood, 20)          # base disc
    export("cafe_table")

# ---------- chair: legs, slatted back, seat ----------
def chair():
    clean()
    wood = mat("wood", WOOD); woodl = mat("wood_light", WOOD_L)
    for dx in (-0.21, 0.21):
        for dy in (-0.21, 0.21):
            box(0.055, 0.055, 0.55, dx, dy, 0.275, wood)
    box(0.52, 0.52, 0.06, 0, 0, 0.56, woodl, bevel=0.02)  # seat
    box(0.52, 0.05, 0.34, 0, -0.245, 0.86, wood, bevel=0.015)  # back top rail
    box(0.44, 0.035, 0.09, 0, -0.245, 0.70, woodl)       # back slat
    export("cafe_chair")

# ---------- sofa: cushions + arms, beveled ----------
def sofa():
    clean()
    fabric = mat("fabric_plum", (0.36, 0.24, 0.34), 0.98)
    fabric2 = mat("fabric_plum_light", (0.43, 0.29, 0.40), 0.98)
    wood = mat("wood_dark", DARK)
    box(1.9, 0.85, 0.42, 0, 0, 0.32, fabric, bevel=0.05)          # base
    box(0.88, 0.78, 0.16, -0.46, 0.02, 0.62, fabric2, bevel=0.05) # seat cushions
    box(0.88, 0.78, 0.16, 0.46, 0.02, 0.62, fabric2, bevel=0.05)
    box(0.88, 0.16, 0.62, -0.46, -0.36, 0.86, fabric, bevel=0.05)  # back cushions
    box(0.88, 0.16, 0.62, 0.46, -0.36, 0.86, fabric, bevel=0.05)
    box(0.2, 0.85, 0.34, -1.02, 0, 0.62, fabric, bevel=0.06)       # arms
    box(0.2, 0.85, 0.34, 1.02, 0, 0.62, fabric, bevel=0.06)
    for dx in (-0.95, 0.95):
        for dy in (-0.32, 0.32):
            box(0.07, 0.07, 0.12, dx, dy, 0.06, wood)
    export("cafe_sofa")

# ---------- counter: panelled front + stone top ----------
def counter():
    clean()
    wood = mat("wood", WOOD); woodl = mat("wood_light", WOOD_L)
    stone = mat("stone_top", (0.82, 0.76, 0.66), 0.5)
    box(11.2, 1.4, 1.08, 0, 0, 0.54, wood)                       # body
    for i in range(9):                                            # front slats
        box(0.09, 0.06, 0.86, -4.9 + i * 1.22, 0.73, 0.55, woodl)
    box(11.5, 1.62, 0.07, 0, 0, 1.115, stone, bevel=0.02)         # top slab
    box(11.2, 1.4, 0.1, 0, 0, 0.05, mat("wood_dark", DARK))       # kick plate
    export("cafe_counter")

# ---------- espresso machine ----------
def espresso():
    clean()
    steel = mat("steel", (0.62, 0.64, 0.68), 0.35)
    darkm = mat("machine_dark", (0.10, 0.10, 0.12), 0.5)
    accent = mat("accent_brass", (0.72, 0.52, 0.22), 0.4)
    box(1.15, 0.5, 0.52, 0, 0, 0.30, steel, bevel=0.04)           # body
    box(1.2, 0.54, 0.05, 0, 0, 0.575, darkm)                      # cup tray
    box(1.05, 0.44, 0.03, 0, 0, 0.045, darkm)                     # drip tray
    for dx in (-0.28, 0.28):                                      # group heads + handles
        box(0.16, 0.12, 0.10, dx, 0.24, 0.22, darkm)
        cyl(0.028, 0.028, 0.30, dx + 0.16, 0.33, 0.20, accent, 8).rotation_euler.y = 1.1
    cyl(0.015, 0.015, 0.34, -0.62, 0.10, 0.26, steel, 8).rotation_euler.x = 0.5  # steam wand
    box(0.30, 0.06, 0.16, 0, -0.20, 0.52, accent)                 # top dial plate
    export("espresso")

table(); chair(); sofa(); counter(); espresso()
print("CAFE FURNITURE DONE")
