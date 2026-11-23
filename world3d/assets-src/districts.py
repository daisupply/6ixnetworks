# districts.py — CP7: modeled exteriors for the five district buildings
# + the residential house. Run: blender -b --python districts.py
#
# Every footprint EXACTLY matches the in-game shell it replaces; doors
# are CENTERED on the front face (the game's district door points);
# origin at ground center; front faces -Y in Blender (= +Z in three).
# South buildings (apartments, rec) are rotated PI by the client holder.
import bpy, os, math
from collections import defaultdict

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "architecture")
os.makedirs(OUT, exist_ok=True)

def mat(name, color, rough=0.9, metallic=0.0, emission=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = estr
    return m

def tile_texture(name, base):
    img = bpy.data.images.new(name, 128, 128)
    px = []
    for y in range(128):
        row = (y // 16) % 2
        for x in range(128):
            off = 16 if row else 0
            seam = ((x + off) % 32) < 2 or (y % 16) < 2
            tone = 0.82 if ((x + off) // 32 + row) % 2 else 1.0
            r, g, b = base[0] * tone, base[1] * tone, base[2] * tone
            if seam: r, g, b = r * 0.55, g * 0.55, b * 0.55
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m

def diorama_texture(name, warm):
    img = bpy.data.images.new(name, 256, 128)
    px = []
    for y in range(128):
        for x in range(256):
            v = y / 127.0
            r, g, b = warm[0] * (0.5 + 0.5 * v), warm[1] * (0.48 + 0.5 * v), warm[2] * (0.42 + 0.42 * v)
            if y in (84, 85, 86, 100, 101, 102): r, g, b = 0.30, 0.19, 0.11
            if 88 <= y <= 99 and (x % 36) < 14: r, g, b = 0.55, 0.37, 0.19
            if 104 <= y <= 115 and (x % 44) < 16: r, g, b = 0.48, 0.31, 0.16
            if y < 34: r, g, b = 0.35, 0.22, 0.13
            if y in (34, 35): r, g, b = 0.85, 0.76, 0.62
            for lx in (48, 128, 208):
                d = ((x - lx) ** 2 + (y - 66) ** 2) ** 0.5
                if d < 9: r, g, b = 1.0, 0.86, 0.58
            px += [r, g, b, 1.0]
    img.pixels = px
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.65
    bsdf.inputs["Roughness"].default_value = 0.9
    return m

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

def cyl(name, r1, r2, depth, x, y, z, material, verts=12, rx=0.0, ry=0.0, rz=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (rx, ry, rz)
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

def cut_arch(target, w, x, y, zbase, h):
    cut(target, w, 1.4, h, x, y, zbase + h / 2)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=w / 2, depth=1.4, location=(x, y, zbase + h))
    c = bpy.context.active_object
    c.rotation_euler = (math.radians(90), 0, 0)
    mod = target.modifiers.new("cutA", "BOOLEAN")
    mod.operation = "DIFFERENCE"; mod.solver = "EXACT"; mod.object = c
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cutA")
    bpy.data.objects.remove(c, do_unlink=True)

def rail_frame(cx, cy, cz, w, h, plane, depth, mat_, vertical=False):
    t = 0.17
    if not vertical:
        box("frame_rail", w + t, depth, t, cx, plane, cz + h / 2 + t / 2, mat_)
        box("frame_rail", w + t, depth, t, cx, plane, cz - h / 2 - t / 2, mat_)
        box("frame_rail", t, depth, h, cx - w / 2 - t / 2, plane, cz, mat_)
        box("frame_rail", t, depth, h, cx + w / 2 + t / 2, plane, cz, mat_)
    else:
        box("frame_rail", depth, w + t, t, plane, cx, cz + h / 2 + t / 2, mat_)
        box("frame_rail", depth, w + t, t, plane, cx, cz - h / 2 - t / 2, mat_)
        box("frame_rail", depth, t, h, plane, cx - w / 2 - t / 2, cz, mat_)
        box("frame_rail", depth, t, h, plane, cx + w / 2 + t / 2, cz, mat_)

def lantern(lx, ly, lz, BRONZE, LAMP):
    box("lantern_cap", 0.24, 0.24, 0.09, lx, ly, lz + 0.2, BRONZE)
    box("lantern_arm", 0.06, 0.3, 0.06, lx, ly + 0.08, lz + 0.28, BRONZE)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.085, location=(lx, ly - 0.04, lz))
    lm = bpy.context.active_object; lm.name = "lantern_glow"; lm.data.materials.append(LAMP)

def sign(board_w, board_y, board_z, text, board_m, trim_m, letter_m, glow_m):
    box("sign_board", board_w, 0.22, 1.5, 0, board_y, board_z, board_m, bevel=0.05)
    box("sign_trim", board_w + 0.2, 0.26, 0.13, 0, board_y - 0.01, board_z + 0.8, trim_m)
    box("sign_trim", board_w + 0.2, 0.26, 0.13, 0, board_y - 0.01, board_z - 0.8, trim_m)
    for bx in (-board_w / 2 + 0.7, board_w / 2 - 0.7):
        box("sign_bracket", 0.12, 0.7, 0.9, bx, board_y + 0.25, board_z + 0.85, trim_m, rx=0.5)
    if glow_m:
        box("sign_glow", board_w - 0.2, 0.05, 0.07, 0, board_y - 0.1, board_z - 0.9, glow_m)
    td = bpy.data.curves.new("signtext", "FONT")
    td.body = text
    td.size = min(1.5, board_w / (len(text) * 0.58))
    td.extrude = 0.055
    td.bevel_depth = 0.012
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = bpy.data.objects.new("sign_text", td)
    bpy.context.collection.objects.link(o)
    o.location = (0, board_y - 0.16, board_z)
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    dec = o.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.32; dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
    o.data.materials.append(letter_m)

def finish(fname):
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

    # STAGE 04: bake world transforms into joined meshes (see coffee_shop.py).
    bpy.context.view_layer.update()
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.name.startswith("joined_"):
            o.data.transform(o.matrix_world)
            o.location = (0, 0, 0)
            o.rotation_euler = (0, 0, 0)
            o.scale = (1, 1, 1)
    tris = 0; meshes = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            meshes += 1
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print("STATS", fname, "tris:", tris, "meshes:", meshes, "materials:", len(bpy.data.materials))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname + ".glb"),
                              export_format="GLB", export_apply=True, export_yup=True)
    print("EXPORTED", fname)

def base_mats():
    return {
        "stone": mat("stone_foundation", (0.52, 0.475, 0.42), 0.98),
        "bronze": mat("frame_bronze", (0.16, 0.145, 0.13), 0.45, metallic=0.65),
        "brass": mat("brass", (0.72, 0.52, 0.22), 0.35, metallic=0.8),
        "terra": mat("planter_terracotta", (0.56, 0.29, 0.19), 0.9),
        "shrub": mat("shrub_green", (0.23, 0.36, 0.17), 0.95),
        "lamp": mat("lamp_glow", (1.0, 0.76, 0.42), 0.4, emission=(1.0, 0.68, 0.30), estr=1.6),
        "timber": mat("timber_walnut", (0.295, 0.185, 0.105), 0.8),
        "timber_d": mat("timber_dark", (0.20, 0.125, 0.075), 0.82),
    }

def planter(px, py, M):
    box("planter", 1.5, 0.85, 0.68, px, py, 0.34, M["terra"], bevel=0.05)
    cyl("planter_shrub", 0.5, 0.12, 0.85, px, py, 1.0, M["shrub"], verts=7)

def build_district(cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = base_mats()
    W, D, H = cfg["W"], cfg["D"], cfg["H"]
    wall_top = H - 0.8
    wall_h = wall_top - 0.6
    walls = mat("walls_main", cfg["wall"], 0.88)
    walls2 = mat("walls_shade", cfg["wall2"], 0.9)
    trim = mat("trim", cfg["trim"], 0.7)
    glass = mat("glass_warm", (1.0, 0.78, 0.47), 0.12, emission=cfg["glass_e"], estr=cfg.get("glass_s", 0.8))
    glass_up = mat("glass_upper", (1.0, 0.80, 0.52), 0.15, emission=(1.0, 0.70, 0.36), estr=0.55)
    door_m = mat("door_painted", cfg["door"], 0.6)
    interior = diorama_texture("interior_" + cfg["file"], cfg["warm"])
    roof_m = tile_texture("roof_" + cfg["file"], cfg["roof_c"])
    shell = box("walls", W, D, wall_h, 0, 0, 0.6 + wall_h / 2, walls)
    fy = -D / 2  # front plane
    # ---- window layout: ground row avoids the centered door (|x|<2)
    if cfg["win"] == "ribbon":
        for wx in (-8.6, 8.6):
            cut(shell, 9.6, 1.4, 3.0, wx, fy, 3.3)
    elif W >= 24:
        for wx in (-9.3, -5.6, 5.6, 9.3):
            if cfg["win"] == "arch": cut_arch(shell, 2.4, wx, fy, 1.15, 3.1)
            else: cut(shell, 2.9, 1.4, 3.2, wx, fy, 2.9)
    else:
        for wx in (-7.6, -4.6, 4.6, 7.6):
            cut(shell, 2.4, 1.4, 2.9, wx, fy, 2.75)
    if H >= 12 or cfg.get('upper'):  # upper row
        for wx in (-8.8, -4.4, 0, 4.4, 8.8):
            if cfg["win"] == "arch": cut_arch(shell, 1.7, wx, fy, wall_top - 3.4, 1.9)
            else: cut(shell, 1.8, 1.4, 1.8, wx, fy, wall_top - 2.4)
    # sides + back
    for sx in (-W / 2, W / 2):
        for wz in (-D / 4, D / 4):
            cut(shell, 1.4, 2.4, 2.1, sx, wz, 3.4)
    cut(shell, 1.9, 1.4, 3.4, -W / 4, D / 2, 2.3)
    cut(shell, 2.6, 1.4, 2.0, W / 4, D / 2, 3.8)
    # door opening (centered)
    cut(shell, 2.3, 1.4, 3.9, 0, fy, 0.6 + 1.95)
    # ---- frames + glass + dioramas
    def front_win(wx, wz_c, w, h, arch=False, dio=True):
        if arch:
            box("arch_band", w + 0.5, 0.16, h + w / 2 + 0.3, wx, fy - 0.03, wz_c + 0.2, trim)
            box("arch_glass", w, 0.05, h, wx, fy - 0.1, wz_c, glass)
            cyl("arch_top", w / 2, w / 2, 0.05, wx, fy - 0.1, wz_c + h / 2, glass, verts=18, rx=math.radians(90))
            rail_frame(wx, fy - 0.06, wz_c, w, h, fy - 0.06, 0.26, M["bronze"])
        else:
            rail_frame(wx, fy - 0.06, wz_c, w, h, fy - 0.06, 0.26, M["bronze"])
            if dio: box("win_interior", w, 0.06, h, wx, fy + 0.55, wz_c, interior)
            box("win_glass", w, 0.05, h, wx, fy - 0.16, wz_c, glass)
            box("win_sill", w + 0.5, 0.5, 0.24, wx, fy - 0.1, wz_c - h / 2 - 0.22, M["stone"], bevel=0.03)
    if cfg["win"] == "ribbon":
        for wx in (-8.6, 8.6):
            rail_frame(wx, fy - 0.06, 3.3, 9.6, 3.0, fy - 0.06, 0.26, M["bronze"])
            box("win_interior", 9.6, 0.06, 3.0, wx, fy + 0.55, 3.3, interior)
            box("win_glass", 9.6, 0.05, 3.0, wx, fy - 0.16, 3.3, glass)
            for dx in (-2.4, 0, 2.4):
                box("win_mullion", 0.09, 0.1, 3.0, wx + dx, fy - 0.14, 3.3, M["bronze"])
    elif W >= 24:
        for wx in (-9.3, -5.6, 5.6, 9.3):
            if cfg["win"] == "arch": front_win(wx, 2.7, 2.4, 3.1, arch=True)
            else: front_win(wx, 2.9, 2.9, 3.2)
    else:
        for wx in (-7.6, -4.6, 4.6, 7.6):
            front_win(wx, 2.75, 2.4, 2.9)
    if H >= 12 or cfg.get('upper'):
        for wx in (-8.8, -4.4, 0, 4.4, 8.8):
            if cfg["win"] == "arch":
                box("up_glass", 1.7, 0.05, 1.9, wx, fy - 0.14, wall_top - 2.45, glass_up)
                rail_frame(wx, fy - 0.06, wall_top - 2.45, 1.7, 1.9, fy - 0.06, 0.24, M["bronze"])
            else:
                rail_frame(wx, fy - 0.06, wall_top - 2.4, 1.8, 1.8, fy - 0.06, 0.24, M["bronze"])
                box("up_glass", 1.8, 0.05, 1.8, wx, fy - 0.14, wall_top - 2.4, glass_up)
    if cfg.get("balconies"):
        for wx in (-8.8, -4.4, 4.4, 8.8):
            box("balcony_slab", 2.9, 0.95, 0.14, wx, fy - 0.5, wall_top - 3.42, M["stone"], bevel=0.02)
            box("balcony_rail", 2.9, 0.06, 0.07, wx, fy - 0.95, wall_top - 2.55, M["bronze"])
            for rx_ in (-1.35, 0, 1.35):
                box("balcony_post", 0.06, 0.06, 0.8, wx + rx_, fy - 0.95, wall_top - 2.95, M["bronze"])
            box("balcony_rail_side", 0.06, 0.95, 0.07, wx - 1.42, fy - 0.5, wall_top - 2.55, M["bronze"])
            box("balcony_rail_side", 0.06, 0.95, 0.07, wx + 1.42, fy - 0.5, wall_top - 2.55, M["bronze"])
    for sx in (-W / 2, W / 2):
        for wz in (-D / 4, D / 4):
            rail_frame(wz, sx * 1.001, 3.4, 2.4, 2.1, sx * 1.001, 0.24, M["bronze"], vertical=True)
            box("side_glass", 0.05, 2.4, 2.1, sx * 1.008, wz, 3.4, glass_up)
    box("back_door", 1.9, 0.12, 3.4, -W / 4, D / 2 + 0.02, 2.3, M["timber_d"], bevel=0.02)
    box("back_glass", 2.6, 0.05, 2.0, W / 4, D / 2 + 0.14, 3.8, glass_up)
    # ---- foundation + trim
    box("foundation", W + 0.7, D + 0.7, 0.85, 0, 0, 0.42, M["stone"], bevel=0.04)
    box("plinth_trim", W + 0.35, D + 0.35, 0.22, 0, 0, 0.92, trim)
    box("belt_course", W + 0.3, D + 0.3, 0.26, 0, 0, wall_top - 0.1, trim)
    for cx in (-W / 2 + 0.1, W / 2 - 0.1):
        for cy in (-D / 2 + 0.1, D / 2 - 0.1):
            box("corner_board", 0.55, 0.55, wall_h, cx, cy, 0.6 + wall_h / 2, trim, bevel=0.03)
    # ---- entrance
    box("door_frame", 2.7, 0.26, 4.3, 0, fy - 0.04, 2.55, trim, bevel=0.03)
    box("door_leaf", 2.15, 0.1, 3.75, 0, fy - 0.1, 2.42, door_m, bevel=0.02)
    box("door_glass", 1.15, 0.04, 1.5, 0, fy - 0.17, 3.0, glass)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.075, location=(-0.78, fy - 0.22, 2.35))
    knob = bpy.context.active_object; knob.name = "door_knob"; knob.data.materials.append(M["brass"])
    box("door_step", 3.6, 1.7, 0.22, 0, fy - 0.75, 0.71, M["stone"], bevel=0.03)
    # STAGE 04: a real stair under the landing - even rises from the ground
    # (0 -> 0.32 -> 0.60 -> landing top 0.82 -> foundation top 0.85), each
    # tread resting on the one below, fronts proud of the foundation face.
    box("stair_a", 3.4, 2.1, 0.32, 0, fy - 1.15, 0.16, M["stone"], bevel=0.02)
    box("stair_b", 3.0, 1.6, 0.32, 0, fy - 0.95, 0.44, M["stone"], bevel=0.02)
    can = cfg["canopy"]
    if can == "marquee":
        box("marquee", 6.6, 2.0, 0.3, 0, fy - 0.95, 4.85, trim, bevel=0.04)
        box("marquee_glow", 6.3, 0.06, 0.08, 0, fy - 1.9, 4.68, M["lamp"])
        for bx in (-2.6, 2.6):
            box("marquee_arm", 0.1, 1.1, 0.1, bx, fy - 0.45, 5.25, M["bronze"], rx=0.5)
    elif can == "porch":
        for px in (-1.9, 1.9):
            box("porch_post", 0.22, 0.22, 3.9, px, fy - 1.35, 2.55, M["timber"], bevel=0.03)
            box("post_base", 0.38, 0.38, 0.5, px, fy - 1.35, 0.85, M["stone"], bevel=0.03)
        box("porch_beam", 4.4, 0.28, 0.32, 0, fy - 1.35, 4.6, M["timber_d"], bevel=0.03)
        c2 = box("porch_canopy", 4.9, 2.1, 0.14, 0, fy - 1.05, 5.05, roof_m); c2.rotation_euler = (0.42, 0, 0)
    elif can == "flat":
        box("canopy", 5.6, 1.6, 0.2, 0, fy - 0.75, 4.7, trim, bevel=0.03)
        for bx in (-2.2, 2.2):
            box("canopy_arm", 0.09, 0.9, 0.09, bx, fy - 0.35, 5.1, M["bronze"], rx=0.5)
    lantern(-1.85, fy - 0.22, 3.62, M["bronze"], M["lamp"])
    lantern(1.85, fy - 0.22, 3.62, M["bronze"], M["lamp"])
    # ---- roof
    roof_h = cfg.get("roof_h", 3.2)
    if cfg["roof"] == "gable":
        pitch = math.atan2(roof_h, W / 2 + 0.9)
        slope_len = math.hypot(W / 2 + 0.9, roof_h) + 0.4
        for sgn in (-1, 1):
            r = box("roof_slab", slope_len, D + 1.8, 0.26, sgn * (W / 4 + 0.45), 0, wall_top + roof_h / 2 + 0.1, roof_m)
            r.rotation_euler = (0, sgn * pitch, 0)
        box("ridge_cap", 0.5, D + 2.0, 0.3, 0, 0, wall_top + roof_h + 0.22, M["timber_d"], bevel=0.05)
        # gable infills front/back (prism in XZ at fixed y)
        for gy in (-D / 2 + 0.15, D / 2 - 0.15):
            verts = [(-W / 2, -0.15, wall_top), (W / 2, -0.15, wall_top), (0, -0.15, wall_top + roof_h),
                     (-W / 2, 0.15, wall_top), (W / 2, 0.15, wall_top), (0, 0.15, wall_top + roof_h)]
            faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
            me = bpy.data.meshes.new("gable")
            me.from_pydata(verts, [], faces)
            o = bpy.data.objects.new("gable", me)
            bpy.context.collection.objects.link(o)
            o.location = (0, gy, 0)
            o.data.materials.append(walls2)
    else:  # hip roof: an exact rectangular pyramid built from_pydata —
        # a scaled 4-vert cone can never make a true rectangular base
        # (two attempts measured 35.7 and 33.7 wide on a 22 building).
        hw, hd = (W + 1.8) / 2, (D + 1.8) / 2
        verts = [(-hw, -hd, wall_top), (hw, -hd, wall_top), (hw, hd, wall_top), (-hw, hd, wall_top), (0, 0, wall_top + roof_h)]
        faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (2, 1, 0), (2, 0, 3)]
        me = bpy.data.meshes.new("hip_roof")
        me.from_pydata(verts, [], faces)
        hip = bpy.data.objects.new("hip_roof", me)
        bpy.context.collection.objects.link(hip)
        hip.data.materials.append(roof_m)
        box("roof_cap", 0.6, 0.6, 0.35, 0, 0, wall_top + roof_h + 0.1, trim, bevel=0.05)
    # ---- sign + planters
    board_w = min(W * 0.62, 15)
    sign(board_w, fy - 0.55, H - 1.7, cfg["text"], mat("sign_board", cfg["sign_b"], 0.7), M["brass"], mat("sign_letters", cfg["sign_l"], 0.5), M["lamp"] if cfg["canopy"] == "marquee" else None)
    planter(-W / 2 + 1.6, fy - 0.7, M)
    planter(W / 2 - 1.6, fy - 0.7, M)
    planter(-3.4, fy - 0.7, M)
    planter(3.4, fy - 0.7, M)
    finish(cfg["file"])

DISTRICTS = [
    dict(file="arcade", W=26, D=16, H=13, wall=(0.26, 0.19, 0.31), wall2=(0.22, 0.16, 0.27), trim=(0.35, 0.24, 0.48),
         glass_e=(0.72, 0.55, 1.0), glass_s=0.75, door=(0.16, 0.13, 0.22), warm=(0.85, 0.62, 0.85),
         roof_c=(0.30, 0.26, 0.38), roof="hip", roof_h=3.4, win="square", canopy="marquee",
         text="ARCADE", sign_b=(0.14, 0.10, 0.20), sign_l=(0.85, 0.75, 1.0)),
    dict(file="library", W=26, D=16, H=13, wall=(0.78, 0.68, 0.52), wall2=(0.71, 0.61, 0.46), trim=(0.42, 0.30, 0.17),
         glass_e=(1.0, 0.70, 0.38), glass_s=0.85, door=(0.30, 0.17, 0.09), warm=(0.97, 0.74, 0.45),
         roof_c=(0.52, 0.27, 0.19), roof="hip", roof_h=3.4, win="arch", canopy="porch",
         text="LIBRARY", sign_b=(0.23, 0.15, 0.08), sign_l=(0.85, 0.68, 0.35)),
    dict(file="apartments", W=22, D=13, H=10, wall=(0.88, 0.82, 0.68), wall2=(0.81, 0.75, 0.61), trim=(0.42, 0.50, 0.36),
         glass_e=(1.0, 0.70, 0.38), glass_s=0.7, door=(0.35, 0.42, 0.30), warm=(0.96, 0.74, 0.46),
         roof_c=(0.56, 0.29, 0.19), roof="gable", roof_h=3.0, win="square", canopy="porch", balconies=True, upper=True,
         text="APARTMENTS", sign_b=(0.30, 0.38, 0.26), sign_l=(0.95, 0.92, 0.80)),
    dict(file="rec", W=22, D=13, H=10, wall=(0.47, 0.56, 0.43), wall2=(0.41, 0.50, 0.38), trim=(0.24, 0.32, 0.22),
         glass_e=(1.0, 0.72, 0.40), glass_s=0.75, door=(0.20, 0.26, 0.18), warm=(0.95, 0.75, 0.48),
         roof_c=(0.35, 0.33, 0.30), roof="hip", roof_h=2.8, win="square", canopy="flat",
         text="REC CENTER", sign_b=(0.18, 0.24, 0.16), sign_l=(0.92, 0.95, 0.85)),
    dict(file="music", W=30, D=14, H=9, wall=(0.23, 0.19, 0.30), wall2=(0.19, 0.16, 0.26), trim=(0.55, 0.42, 0.16),
         glass_e=(1.0, 0.72, 0.38), glass_s=0.8, door=(0.35, 0.26, 0.10), warm=(0.97, 0.72, 0.42),
         roof_c=(0.25, 0.22, 0.30), roof="hip", roof_h=2.6, win="ribbon", canopy="flat",
         text="6IX MUSIC", sign_b=(0.12, 0.10, 0.16), sign_l=(0.95, 0.78, 0.35)),
]
for cfg in DISTRICTS:
    build_district(cfg)

# ---------------- the residential house (11 x 9, walls tinted at runtime) ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
M = base_mats()
WALLS = mat("walls", (1.0, 1.0, 1.0), 0.88)  # name matters: the client tints this material per house
WALLS2 = mat("walls_shade", (0.92, 0.90, 0.86), 0.9)
glass = mat("glass_warm", (1.0, 0.78, 0.47), 0.12, emission=(1.0, 0.66, 0.32), estr=0.8)
interior = diorama_texture("interior_house", (0.97, 0.74, 0.45))
roof_m = tile_texture("roof_house", (0.565, 0.285, 0.20))
shell = box("walls", 11, 9, 4.9, 0, 0, 0.6 + 2.45, WALLS)
fy = -4.5
for wx in (-3.2, 3.2):
    cut(shell, 1.6, 1.3, 1.6, wx, fy, 3.4)
cut(shell, 1.5, 1.3, 2.7, 0, fy, 0.6 + 1.35)
for sx in (-5.5, 5.5):
    for wz in (-2.0, 2.0):
        cut(shell, 1.3, 1.4, 1.5, sx, wz, 3.4)
cut(shell, 1.8, 1.3, 1.6, 0, 4.5, 3.4)
box("foundation", 11.7, 9.7, 0.85, 0, 0, 0.42, M["stone"], bevel=0.04)
box("plinth_trim", 11.35, 9.35, 0.22, 0, 0, 0.92, M["timber_d"])
for cx in (-5.4, 5.4):
    for cy in (-4.4, 4.4):
        box("corner_board", 0.5, 0.5, 4.9, cx, cy, 3.05, M["timber"], bevel=0.03)
for wx in (-3.2, 3.2):
    rail_frame(wx, fy - 0.06, 3.4, 1.6, 1.6, fy - 0.06, 0.26, M["bronze"])
    box("win_interior", 1.6, 0.06, 1.6, wx, fy + 0.5, 3.4, interior)
    box("win_glass", 1.6, 0.05, 1.6, wx, fy - 0.15, 3.4, glass)
    box("flower_box", 1.9, 0.55, 0.45, wx, fy - 0.35, 2.35, mat("sage_accent", (0.42, 0.50, 0.36), 0.85), bevel=0.04)
    for fi in range(4):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.13, location=(wx - 0.6 + fi * 0.4, fy - 0.35, 2.62))
        f = bpy.context.active_object; f.name = "flower"
        f.data.materials.append(mat("flower_pink", (0.95, 0.55, 0.68), 0.9) if fi % 2 else mat("flower_cream", (0.96, 0.90, 0.75), 0.9))
for sx in (-5.5, 5.5):
    for wz in (-2.0, 2.0):
        rail_frame(wz, sx * 1.001, 3.4, 1.4, 1.5, sx * 1.001, 0.24, M["bronze"], vertical=True)
        box("side_glass", 0.05, 1.4, 1.5, sx * 1.01, wz, 3.4, glass)
box("back_glass", 1.8, 0.05, 1.6, 0, 4.64, 3.4, glass)
# door + porch (lantern is bracket-mounted — no more floating orb)
box("door_frame", 1.9, 0.24, 3.1, 0, fy - 0.04, 2.15, M["timber_d"], bevel=0.03)
box("door_leaf", 1.4, 0.1, 2.6, 0, fy - 0.1, 1.95, M["timber"], bevel=0.02)
box("door_glass", 0.7, 0.04, 0.9, 0, fy - 0.17, 2.45, glass)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.06, location=(-0.5, fy - 0.2, 1.9))
knob = bpy.context.active_object; knob.name = "door_knob"; knob.data.materials.append(M["brass"])
box("door_step", 2.4, 1.4, 0.22, 0, fy - 0.65, 0.71, M["stone"], bevel=0.03)
# STAGE 04: ground stair under the house landing (same rise pattern).
box("stair_a", 2.8, 1.9, 0.32, 0, fy - 1.0, 0.16, M["stone"], bevel=0.02)
box("stair_b", 2.5, 1.4, 0.32, 0, fy - 0.8, 0.44, M["stone"], bevel=0.02)
for px in (-1.35, 1.35):
    box("porch_post", 0.18, 0.18, 3.0, px, fy - 1.15, 2.1, M["timber"], bevel=0.02)
    box("post_base", 0.32, 0.32, 0.42, px, fy - 1.15, 0.81, M["stone"], bevel=0.02)
pp = math.atan2(0.9, 1.55)
for sgn in (-1, 1):
    r = box("porch_roof", 1.75, 2.6, 0.13, sgn * 0.78, fy - 1.05, 3.95, roof_m)
    r.rotation_euler = (0, sgn * pp, 0)
box("porch_beam", 3.1, 0.24, 0.26, 0, fy - 1.15, 3.62, M["timber_d"], bevel=0.02)
lantern(1.15, fy - 0.18, 2.62, M["bronze"], M["lamp"])
# gable roof, ridge along X
wall_top = 5.5
roof_h = 2.9
pitch = math.atan2(roof_h, 4.5 + 0.9)
slope_len = math.hypot(4.5 + 0.9, roof_h) + 0.4
for sgn in (-1, 1):
    r = box("roof_slab", 12.4, slope_len, 0.24, 0, sgn * 2.7, wall_top + roof_h / 2 + 0.05, roof_m)
    # V578: sign flipped vs the district gable pattern — these slabs
    # slope across Y with an X rotation (z' = y*sin), where the
    # Y-rotation form (z' = -x*sin) needs the opposite sign. The old
    # (sgn * pitch) put both eaves at ridge height and both inner
    # edges at wall top: a valley roof. Proven numerically + in the
    # exported GLB (roof.test.mjs).
    r.rotation_euler = (-sgn * pitch, 0, 0)
box("ridge_cap", 12.6, 0.5, 0.28, 0, 0, wall_top + roof_h + 0.18, M["timber_d"], bevel=0.05)
for gx in (-5.5, 5.5):
    verts = [(-0.15, -4.5, wall_top), (-0.15, 4.5, wall_top), (-0.15, 0, wall_top + roof_h),
             (0.15, -4.5, wall_top), (0.15, 4.5, wall_top), (0.15, 0, wall_top + roof_h)]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    me = bpy.data.meshes.new("gable_side")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new("gable_side", me)
    bpy.context.collection.objects.link(o)
    o.location = (gx, 0, 0)
    o.data.materials.append(WALLS2)
planter(-4.6, fy - 0.7, M)
planter(4.6, fy - 0.7, M)
finish("house")
print("ALL DISTRICTS + HOUSE DONE")
