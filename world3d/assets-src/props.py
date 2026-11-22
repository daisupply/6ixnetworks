# props.py — STAGE 07: street prop models (bench + mailbox).
# Run: blender -b --python props.py
# Local coords match the procedural props they replace:
#  bench: 2.6 long on X, seat top y .62, back toward -Z, origin ground center.
#  mailbox: post + box, origin at ground center, flag on +X.
import bpy, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "environment")
os.makedirs(OUT, exist_ok=True)

def mat(name, color, rough=0.9, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    return m

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
    print("STATS", fname, "tris:", tris, "meshes:", meshes, "materials:", len(bpy.data.materials))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname),
                              export_format="GLB", export_apply=True, export_yup=True)
    print("EXPORTED", fname)

# ---------------- bench ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
WOOD = mat("bench_wood", (0.42, 0.27, 0.15), 0.8)
WOOD_D = mat("bench_wood_dark", (0.28, 0.175, 0.10), 0.82)
IRON = mat("bench_iron", (0.13, 0.125, 0.14), 0.5, metallic=0.6)
# seat slats (3, with gaps) + back slats (2, tilted)
for i, dz in enumerate((-0.28, 0.0, 0.28)):
    box("seat_slat", 2.6, 0.07, 0.24, 0, dz, 0.60, WOOD, bevel=0.02)
for i, dy in enumerate((0.0, 0.34)):
    b = box("back_slat", 2.6, 0.07, 0.26, 0, -0.44 - dy * 0.28, 1.02 + dy, WOOD, bevel=0.02)
    b.rotation_euler = (-0.16, 0, 0)
# iron side frames: leg pairs + armrests
for sx in (-1.18, 1.18):
    box("leg_f", 0.09, 0.09, 0.62, sx, 0.18, 0.31, IRON)
    box("leg_b", 0.09, 0.09, 0.95, sx, -0.30, 0.47, IRON, rx=0.0)
    arm = box("armrest", 0.09, 0.75, 0.07, sx, 0.02, 0.92, WOOD_D, bevel=0.02)
    arm.rotation_euler = (0.1, 0, 0)
    box("arm_post", 0.07, 0.07, 0.34, sx, 0.28, 0.72, IRON)
    box("crossbar", 0.07, 0.6, 0.07, sx, 0.0, 0.06, IRON)
finish("bench.glb")

# ---------------- mailbox ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
POST_M = mat("mail_post", (0.30, 0.20, 0.12), 0.85)
BLUE = mat("mail_blue", (0.16, 0.30, 0.45), 0.45, metallic=0.35)
BLUE_D = mat("mail_blue_dark", (0.11, 0.21, 0.33), 0.5, metallic=0.35)
RED = mat("mail_flag_red", (0.72, 0.16, 0.14), 0.55)
box("post", 0.13, 0.13, 1.1, 0, 0, 0.55, POST_M, bevel=0.02)
box("post_cross", 0.5, 0.09, 0.08, 0, 0, 1.02, POST_M)
box("box_body", 0.85, 0.5, 0.42, 0, 0, 1.28, BLUE, bevel=0.03)
bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.25, depth=0.85, location=(0, 0, 1.49))
tp = bpy.context.active_object; tp.name = "box_top"
tp.rotation_euler = (0, 0, math.radians(90))
tp.data.materials.append(BLUE)
box("door", 0.06, 0.44, 0.5, 0.45, 0, 1.32, BLUE_D)
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.045, location=(0.5, 0, 1.32))
kb = bpy.context.active_object; kb.name = "mail_knob"; kb.data.materials.append(RED)
box("flag_arm", 0.05, 0.05, 0.4, 0.47, 0.2, 1.5, RED)
box("flag", 0.05, 0.16, 0.22, 0.47, 0.2, 1.78, RED)
finish("mailbox.glb")
