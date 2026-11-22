# trees.py — the 6ixNetworks tree family, modeled in Blender.
# Run: blender -b --python trees.py
# Exports GLBs into ../assets/environment/. All original assets.
import bpy, random, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "environment")
os.makedirs(OUT, exist_ok=True)
random.seed(6)

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.92):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m

def assign(obj, material):
    obj.data.materials.append(material)

def jitter(obj, amt, seed):
    rnd = random.Random(seed)
    for v in obj.data.vertices:
        v.co.x += rnd.uniform(-amt, amt)
        v.co.y += rnd.uniform(-amt, amt)
        v.co.z += rnd.uniform(-amt * 0.6, amt * 0.6)

def shade_flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False

def export(name):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"),
                              export_format="GLB", export_apply=True, export_yup=True)
    print("EXPORTED", name)

BARK = (0.32, 0.22, 0.13)
BARK_D = (0.24, 0.16, 0.10)

def trunk(h, r0, r1, material, lean=0.0, seed=1):
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=r0, radius2=r1, depth=h,
                                        location=(lean * h * 0.5, 0, h / 2))
    t = bpy.context.active_object
    t.rotation_euler.z = lean
    jitter(t, 0.02, seed)
    assign(t, material)
    shade_flat(t)
    return t

def branch(x, y, z, tilt, ang, length, r, material):
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=r, radius2=r * 0.45, depth=length,
                                        location=(x, y, z))
    b = bpy.context.active_object
    b.rotation_euler = (math.radians(tilt) * math.cos(ang), math.radians(tilt) * math.sin(ang), 0)
    b.location.x += math.sin(math.radians(tilt)) * math.sin(ang) * length * 0.4
    b.location.z += length * 0.38
    assign(b, material)
    shade_flat(b)
    return b

def canopy_blob(x, y, z, r, material, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x, y, z))
    c = bpy.context.active_object
    jitter(c, r * 0.16, seed)
    assign(c, material)
    shade_flat(c)
    return c

# ---------- round leafy tree ----------
def round_tree():
    clean()
    bark = mat("bark", BARK); 
    leaf = mat("leaf_sage", (0.30, 0.42, 0.20))
    leaf2 = mat("leaf_sage_light", (0.38, 0.50, 0.25))
    trunk(2.1, 0.16, 0.10, bark, lean=0.03, seed=11)
    branch(0, 0, 1.5, 38, 0.6, 1.1, 0.07, bark)
    branch(0, 0, 1.7, 42, 2.8, 0.9, 0.06, bark)
    branch(0, 0, 1.9, 30, 5.0, 0.8, 0.05, bark)
    canopy_blob(0, 0, 3.1, 1.25, leaf, 21)
    canopy_blob(0.85, 0.3, 2.6, 0.85, leaf2, 22)
    canopy_blob(-0.8, -0.25, 2.7, 0.9, leaf, 23)
    canopy_blob(0.15, -0.7, 3.35, 0.75, leaf2, 24)
    canopy_blob(-0.35, 0.75, 3.3, 0.7, leaf, 25)
    export("tree_round")

# ---------- pine ----------
def pine_tree():
    clean()
    bark = mat("bark", BARK_D)
    pine = mat("pine_deep", (0.16, 0.30, 0.14))
    pine2 = mat("pine_sage", (0.24, 0.38, 0.19))
    trunk(1.6, 0.14, 0.09, bark, seed=31)
    tiers = [(1.5, 1.35, 1.9), (2.6, 1.05, 1.7), (3.6, 0.75, 1.5), (4.5, 0.45, 1.2)]
    for i, (z, r, h) in enumerate(tiers):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=r, radius2=0.06, depth=h, location=(0, 0, z + h / 2 - 0.25))
        c = bpy.context.active_object
        jitter(c, 0.05, 40 + i)
        assign(c, pine if i % 2 == 0 else pine2)
        shade_flat(c)
    export("tree_pine")

# ---------- sakura ----------
def sakura_tree():
    clean()
    bark = mat("bark", BARK)
    pink = mat("sakura", (0.96, 0.62, 0.76))
    pink2 = mat("sakura_light", (0.98, 0.74, 0.84))
    trunk(2.4, 0.20, 0.12, bark, lean=0.05, seed=51)
    branch(0, 0, 1.8, 40, 0.4, 1.3, 0.08, bark)
    branch(0, 0, 2.0, 45, 2.6, 1.1, 0.07, bark)
    branch(0, 0, 2.1, 36, 4.6, 1.0, 0.06, bark)
    canopy_blob(0, 0, 3.9, 1.7, pink, 61)
    canopy_blob(1.3, 0.5, 3.3, 1.15, pink2, 62)
    canopy_blob(-1.25, -0.4, 3.45, 1.2, pink, 63)
    canopy_blob(0.3, -1.1, 4.1, 1.0, pink2, 64)
    canopy_blob(-0.5, 1.15, 4.2, 0.95, pink, 65)
    canopy_blob(0.9, -0.9, 3.0, 0.8, pink2, 66)
    export("tree_sakura")

round_tree()
pine_tree()
sakura_tree()
print("TREES DONE")
