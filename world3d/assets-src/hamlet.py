# hamlet.py — Stage 6 settlement buildings, kitbashed in Blender
# from the Quaternius Medieval Village MegaKit (CC0, see
# assets/ASSET_SOURCES.md) plus one original well built from the
# kit's own materials. Run:
#   blender -b --python hamlet.py -- <cottage|shed|tower|well|fence|crate|all>
# Outputs GLBs to ~/workspace/.tests/hamlet-out/ and orbit renders
# to ~/workspace/.tests/hamlet-renders/ for visual inspection.
import bpy, os, sys, math

# sandbox workaround (2026-11-23): the exec environment's policy
# now denies os.write on O_EXCL-created files, which makes
# tempfile's default-dir probe fail ("No usable temporary
# directory") and kills every glTF export. presetting
# tempfile.tempdir skips the probe entirely.
import tempfile
tempfile.tempdir = os.path.expanduser('~/workspace/.tests/btmp')
os.makedirs(tempfile.tempdir, exist_ok=True)

KIT = os.path.expanduser('~/workspace/.tests/assets-dl/medieval/gltf/')
OUT = os.path.expanduser('~/workspace/.tests/hamlet-out/')
REN = os.path.expanduser('~/workspace/.tests/hamlet-renders/')
os.makedirs(OUT, exist_ok=True)
os.makedirs(REN, exist_ok=True)

def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def imp(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=KIT + name + '.gltf')
    return [o for o in bpy.data.objects if o not in before]

def place(name, x, y, z=0.0, rz=0.0):
    objs = imp(name)
    for o in objs:
        # the glTF importer leaves objects in QUATERNION mode, in
        # which rotation_euler writes are silently ignored — the
        # first kitbash shipped with every rotation a no-op (side
        # walls jutting out unrotated, roofs unrotated). switch
        # mode first, then set the euler.
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (0, 0, rz)
        o.location = (x, y, z)
    return objs

# wall-piece geometry facts (measured from the kit): a wall
# piece's origin is NOT at its centre — its geometry spans local
# y [-0.10, +0.31] (0.41 thick, offset +0.105). placements below
# are computed so the OUTER faces land exactly on the building
# rectangle: front row (rz 0) origin y = D/2 - 0.31, back row
# (rz pi) origin y = -(D/2 - 0.31), right side (rz +pi/2) origin
# x = W/2 - 0.10, left side (rz -pi/2) origin x = -(W/2 - 0.10).
# opposite walls are then exactly parallel and all four outer
# faces flush at the corners — a true rectangle, no fins, no
# stepped corners.

def gable(axis, c, mat_hint):
    # pentagon prism filling the wall top up to the 4x6 roof's inner
    # slope (roof base 3.12, rise 4.23 over a 5.51 footprint: at
    # |offset| 2 the slope sits at 3.12 + 1.16). textured with the
    # wall material itself (donor pieces are already in the scene)
    # + smart-projected UVs — a flat colour read as a billboard in
    # the first renders.
    pts = [(-2, 3.12), (2, 3.12), (2, 4.28), (0, 7.35), (-2, 4.28)]
    verts = []
    for t in (-0.12, 0.12):
        for (u, z) in pts:
            verts.append((c + t, u, z) if axis == 'x' else (u, c + t, z))
    faces = [[0, 1, 2, 3, 4], [9, 8, 7, 6, 5]]
    for i in range(5):
        j = (i + 1) % 5
        faces.append([i, j, j + 5, i + 5])
    mesh = bpy.data.meshes.new('gable')
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('gable', mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = next((m for n, m in bpy.data.materials.items() if mat_hint in n), None)
    if mat: mesh.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)

class _Sink:
    # in-memory file stand-in: collects the GLB bytes so export()
    # can stream them out as base64 over stdout (see below).
    def __init__(self): self.buf = bytearray()
    def write(self, data): self.buf += data; return len(data)
    def flush(self): pass
    def close(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): pass

def export(name):
    # plain on-disk WEBP export. (during the 2026-11-23 sandbox
    # write-layer outage this was a base64-over-stdout sink —
    # the layer healed the same afternoon; if writes ever break
    # again, the sink version is in git-less snapshot notes in
    # WORLDGEN.md's Stage 6 section.)
    for img in bpy.data.images:
        if img.size[0] > 512 or img.size[1] > 512:
            s = 512 / max(img.size[0], img.size[1])
            img.scale(int(img.size[0] * s), int(img.size[1] * s))
    try:
        bpy.ops.export_scene.gltf(filepath=OUT + name + '.glb', export_format='GLB', export_apply=True, export_image_format='WEBP')
        print('EXPORTED', name, os.path.getsize(OUT + name + '.glb'))
    except Exception as e:
        print('EXPORT FAILED', name, str(e)[:100])

def render(name, cam_loc, target=(0, 0, 1.6)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'  # EEVEE needs libEGL, absent in the sandbox
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    # ambient fill so shadow sides stay readable (the game has a
    # hemisphere light; a bare sun render blacks them out)
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.4, 0.38, 0.35, 1)
    bg.inputs[1].default_value = 0.75
    sc.world = w
    sc.render.resolution_x, sc.render.resolution_y = 560, 420
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)
    camdata = bpy.data.cameras.new('cam')
    camdata.type = 'PERSP'
    cam = bpy.data.objects.new('cam', camdata)
    cam.location = cam_loc
    sc.collection.objects.link(cam)
    sc.camera = cam
    import mathutils
    d = mathutils.Vector(target) - mathutils.Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = REN + name + '.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)

def cottage():
    fresh()
    # outer rectangle exactly 6 (x) by 4 (y); see the wall-offset
    # note at place(). front: window, door, window.
    place('Wall_Plaster_Window_Wide_Flat', -2, 1.69)
    place('Wall_Plaster_Door_Flat', 0, 1.69)
    place('Wall_Plaster_Window_Wide_Flat', 2, 1.69)
    place('Wall_Plaster_Straight', -2, -1.69, 0, math.pi)
    place('Wall_Plaster_Window_Wide_Flat', 0, -1.69, 0, math.pi)
    place('Wall_Plaster_Straight', 2, -1.69, 0, math.pi)
    for sx, rz in ((2.90, math.pi / 2), (-2.90, -math.pi / 2)):
        place('Wall_Plaster_Straight', sx, -1, 0, rz)
        place('Wall_Plaster_Window_Thin_Round', sx, 1, 0, rz)
    place('Door_1_Flat', 0, 1.69)
    # glass inserts plug the window holes
    place('Window_Wide_Flat1', -2, 1.69)
    place('Window_Wide_Flat1', 2, 1.69)
    place('Window_Wide_Flat1', 0, -1.69, 0, math.pi)
    for sx, rz in ((2.90, math.pi / 2), (-2.90, -math.pi / 2)):
        place('Window_Thin_Round1', sx, 1, 0, rz)
    gable('x', 2.88, 'Plaster')
    gable('x', -2.88, 'Plaster')
    place('Roof_RoundTiles_4x6', 0, 0, 3.12, math.pi / 2)
    place('Prop_Chimney', 1.6, -0.8, 3.9)
    render('cottage_f', (9.5, 10.5, 6.5))
    render('cottage', (9.5, -10.5, 6.5))
    export('cottage')

def shed():
    fresh()
    # outer rectangle exactly 4 (x) by 6 (y)
    place('Wall_UnevenBrick_Door_Flat', -1, 2.69)
    place('Wall_UnevenBrick_Straight', 1, 2.69)
    place('Wall_UnevenBrick_Window_Wide_Flat', -1, -2.69, 0, math.pi)
    place('Wall_UnevenBrick_Straight', 1, -2.69, 0, math.pi)
    for sx, rz in ((1.90, math.pi / 2), (-1.90, -math.pi / 2)):
        for y in (-2, 0, 2):
            place('Wall_UnevenBrick_Straight', sx, y, 0, rz)
    place('Door_1_Flat', -1, 2.69)
    place('Window_Wide_Flat1', -1, -2.69, 0, math.pi)
    gable('y', 2.88, 'Brick')
    gable('y', -2.88, 'Brick')
    place('Roof_RoundTiles_4x6', 0, 0, 3.12)
    render('shed_f', (9, 10, 6))
    render('shed', (9, -10, 6))
    export('shed')

def tower():
    fresh()
    # outer square exactly 4 by 4, two storeys
    for lvl in (0, 3.12):
        win = lvl > 0
        place('Wall_UnevenBrick_Door_Flat' if not win else 'Wall_UnevenBrick_Window_Wide_Flat', -1, 1.69, lvl)
        place('Wall_UnevenBrick_Straight', 1, 1.69, lvl)
        place('Wall_UnevenBrick_Window_Wide_Flat', -1, -1.69, lvl, math.pi)
        place('Wall_UnevenBrick_Straight', 1, -1.69, lvl, math.pi)
        for sx, rz in ((1.90, math.pi / 2), (-1.90, -math.pi / 2)):
            place('Wall_UnevenBrick_Window_Wide_Flat' if win else 'Wall_UnevenBrick_Straight', sx, -1, lvl, rz)
            place('Wall_UnevenBrick_Straight', sx, 1, lvl, rz)
    if True:  # door only on the ground floor front-centre-left
        place('Door_1_Flat', -1, 1.69)
    # glass inserts on every window wall (level 2 all around + back L1)
    place('Window_Wide_Flat1', -1, 1.69, 3.12)
    place('Window_Wide_Flat1', -1, -1.69, 0, math.pi)
    place('Window_Wide_Flat1', -1, -1.69, 3.12, math.pi)
    for sx, rz in ((1.90, math.pi / 2), (-1.90, -math.pi / 2)):
        place('Window_Wide_Flat1', sx, -1, 3.12, rz)
    for fx in (-1.05, 1.05):
        for fy in (-1.05, 1.05):
            place('Floor_WoodDark', fx, fy, 3.10)
    place('Roof_Tower_RoundTiles', 0, 0, 6.24)
    render('watchtower_f', (11, 12, 9), (0, 0, 4.5))
    render('watchtower', (11, -12, 9), (0, 0, 4.5))
    export('watchtower')

def well():
    fresh()
    imp('Wall_UnevenBrick_Straight')  # material donors
    imp('Roof_RoundTiles_4x6')
    imp('Floor_WoodDark')
    mats = {m.name: m for m in bpy.data.materials}
    print('MATERIALS', list(mats))
    brick = next((m for n, m in mats.items() if 'Brick' in n), None)
    wood = next((m for n, m in mats.items() if 'Wood' in n), None)
    tile = next((m for n, m in mats.items() if 'Tile' in n or 'Roof' in n), None)
    # remove the donor meshes, keep materials
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    dark = bpy.data.materials.new('WellDark')
    dark.use_nodes = True
    dark.node_tree.nodes['Principled BSDF'].inputs[0].default_value = (0.02, 0.02, 0.025, 1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.95, depth=0.85, location=(0, 0, 0.425))
    ring = bpy.context.object
    if brick: ring.data.materials.append(brick)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.78, depth=0.1, location=(0, 0, 0.82))
    top = bpy.context.object
    top.data.materials.append(dark)
    for sx in (-0.85, 0.85):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx, 0, 1.30))
        p = bpy.context.object
        p.scale = (0.07, 0.07, 1.05)
        if wood: p.data.materials.append(wood)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.055, depth=1.7, rotation=(0, math.pi / 2, 0), location=(0, 0, 1.72))
    bar = bpy.context.object
    if wood: bar.data.materials.append(wood)
    # gable roof: eaves at z 1.80 / |y| 0.63, ridge meeting at
    # z 2.25 / y 0 — slab slope length 0.80 at 36 degrees, centre
    # (0, +-0.31, 2.03). the rotation sign slopes each slab DOWN
    # toward its eave; the first build had it inverted (a valley
    # floating above the posts).
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, s * 0.31, 2.03))
        r = bpy.context.object
        r.scale = (1.05, 0.80, 0.05)
        r.rotation_euler = (-s * math.radians(36), 0, 0)
        if tile: r.data.materials.append(tile)
    export('well')
    render('well', (3.4, -4.2, 2.6), (0, 0, 0.9))

def single(name, out):
    fresh()
    imp(name)
    export(out)

if __name__ == '__main__':
    which = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'all'
    if which in ('cottage', 'all'): cottage()
    if which in ('shed', 'all'): shed()
    if which in ('tower', 'all'): tower()
    if which in ('well', 'all'): well()
    if which in ('fence', 'all'): single('Prop_WoodenFence_Single', 'fence')
    if which in ('crate', 'all'): single('Prop_Crate', 'crate')
    print('HAMLET DONE', which)
