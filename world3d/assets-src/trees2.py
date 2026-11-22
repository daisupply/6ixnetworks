# trees2.py — STAGE 10: two more tree models for the west forest.
# Run: blender -b --python trees2.py
# tree_tall: a tall layered pine. tree_broad: a broad oak-style tree.
# Origin at ground center, Blender units = world units.
import bpy, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "trees")
os.makedirs(OUT, exist_ok=True)

def mat(name, color, rough=0.95):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    return m

def finish(fname):
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
    print("STATS", fname, "tris:", tris, "meshes:", meshes)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname),
                              export_format="GLB", export_apply=True, export_yup=True)
    print("EXPORTED", fname)

# ---------------- tree_tall: layered pine ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
TRUNK = mat("tall_trunk", (0.30, 0.20, 0.12))
CAN = mat("tall_canopy", (0.16, 0.30, 0.14))
CAN2 = mat("tall_canopy_light", (0.22, 0.38, 0.18))
bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.17, depth=3.4, location=(0, 0, 1.7))
t = bpy.context.active_object; t.name = "trunk"; t.data.materials.append(TRUNK)
for i, (r, h, z) in enumerate([(1.55, 2.3, 3.6), (1.18, 2.0, 5.1), (0.78, 1.8, 6.5)]):
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=r, radius2=0.06, depth=h, location=(0, 0, z))
    c = bpy.context.active_object; c.name = "canopy"; c.data.materials.append(CAN if i % 2 == 0 else CAN2)
finish("tree_tall.glb")

# ---------------- tree_broad: oak-style ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
TRUNK = mat("broad_trunk", (0.33, 0.23, 0.14))
CAN = mat("broad_canopy", (0.24, 0.40, 0.18))
CAN2 = mat("broad_canopy_light", (0.32, 0.48, 0.22))
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.34, depth=2.3, location=(0, 0, 1.15))
t = bpy.context.active_object; t.name = "trunk"; t.data.materials.append(TRUNK)
for dx, dz, ln in [(0.7, 0.2, 1.3), (-0.6, 0.5, 1.2), (0.1, -0.7, 1.1)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.13, depth=ln, location=(dx / 2, dz / 2, 2.3 + ln / 3))
    b = bpy.context.active_object; b.name = "branch"
    b.rotation_euler = (dz * 0.7, -dx * 0.7, 0)
    b.data.materials.append(TRUNK)
blobs = [(0, 0, 4.3, 1.75), (1.15, 0.4, 3.7, 1.25), (-1.1, 0.5, 3.8, 1.2),
         (0.4, -1.0, 3.9, 1.15), (-0.5, -0.9, 3.6, 1.05), (0.1, 0.9, 4.9, 1.1)]
for i, (x, y, z, r) in enumerate(blobs):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x, y, z))
    c = bpy.context.active_object; c.name = "canopy"
    for v in c.data.vertices:
        v.co.x *= 1.0; v.co.y *= 0.88; v.co.z *= 0.82
    c.data.materials.append(CAN if i % 2 == 0 else CAN2)
finish("tree_broad.glb")
