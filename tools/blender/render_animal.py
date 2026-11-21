# Renders the avatar GLBs for a look: a rest-pose turnaround and pose checks for one animal, or a line-up of several,
# on a dark navy ground with a soft key light, a magenta rim from one side and a cyan rim from the other.
# Needs Blender 4.5 LTS. Renders go to the folder you name (default: the system temp folder); never into the repository.
#
#   blender --background --factory-startup --python tools/blender/render_animal.py -- assets/models/BearToy.glb <outdir> [prefix] [--wire] [--only a,b]
#   blender --background --factory-startup --python tools/blender/render_animal.py -- --lineup assets/models/MouseToy.glb assets/models/CatToy.glb assets/models/BearToy.glb <outdir> lineup
#
# It renders the exported GLB itself (not the build scene), so what you see is what the game loads.
# The rest pose is the T-pose; the arms were modelled 40 degrees down, so the T-pose shows a stretched underarm. Judge the pose shots.
# Environment: ANIMAL_TINT=#rrggbb or none (hoodie colour for the render), ANIMAL_CYCLES=1, ANIMAL_ZOOM=aim_z,frame_h[,aim_x].
import bpy, sys, os, math, tempfile
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pos, i = [], 0
while i < len(argv):
    if argv[i] == "--only":
        i += 2
        continue
    if not argv[i].startswith("--"):
        pos.append(argv[i])
    i += 1

REPO = os.path.dirname(os.path.dirname(HERE))
def here(p):
    # Blender resolves a bare relative render path against the drive root, so make every path absolute first.
    return os.path.abspath(p)

LINEUP = "--lineup" in argv
WIRE = "--wire" in argv
ONLY = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None
if LINEUP:
    GLBS, OUT, PREFIX = [here(p) for p in pos[:-2]], here(pos[-2]), pos[-1]
else:
    GLBS = [here(pos[0]) if len(pos) > 0 else os.path.join(REPO, "assets", "models", "BearToy.glb")]
    OUT = here(pos[1]) if len(pos) > 1 else os.path.join(tempfile.gettempdir(), "kts", "avatar-renders")
    PREFIX = pos[2] if len(pos) > 2 else os.path.splitext(os.path.basename(GLBS[0]))[0]
TILE = (512, 640)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30  # the clips were authored at 30 fps; import at 30 so frames are whole numbers

# ---------- characters ----------
def load_character(path):
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before_obj]
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o.type == "MESH" and o.parent is None and len(o.data.polygons) <= 80 and not o.modifiers:
            bpy.data.objects.remove(o, do_unlink=True)  # the importer's bone-shape icosphere
    meshes = [o for o in bpy.data.objects if o not in before_obj and o.type == "MESH"]
    actions = {a.name.split(".")[0]: a for a in bpy.data.actions if a not in before_act}
    # The avatars are authored in centimetre-sized units. Put them under a 1/100 root so lights behave like real ones.
    root = bpy.data.objects.new("Turntable", None)
    scene.collection.objects.link(root)
    root.scale = (0.01, 0.01, 0.01)
    top = arm
    while top.parent:
        top = top.parent
    top.parent = root
    ad = arm.animation_data
    if ad:
        for t in ad.nla_tracks:
            t.mute = True
        ad.action = None
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        w = np.array(ev.matrix_world)
        zs.append((co.reshape(-1, 3) @ w[:3, :3].T + w[:3, 3])[:, 2])
        ev.to_mesh_clear()
    zs = np.concatenate(zs)
    return dict(arm=arm, root=root, meshes=meshes, actions=actions, height=float(zs.max() - zs.min()), zmin=float(zs.min()),
                name=os.path.splitext(os.path.basename(path))[0])

CHARS = [load_character(p) for p in GLBS]
for c in CHARS:
    print("REST HEIGHT m", c["name"], round(c["height"], 3), "min z", round(c["zmin"], 4))
HEIGHT = max(c["height"] for c in CHARS)

# ---------- world, ground, lights ----------
world = bpy.data.worlds.new("Night")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.010, 0.014, 0.035, 1)

def principled(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
bpy.context.object.data.materials.append(principled("Ground", (0.006, 0.009, 0.028), 0.55))

def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()

def area(name, loc, power, color, size, target=(0, 0, 0.65)):
    L = bpy.data.lights.new(name, "AREA")
    L.energy, L.color, L.size = power, color, size
    o = bpy.data.objects.new(name, L)
    scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o

# The characters face -Y. Key from the front-left and above; the two rims from behind, left and right.
wide = 1.9 if LINEUP else 1.0      # a line-up is 2.5 m wide: same rig, pushed back and brighter
area("Key", (-1.6 * wide, -3.0 * wide, 2.9 * wide), 150 * wide * wide, (1.0, 0.95, 0.88), 2.2 * wide)
area("Fill", (2.2 * wide, -2.2 * wide, 0.9), 20 * wide * wide, (0.55, 0.65, 1.0), 2.5 * wide)
for o in (area("RimMagenta", (-2.6 * wide, 2.2 * wide, 1.9 * wide), 330 * wide * wide, (1.0, 0.08, 0.62), 0.9 * wide, target=(0, 0, 0.85)),
          area("RimCyan", (2.6 * wide, 2.2 * wide, 1.9 * wide), 330 * wide * wide, (0.05, 0.85, 1.0), 0.9 * wide, target=(0, 0, 0.85))):
    o.data.spread = math.radians(70)   # keep the colour on the characters, not on the ground

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 70
cam_data.sensor_fit = "HORIZONTAL"
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def place_camera(pitch_deg=6.0, aim_z=None, frame_h=None, aim_x=0.0):
    frame_h = frame_h or max(1.5, HEIGHT * 1.16)
    aim_z = HEIGHT * 0.5 if aim_z is None else aim_z
    sensor_h = 36.0 * scene.render.resolution_y / scene.render.resolution_x
    dist = frame_h / 2 / math.tan(math.atan(sensor_h / 2 / cam_data.lens))
    p = math.radians(pitch_deg)
    cam.location = (aim_x, -dist * math.cos(p), aim_z + dist * math.sin(p))
    look_at(cam, (aim_x, 0, aim_z))

# ---------- render settings ----------
scene.render.resolution_x, scene.render.resolution_y = TILE
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
ENGINE = None
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 96
    for attr, val in (("shadow_ray_count", 3), ("shadow_step_count", 8), ("use_raytracing", True)):
        try:
            setattr(scene.eevee, attr, val)
        except Exception as e:
            print("eevee opt", attr, e)
    ENGINE = "EEVEE"
except Exception as e:
    print("Eevee not available:", e)
if os.environ.get("ANIMAL_CYCLES") == "1" or ENGINE is None:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    ENGINE = "CYCLES"
print("ENGINE", scene.render.engine)

# The GLB keeps the hoodie ("Main") neutral grey because the game multiplies in the player's colour.
# For the renders it gets a sample player colour so the read is the in-game one. ANIMAL_TINT=none shows it as exported.
def tint(char, hexcol):
    h = hexcol.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    for o in char["meshes"]:
        for s in o.material_slots:
            m = s.material
            if m and m.name.split(".")[0] == "Main" and m.use_nodes:
                b = m.node_tree.nodes.get("Principled BSDF")
                base = b.inputs["Base Color"].default_value
                b.inputs["Base Color"].default_value = (base[0] * lin[0], base[1] * lin[1], base[2] * lin[2], 1)

TINT = os.environ.get("ANIMAL_TINT", "#ff6a4d")
LINE_TINTS = ["#3fb8ff", "#ffd23f", "#ff6a4d"]      # three different players in the line-up
if TINT != "none":
    for i, c in enumerate(CHARS):
        tint(c, LINE_TINTS[i % 3] if LINEUP else TINT)

if WIRE:
    wm = bpy.data.materials.new("Wire")
    wm.use_nodes = True
    nt = wm.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.7
    wire = nt.nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = True
    wire.inputs[0].default_value = 0.9
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.inputs[1].default_value = (0.78, 0.78, 0.78, 1)
    mix.inputs[2].default_value = (0.02, 0.02, 0.02, 1)
    nt.links.new(wire.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs[0], b.inputs["Base Color"])
    for c in CHARS:
        for o in c["meshes"]:
            for s in o.material_slots:
                s.material = wm

# ---------- poses ----------
def bone_pos(c, name):
    arm = c["arm"]
    return (arm.matrix_world @ arm.pose.bones[name].matrix).translation.copy()

def set_rest(c):
    c["arm"].data.pose_position = "REST"
    if c["arm"].animation_data:
        c["arm"].animation_data.action = None

def set_clip(c, name, frame, update=True):
    arm = c["arm"]
    arm.data.pose_position = "POSE"
    act = c["actions"][name]
    ad = arm.animation_data
    ad.action = act
    try:
        if ad.action_slot is None and act.slots:
            ad.action_slot = act.slots[0]
    except Exception:
        pass
    c["frame"] = frame
    if update:
        scene.frame_set(int(math.floor(frame)), subframe=frame - math.floor(frame))
        bpy.context.view_layer.update()

def pick_frame(c, name, score):
    a, b = c["actions"][name].frame_range
    best, best_s = None, -1e9
    for f in range(int(math.ceil(a)), int(math.floor(b)) + 1):
        set_clip(c, name, f)
        s = score()
        if s > best_s:
            best, best_s = f, s
    return best

shots = {}
def shoot(name, pitch=6.0, **kw):
    if ONLY and name not in ONLY:
        return None
    if os.environ.get("ANIMAL_ZOOM"):          # debugging close-up
        zz = [float(v) for v in os.environ["ANIMAL_ZOOM"].split(",")]
        kw = dict(kw, aim_z=zz[0], frame_h=zz[1], aim_x=zz[2] if len(zz) > 2 else 0.0)
    place_camera(pitch, **kw)
    path = os.path.join(OUT, f"{PREFIX}_{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    shots[name] = path
    return path

def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)

def save(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = os.path.join(OUT, f"{PREFIX}_{name}.png")
    img.file_format = "PNG"
    img.save()

def sheet(name, keys):
    paths = [shots.get(k) for k in keys]
    if all(paths):
        save("sheet_" + name, np.concatenate([load(p) for p in paths], axis=1))

# =====================================================================================================
if LINEUP:
    n = len(CHARS)
    gap = 0.84
    for i, c in enumerate(CHARS):
        c["root"].location.x = (i - (n - 1) / 2) * gap
    scene.render.resolution_x, scene.render.resolution_y = 1024, 640
    frame_h = (gap * (n - 1) + 1.15) * 640 / 1024
    def pose_all(yaws):
        for c, y in zip(CHARS, yaws):
            set_clip(c, "Idle", 0, update=False)
            c["root"].rotation_euler = (0, 0, math.radians(y))
        scene.frame_set(0)
        bpy.context.view_layer.update()
    pose_all([8, 0, -8][:n])
    shoot("front", pitch=6, frame_h=max(frame_h, HEIGHT * 1.15), aim_z=HEIGHT * 0.5)
    pose_all([180] * n)
    shoot("back", pitch=10, frame_h=max(frame_h, HEIGHT * 1.15), aim_z=HEIGHT * 0.5)
    pose_all([150] * n)
    shoot("gamecam", pitch=30, frame_h=max(frame_h, HEIGHT * 1.2), aim_z=HEIGHT * 0.48)
    # the same view at avatar size (each animal about 90 px tall), enlarged 3x without smoothing so it can be judged
    scene.render.resolution_x, scene.render.resolution_y = 320, 200
    small = shoot("gamecam_tiny", pitch=30, frame_h=max(frame_h, HEIGHT * 1.2), aim_z=HEIGHT * 0.48)
    if small:
        px = load(small)
        save("gamecam_avatar_size_x3", np.repeat(np.repeat(px, 3, axis=0), 3, axis=1))
        os.remove(small)
    print("RENDERED", ENGINE, OUT)
    sys.exit(0)

# ---------- single animal ----------
C = CHARS[0]
names = set(C["actions"])
def yaw(deg):
    C["root"].rotation_euler = (0, 0, math.radians(deg))

# Turnaround, rest pose. Yaw turns the character; the lights and camera stay put.
set_rest(C)
bpy.context.view_layer.update()
for nm, y in (("1_front", 0), ("2_front34", -35), ("3_side", -90), ("4_back", 180), ("5_back34", 145)):
    yaw(y); shoot(nm)

if not WIRE and names:
    stride = lambda: abs(bone_pos(C, "mixamorigLeftFoot").y - bone_pos(C, "mixamorigRightFoot").y)
    hand_high = lambda: max(bone_pos(C, "mixamorigLeftHand").z, bone_pos(C, "mixamorigRightHand").z)
    hand_out = lambda: max(abs(bone_pos(C, "mixamorigLeftHandMiddle1").x), abs(bone_pos(C, "mixamorigRightHandMiddle1").x)) \
        + 0.02 * hand_high()
    def thumbs():   # the held thumbs-up: thumb tip high above its own wrist
        best = -1e9
        for side in ("Left", "Right"):
            pb = C["arm"].pose.bones["mixamorig" + side + "HandThumb3"]
            tip = (C["arm"].matrix_world @ pb.matrix) @ Vector((0, pb.length, 0))
            best = max(best, 2 * tip.z - bone_pos(C, "mixamorig" + side + "Hand").z)
        return best
    def head_yaw():
        pb = C["arm"].pose.bones["mixamorigHead"]
        return abs(((C["arm"].matrix_world @ pb.matrix).to_3x3() @ Vector((0, 0, 1))).x)
    if "Idle" in names:
        set_clip(C, "Idle", 0)
        # what the game shows most: standing idle, seen from behind and above
        yaw(168); shoot("6_gamecam_idle", pitch=32)
        yaw(-20); shoot("6b_idle_front", pitch=10)
    if "Walking" in names:
        set_clip(C, "Walking", pick_frame(C, "Walking", stride))
        print("Walking frame", C["frame"])
        yaw(140); shoot("7_walk_back34", pitch=14)
        yaw(-75); shoot("7b_walk_side", pitch=6)
    if "Wave" in names:
        f = pick_frame(C, "Wave", hand_out)
        set_clip(C, "Wave", f)
        print("Wave widest frame", f)
        yaw(-15); shoot("8_wave_front", pitch=6, frame_h=HEIGHT * 1.3)
        yaw(168); shoot("8b_wave_gamecam", pitch=30, frame_h=HEIGHT * 1.3)
    if "Sitting" in names:
        set_clip(C, "Sitting", pick_frame(C, "Sitting", lambda: -bone_pos(C, "mixamorigHips").z))
        yaw(-35); shoot("9_sit_front34", pitch=14)
        yaw(145); shoot("9b_sit_back34", pitch=20)
    if "ThumbsUp" in names:
        f = pick_frame(C, "ThumbsUp", thumbs)
        set_clip(C, "ThumbsUp", f)
        print("ThumbsUp frame", f)
        yaw(-20); shoot("10_thumbsup_front", pitch=6, frame_h=HEIGHT * 1.25)
        yaw(-75); shoot("10b_thumbsup_side", pitch=10, frame_h=HEIGHT * 1.25)

    # stress sheet: eight small tiles of the clips that bend the mesh hardest
    if not ONLY or "stress" in ONLY:
        keep_only, ONLY = ONLY, None
        scene.render.resolution_x, scene.render.resolution_y = 256, 320
        plan = []
        if "Running" in names:
            plan.append(("Running", pick_frame(C, "Running", stride), 150, 16))
            plan.append(("Running", pick_frame(C, "Running", stride), -60, 8))
        if "Jump" in names:
            plan.append(("Jump", pick_frame(C, "Jump", lambda: bone_pos(C, "mixamorigHips").z), 160, 14))
        if "No" in names:
            plan.append(("No", pick_frame(C, "No", head_yaw), 0, 8))
        if "Yes" in names:
            a, b = C["actions"]["Yes"].frame_range
            plan.append(("Yes", int((a + b) / 2), -60, 8))
        if "Dance" in names:
            a, b = C["actions"]["Dance"].frame_range
            plan.append(("Dance", pick_frame(C, "Dance", hand_high), -25, 8))
            plan.append(("Dance", int(a + (b - a) * 0.33), 150, 16))
            plan.append(("Dance", int(a + (b - a) * 0.7), -150, 16))
        tiles = []
        for i, (clip, f, y, pitch) in enumerate(plan):
            set_clip(C, clip, f)
            print("stress", clip, "frame", f)
            yaw(y)
            tiles.append(shoot(f"s{i}_{clip}", pitch=pitch, frame_h=HEIGHT * 1.45))
        scene.render.resolution_x, scene.render.resolution_y = TILE
        ONLY = keep_only
        if len(tiles) == 8:
            px = [load(p) for p in tiles]
            save("sheet_G_stress", np.concatenate([np.concatenate(px[4:], axis=1), np.concatenate(px[:4], axis=1)], axis=0))  # rows are bottom-up
            for p in tiles:
                os.remove(p)
                shots.pop(os.path.basename(p)[len(PREFIX) + 1:-4], None)

sheet("A_front_front34", ["1_front", "2_front34"])
sheet("B_side_back", ["3_side", "4_back"])
sheet("C_back34_gamecam", ["5_back34", "6_gamecam_idle"])
sheet("D_walk", ["7_walk_back34", "7b_walk_side"])
sheet("E_wave", ["8_wave_front", "8b_wave_gamecam"])
sheet("F_sit", ["9_sit_front34", "9b_sit_back34"])
sheet("H_thumbsup", ["10_thumbsup_front", "10b_thumbsup_side"])
print("RENDERED", ENGINE, OUT)
