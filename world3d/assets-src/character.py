# character.py — the rigged 6ixNetworks character (original asset).
# Run: blender -b --python character.py
# A low-poly stylized figure (~2.06 units tall, matching the game's
# avatar proportions) with a real armature, skinned meshes, and two
# exported animation clips: "idle" (breathing/sway) and "walk"
# (leg/arm swing cycle). Materials are named slots (body/skin/trim)
# so the client can recolor the body per-player hue at runtime.
import bpy, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "characters")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m

M_BODY = mat("body", (0.45, 0.35, 0.85))   # recolored per-player at runtime
M_SKIN = mat("skin", (0.91, 0.71, 0.55))
M_TRIM = mat("trim", (0.13, 0.11, 0.20))
M_HAIR = mat("hair", (0.16, 0.10, 0.08))

# ---------------- armature ----------------
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head = head; b.tail = tail
    if parent: b.parent = eb[parent]
    return b
# Blender Z is up; character faces -Y... exported facing +Z in three.
bone("hips", (0, 0, 1.02), (0, 0, 1.22))
bone("spine", (0, 0, 1.22), (0, 0, 1.52), "hips")
bone("head", (0, 0, 1.56), (0, 0, 1.86), "spine")
bone("arm.L", (-0.24, 0, 1.50), (-0.62, 0, 1.06), "spine")
bone("arm.R", (0.24, 0, 1.50), (0.62, 0, 1.06), "spine")
bone("leg.L", (-0.13, 0, 1.00), (-0.15, 0, 0.06), "hips")
bone("leg.R", (0.13, 0, 1.00), (0.15, 0, 0.06), "hips")
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------- skinned body parts ----------------
def part(sx, sy, sz, x, y, z, material, bone_name, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    o = bpy.context.active_object
    o.dimensions = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new("bev", "BEVEL"); mod.width = bevel; mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="bev")
    o.data.materials.append(material)
    vg = o.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
    am = o.modifiers.new("arm", "ARMATURE"); am.object = arm
    o.parent = arm
    return o

part(0.46, 0.26, 0.20, 0, 0, 1.12, M_TRIM, "hips")          # pelvis/shorts
part(0.50, 0.28, 0.34, 0, 0, 1.38, M_BODY, "spine")         # torso (body color)
part(0.34, 0.20, 0.10, 0, 0.0, 1.60, M_SKIN, "spine")       # neck base
part(0.36, 0.34, 0.40, 0, 0, 1.78, M_SKIN, "head")          # head
part(0.38, 0.36, 0.14, 0, 0.01, 2.00, M_HAIR, "head")       # hair cap
for sgn, bn in ((-1, "arm.L"), (1, "arm.R")):
    # upper arm + forearm + hand as one skinned piece along the bone
    part(0.15, 0.15, 0.52, sgn * 0.43, 0, 1.28, M_BODY, bn)  # arm (sleeve = body)
    part(0.13, 0.13, 0.16, sgn * 0.60, 0, 1.02, M_SKIN, bn)  # hand
for sgn, bn in ((-1, "leg.L"), (1, "leg.R")):
    part(0.19, 0.20, 0.55, sgn * 0.14, 0, 0.72, M_TRIM, bn)  # thigh
    part(0.16, 0.17, 0.42, sgn * 0.145, 0, 0.26, M_SKIN, bn) # shin
    part(0.17, 0.26, 0.09, sgn * 0.15, -0.04, 0.045, M_TRIM, bn)  # shoe

# ---------------- animation clips ----------------
def set_rot(bone_name, frame, rx=0.0, ry=0.0, rz=0.0):
    pb = arm.pose.bones[bone_name]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (rx, ry, rz)
    pb.keyframe_insert("rotation_euler", frame=frame)

def set_loc(bone_name, frame, z):
    pb = arm.pose.bones[bone_name]
    pb.location = (0, 0, z)
    pb.keyframe_insert("location", frame=frame)

scene = bpy.context.scene
scene.render.fps = 24

# idle: 48 frames, gentle breathing + sway (loop)
act = bpy.data.actions.new("idle")
arm.animation_data_create(); arm.animation_data.action = act
D = math.radians
for f, ph in ((1, 0), (24, 1), (48, 0)):
    s = math.sin(ph * math.pi)
    set_rot("spine", f, rx=D(2.2) * s)
    set_rot("arm.L", f, rz=D(3) * s, rx=D(2) * s)
    set_rot("arm.R", f, rz=D(-3) * s, rx=D(2) * s)
    set_rot("head", f, ry=D(4) * (s - 0.5))
    set_loc("hips", f, 0.008 * s)
scene.frame_start, scene.frame_end = 1, 48
arm.animation_data.action = None

# walk: 24 frames, full stride cycle (loop)
act2 = bpy.data.actions.new("walk")
arm.animation_data.action = act2
for f in (1, 7, 13, 19, 24):
    ph = (f - 1) / 23.0 * 2 * math.pi
    sl = math.sin(ph)
    set_rot("leg.L", f, rx=D(34) * sl)
    set_rot("leg.R", f, rx=D(-34) * sl)
    set_rot("arm.L", f, rx=D(-28) * sl)
    set_rot("arm.R", f, rx=D(28) * sl)
    set_rot("spine", f, rx=D(3))
    set_loc("hips", f, 0.03 * abs(math.cos(ph)))
scene.frame_start, scene.frame_end = 1, 24

# stash both actions as NLA-ready exports (fake users so both survive)
for a in (act, act2):
    a.use_fake_user = True
arm.animation_data.action = act

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "character.glb"),
                          export_format="GLB", export_apply=True, export_yup=True,
                          export_animations=True, export_animation_mode="ACTIONS")
print("EXPORTED character with clips:", [a.name for a in (act, act2)])
