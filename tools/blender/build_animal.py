# Builds the ten avatar models of the game:
#   1 MouseToy.glb  2 CatToy.glb  3 BearToy.glb  4 RabbitToy.glb  5 PuppyToy.glb
#   6 PandaToy.glb  7 FoxToy.glb  8 PenguinToy.glb  9 HamsterToy.glb  10 TigerToy.glb
# (the number is the presence field `av`). Mouse, cat and bear are live and cached by URL: rebuild them only into
# a folder outside the repository (to compare), never over the committed files. The script refuses to overwrite
# them in assets/models (and "all" skips them there) unless ANIMAL_OVERWRITE_LIVE=1.
#
# Needs: Blender 4.5 LTS (uses its glTF importer/exporter, voxel remesh and QuadriFlow). Nothing else.
# Run from anywhere:
#   "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" --background --factory-startup
#       --python tools/blender/build_animal.py -- all            (or one key: mouse, cat, bear, rabbit, puppy, panda,
#                                                                  fox, penguin, hamster, tiger; or "new" for the last seven)
#   optional second argument: an output folder (default assets/models)
# Reads:    tools/blender/src/Mousey.glb  - the Mixamo armature (46 joints) and its ten clips; the mouse mesh in it is discarded
# Writes:   assets/models/<Species>Toy.glb - one skinned mesh, materials Fur, Main (hoodie, tinted by the game),
#           Muzzle, Eye, Accent and, for panda, fox and tiger, Patch (dark marks); a material a species does
#           not use is left out of its file. The ten clips Idle, Walking, Running, Dance, Sitting, Wave, Jump,
#           ThumbsUp, Yes, No with their keys thinned (see KEY_TOL_DEG). About 10k triangles and 0.75-0.85 MB each,
#           no textures. One species takes about half a minute; "all" runs them one after another.
# Check:    node tools/blender/inspect_glb.mjs assets/models/BearToy.glb --anims
#           node tools/blender/compare_rig.mjs tools/blender/src/Mousey.glb assets/models/BearToy.glb
# Look:     blender --background --factory-startup --python tools/blender/render_animal.py -- assets/models/BearToy.glb <folder outside the repo>
# Picker:   blender --background --factory-startup --python tools/blender/render_animal.py -- --avatars assets/avatars
#
# One body and hoodie for all ten; the head block, ears, muzzle, tail, face details, colour regions and colours
# come from the species table.
#
# How it works
#   1. Import Mousey.glb at 30 fps, throw the mouse mesh away, keep the armature and its 10 actions.
#   2. Describe the animal as ONE implicit surface (a signed distance field): ellipsoids and rounded cones
#      placed on the armature's rest joints and blended with smooth unions. The hoodie is a second field,
#      1.5 units outside the torso and sleeves, with a collar roll and a hood flap.
#      The arms are modelled ARM_DOWN degrees below the T-pose, because every clip has the arms down.
#   3. Mesh it with surface nets (numpy), make it manifold with a voxel remesh, quad-remesh with QuadriFlow,
#      keep the right half, snap the vertices back onto the exact field, cut edge loops along the material
#      borders (each colour region is a field too: muzzle, inner ear, eye patches, ear tips, dark legs...)
#      and the hood crease, then mirror. Both sides are identical and the skin is one closed surface.
#   4. Normals come from the gradient of the field, per region, so the low-poly skin shades like the smooth
#      form and hem, cuffs, muzzle and hood edge are crisp.
#   5. Skin with Blender's automatic (bone heat) weights against a copy of the armature posed the same
#      ARM_DOWN degrees, fix the weights in numpy, then un-pose every vertex back to the real T rest pose
#      with the inverse of its own blended bone matrix. In the game the mesh is therefore exactly the
#      designed surface when the upper arm is ARM_DOWN degrees down, and only stretches in the T-pose.
#      The head (with its ears, however long) rides the head bone rigidly, so ears never shear.
#   6. Eyes, nose or beak, mouth, drawstrings, the tiger's stripes (thin painted-on ribbons) and the long tails
#      are small closed shells in the same mesh. Tails ride the hip bone rigidly. Export.
import bpy, bmesh, os, sys, math, time, subprocess
import numpy as np
from mathutils import Vector, Matrix, kdtree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WHICH = (argv[0] if argv else "all").lower()
OUT_DIR = os.path.abspath(argv[1]) if len(argv) > 1 else os.path.join(REPO, "assets", "models")
ALL = ("mouse", "cat", "bear", "rabbit", "puppy", "panda", "fox", "penguin", "hamster", "tiger")
LIVE = ALL[:3]           # shipped before the others; players cache these files by URL
GUARD = os.path.normcase(OUT_DIR) == os.path.normcase(os.path.join(REPO, "assets", "models")) and os.environ.get("ANIMAL_OVERWRITE_LIVE") != "1"
if WHICH in ("all", "new"):
    for name in (ALL if WHICH == "all" else ALL[3:]):
        if GUARD and name in LIVE:
            print("skipping", name, "- its committed GLB is live (build it into another folder to compare)")
            continue
        subprocess.run([bpy.app.binary_path, "--background", "--factory-startup", "--python", os.path.abspath(__file__), "--", name, OUT_DIR], check=True)
    sys.exit(0)

SRC = os.path.join(HERE, "src", "Mousey.glb")
OUT = os.path.join(OUT_DIR, WHICH.capitalize() + "Toy.glb")
if GUARD and WHICH in LIVE and os.path.exists(OUT):
    raise SystemExit(OUT + " is live and cached by URL: build it into another folder, or set ANIMAL_OVERWRITE_LIVE=1")
T0 = time.time()

def log(*a):
    print("[%s %6.1fs]" % (WHICH, time.time() - T0), *a)
    sys.stdout.flush()

# ------------------------------------------------------------------ shared parameters
GRID = 1.0            # surface-nets cell
HALF_QUADS = 2100     # QuadriFlow target for the right half
KEY_TOL_DEG = float(os.environ.get("ANIMAL_KEY_TOL", "0.2"))   # animation keys are thinned while every bone stays this close
KEY_MAX_GAP = 4                                                # ...and no two kept keys are more than this many frames apart
ARM_DOWN = 40.0       # degrees below the T-pose the arms are modelled at
CLOTH_T = 1.5         # hoodie thickness over the fur
HEM_Z = 36.0
CUFF_X = 33.5         # along the arm, in T-pose units from the body axis

# ------------------------------------------------------------------ species table (colours are linear RGB)
SPECIES = {
    "bear": dict(
        fur=(0.86, 0.70, 0.48),        # warm cream
        muzzle=(1.00, 0.93, 0.82),     # muzzle patch, eye glints, drawstrings
        accent=(0.72, 0.42, 0.30),     # inner ears
        eye=(15.0, 96.6),
        nose=dict(z=94.6, r=(3.5, 2.5, 2.2), mat="Eye", sink=0.55),
        mouth=dict(style="smile", w=5.2, z=89.9, d=2.0, top=92.4),
    ),
    "mouse": dict(
        fur=(0.56, 0.62, 0.72),        # cool light grey
        muzzle=(0.96, 0.96, 1.00),
        accent=(0.90, 0.40, 0.46),     # pink: inner ears, nose, tail
        eye=(13.6, 97.6),
        nose=dict(z=92.6, r=(2.6, 2.2, 2.0), mat="Accent", sink=0.4),
        mouth=dict(style="smile", w=3.4, z=88.3, d=1.3, top=90.6),
    ),
    "cat": dict(
        fur=(0.92, 0.54, 0.26),        # soft ginger
        muzzle=(1.00, 0.94, 0.84),     # muzzle patch, tail tip
        accent=(0.92, 0.45, 0.47),     # pink: inner ears, nose
        eye=(15.0, 97.0),
        nose=dict(z=93.3, r=(2.4, 1.8, 1.6), mat="Accent", sink=0.45),
        mouth=dict(style="cat", w=4.6, z=90.3, d=1.6, top=92.0),
    ),
    # ---- the seven added later. Optional keys: patch (colour of the extra "Patch" material), regions (colour regions
    # in priority order, see REGIONS), bbox_z (top of the meshing box), eye_ring, brows, stripes, mouth=None.
    "rabbit": dict(
        fur=(0.86, 0.84, 0.82),        # very light warm grey-white
        muzzle=(1.00, 1.00, 1.00),     # muzzle, eye glints, drawstrings
        accent=(0.93, 0.42, 0.52),     # pink: inner ears, nose
        eye=(14.2, 97.2),
        nose=dict(z=93.2, r=(2.5, 1.9, 1.7), mat="Accent", sink=0.45),
        mouth=dict(style="cat", w=4.0, z=90.3, d=1.5, top=92.0),
        bbox_z=158.0,
    ),
    "puppy": dict(
        fur=(0.80, 0.38, 0.12),        # shiba: warm caramel
        muzzle=(1.00, 0.90, 0.74),     # cream: muzzle, cheeks, inner ears, brow dots, tail tip
        accent=(0.92, 0.45, 0.47),     # (unused)
        eye=(14.6, 97.4),
        nose=dict(z=94.4, r=(3.6, 2.5, 2.3), mat="Eye", sink=0.55),
        mouth=dict(style="cat", w=4.6, z=90.0, d=1.7, top=92.2),
        regions=[("muzzle_region", "Muzzle"), ("ear_region", "Muzzle")],
        brows=[(8.6, 106.2, (2.1, 1.5, 0.7))],
    ),
    "panda": dict(
        fur=(0.90, 0.90, 0.88),        # white
        muzzle=(1.00, 0.98, 0.95),     # muzzle, eye rings, glints, drawstrings
        accent=(0.92, 0.45, 0.47),     # (unused)
        patch=(0.018, 0.018, 0.022),   # black: ears, eye patches, arms below the cuff, legs below the hem
        eye=(14.6, 97.0),
        nose=dict(z=94.4, r=(3.4, 2.4, 2.1), mat="Eye", sink=0.55),
        mouth=dict(style="smile", w=4.6, z=89.9, d=1.8, top=92.3),
        regions=[("patch_region", "Patch"), ("muzzle_region", "Muzzle")],
        body_regions=[("limb_region", "Patch")],
        eye_ring=(5.0, 6.0, 1.35),
    ),
    "fox": dict(
        fur=(0.90, 0.32, 0.07),        # fox orange
        muzzle=(1.00, 0.97, 0.92),     # white: muzzle and cheeks, inner ears, tail tip
        accent=(0.92, 0.45, 0.47),     # (unused)
        patch=(0.10, 0.045, 0.03),     # dark brown ear tips
        eye=(14.4, 97.4),
        nose=dict(z=93.0, r=(2.6, 1.9, 1.8), mat="Eye", sink=0.45),
        mouth=dict(style="smile", w=3.6, z=88.6, d=1.4, top=91.2),
        regions=[("patch_region", "Patch"), ("muzzle_region", "Muzzle"), ("ear_region", "Muzzle")],
        bbox_z=146.0,
    ),
    "penguin": dict(
        fur=(0.030, 0.040, 0.085),     # dark navy
        muzzle=(1.00, 1.00, 1.00),     # white face mask, glints, drawstrings
        accent=(1.00, 0.40, 0.04),     # orange: beak and feet
        eye=(11.8, 97.0),
        nose=dict(z=91.6, r=(4.6, 3.0, 3.4), mat="Accent", sink=0.30),    # the beak
        mouth=None,
        regions=[("muzzle_region", "Muzzle")],
        body_regions=[("feet_region", "Accent")],
    ),
    "hamster": dict(
        fur=(0.95, 0.50, 0.13),        # golden
        muzzle=(1.00, 0.97, 0.92),     # white: muzzle and cheeks
        accent=(0.93, 0.45, 0.50),     # pink: inner ears, nose
        eye=(13.4, 98.4),
        nose=dict(z=93.6, r=(2.2, 1.7, 1.6), mat="Accent", sink=0.45),
        mouth=dict(style="cat", w=3.6, z=90.6, d=1.4, top=92.4),
    ),
    "tiger": dict(
        fur=(0.98, 0.42, 0.06),        # tiger orange
        muzzle=(1.00, 0.96, 0.88),     # white: muzzle and cheeks, inner ears
        accent=(0.93, 0.45, 0.50),     # pink nose
        patch=(0.035, 0.025, 0.022),   # stripes, backs of the ears, tail rings
        eye=(14.8, 97.2),
        nose=dict(z=93.8, r=(3.0, 2.1, 1.9), mat="Accent", sink=0.5),
        mouth=dict(style="cat", w=4.8, z=90.2, d=1.7, top=92.3),
        regions=[("patch_region", "Patch"), ("muzzle_region", "Muzzle"), ("ear_region", "Muzzle")],
        # painted-on stripes: (x, z) control points on the front of the head and the half-width; wide at the first point,
        # pointed at the last; mirrored unless on the middle line
        stripes=[
            ([(0.0, 123.5), (0.0, 119.0), (0.0, 114.5)], 2.0),          # forehead: one down the middle...
            ([(10.5, 121.5), (7.6, 118.2), (5.6, 114.2)], 1.7),         # ...and a slanted one each side
            ([(16.5, 117.0), (12.4, 114.2), (10.0, 110.8)], 1.45),
            ([(28.2, 97.0), (24.8, 95.4), (21.8, 94.6)], 1.65),         # cheeks: two from the side inwards
            ([(28.0, 90.0), (25.0, 89.2), (22.4, 89.4)], 1.5),
        ],
    ),
}
if WHICH not in SPECIES:
    raise SystemExit("species must be one of: " + ", ".join(SPECIES) + ", all, new")
SP = SPECIES[WHICH]
MAIN_GREY = (0.86, 0.86, 0.86)         # hoodie: neutral light grey, the game multiplies in the player colour
EYE_DARK = (0.035, 0.022, 0.02)

# ------------------------------------------------------------------ scene and armature
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30   # clips are 30 fps; importing at 30 keeps every key on a whole frame
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    me = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.meshes.remove(me)
for pb in arm.pose.bones:
    pb.custom_shape = None
for block in (bpy.data.materials, bpy.data.images, bpy.data.textures):
    for item in list(block):
        block.remove(item)
arm.name = "Armature"
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
BONES = [b.name for b in arm.data.bones]
assert len(BONES) == 46, len(BONES)
B = {n: i for i, n in enumerate(BONES)}
bi = lambda n: B["mixamorig" + n]
log("armature bones", len(BONES), "actions", sorted(a.name for a in bpy.data.actions))

def joint(name, tail=False):
    b = arm.data.bones["mixamorig" + name]
    return np.array(arm.matrix_world @ (b.tail_local if tail else b.head_local))

SH = joint("LeftArm"); WR = joint("LeftHand")
HP = joint("LeftUpLeg"); AN = joint("LeftFoot")
TH0 = joint("LeftHandThumb1"); TH1 = joint("LeftHandThumb3", True)

# ------------------------------------------------------------------ signed distance field helpers
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)

def smax(a, b, k):
    return -smin(-a, -b, k)

def sstep(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def ellipsoid(p, c, r, frame=None):
    """frame: 3x3 whose columns are the ellipsoid's own axes in world space."""
    q = p - np.asarray(c, float)
    if frame is not None:
        q = q @ frame            # world -> local
    r = np.asarray(r, float)
    k0 = np.linalg.norm(q / r, axis=-1)
    k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

def sphere(p, c, r):
    return np.linalg.norm(p - np.asarray(c, float), axis=-1) - r

def rcone(p, a, b, ra, rb):
    a = np.asarray(a, float); b = np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / ab.dot(ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1) - (ra + (rb - ra) * t)

def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

def rot_y(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def rot_z(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

_ca, _sa = math.cos(math.radians(ARM_DOWN)), math.sin(math.radians(ARM_DOWN))
def arm_space(q):
    """Where a point of the modelled (arms-down) pose sits in the T-pose arm: rotate up about the shoulder."""
    out = np.array(q, dtype=float, copy=True)
    dx = q[..., 0] - SH[0]; dz = q[..., 2] - SH[2]
    out[..., 0] = SH[0] + dx * _ca - dz * _sa
    out[..., 2] = SH[2] + dx * _sa + dz * _ca
    return out

# ------------------------------------------------------------------ head blocks (everything is for +X and evaluated at |x|)
MUZZLE_C = {"bear": (0.0, -25.0, 91.5), "mouse": (0.0, -26.0, 91.5), "cat": (0.0, -24.5, 91.0),
            "rabbit": (0.0, -24.5, 91.5), "puppy": (0.0, -25.0, 90.6), "panda": (0.0, -25.0, 91.5),
            "fox": (0.0, -25.5, 90.2), "penguin": (0.0, -25.0, 91.5), "hamster": (0.0, -24.5, 91.6),
            "tiger": (0.0, -25.0, 91.2)}[WHICH]
TAIL_C = np.array([0.0, 19.2, 44.0])     # bear: a pom-pom sitting on the hoodie

def head_bear(q):
    skull = ellipsoid(q, (0, -1.5, 100.5), (29.0, 26.5, 26.0))
    jowl = ellipsoid(q, (0, -3.0, 94.5), (28.0, 24.5, 18.5))
    head = smin(skull, jowl, 6.0)
    ear_c = np.array([20.0, 1.0, 122.5]); dish = np.array([20.0, -8.0, 123.0])
    ear = ellipsoid(q, ear_c, (9.8, 7.2, 9.8))
    ear = smax(ear, -sphere(q, dish, 6.4), 1.5)
    head = smin(head, ear, 3.5)
    head = smin(head, ellipsoid(q, MUZZLE_C, (11.0, 7.0, 8.0)), 3.0)
    return dict(head=head,
                muzzle_region=ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (12.0, 9.0, 8.8)),
                ear_region=sphere(q, dish, 6.9))

def head_mouse(q):
    skull = ellipsoid(q, (0, -1.5, 100.5), (27.5, 26.0, 25.5))
    jowl = ellipsoid(q, (0, -3.0, 94.5), (26.0, 23.5, 18.5))
    head = smin(skull, jowl, 6.0)
    # big round ears, set low and wide: discs leaning outwards and turned a little to the side
    fr = rot_z(9) @ rot_y(24)
    ear_c = np.array([27.0, 3.5, 114.5])
    ear = ellipsoid(q, ear_c, (15.5, 5.0, 15.5), fr)
    front = fr @ np.array([0.0, -1.0, 0.0])
    ear = smax(ear, -ellipsoid(q, ear_c + front * 5.4, (12.2, 3.2, 12.2), fr), 1.2)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (8.5, 10.0, 7.5)), 4.5)     # narrow and pointed
    return dict(head=head,
                muzzle_region=ellipsoid(q, np.array(MUZZLE_C) + (0, -2.0, -0.4), (9.4, 10.6, 8.3)),
                ear_region=ellipsoid(q, ear_c + front * 4.8, (12.9, 3.6, 12.9), fr))

def head_cat(q):
    skull = ellipsoid(q, (0, -1.5, 99.5), (29.0, 26.0, 24.5))
    cheeks = ellipsoid(q, (0, -3.0, 93.5), (28.5, 24.0, 17.5))
    head = smin(skull, cheeks, 6.0)
    # pointed upright ears: a rounded cone, flattened front to back
    flat = 1.6
    def squash(p, y0):
        out = np.array(p, copy=True); out[..., 1] = y0 + (p[..., 1] - y0) * flat
        return out
    ear = rcone(squash(q, 1.5), (15.5, 1.5, 111.0), (23.5, 1.5, 130.0), 12.5, 2.8) / flat
    inner = rcone(q, (17.0, -6.0, 114.5), (22.3, -2.4, 127.0), 7.4, 1.4)
    ear = smax(ear, -inner, 1.0)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (9.5, 6.0, 6.5)), 3.0)
    return dict(head=head,
                muzzle_region=ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (10.5, 8.0, 7.3)),
                ear_region=inner - 0.7)

def flat_cone(q, a, b, ra, rb, flat, y0):
    """Rounded cone flattened front to back by `flat` about the plane y = y0 (give a and b with y = y0)."""
    s = np.array(q, copy=True)
    s[..., 1] = y0 + (q[..., 1] - y0) * flat
    return rcone(s, a, b, ra, rb) / flat

def head_rabbit(q):
    skull = ellipsoid(q, (0, -1.5, 100.0), (27.5, 25.5, 25.0))
    cheeks = ellipsoid(q, (0, -3.0, 93.5), (27.5, 23.5, 17.5))
    head = smin(skull, cheeks, 6.0)
    # long upright ears, widest in the middle, flattened front to back and splayed a little; a pink dish in front
    a, m, b = (9.6, 3.0, 115.5), (12.8, 3.0, 132.0), (15.4, 3.0, 145.0)
    ear = smin(flat_cone(q, a, m, 5.4, 7.3, 1.9, 3.0), flat_cone(q, m, b, 7.3, 5.2, 1.9, 3.0), 2.5)
    inner = smin(rcone(q, (10.4, -3.0, 120.0), (12.9, -3.0, 132.0), 3.0, 4.4),
                 rcone(q, (12.9, -3.0, 132.0), (14.8, -2.6, 142.0), 4.4, 2.6), 2.0)
    ear = smax(ear, -inner, 1.0)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (9.0, 6.0, 6.5)), 3.0)
    return dict(head=head,
                muzzle_region=ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (10.0, 8.0, 7.3)),
                ear_region=inner - 0.6)

def head_puppy(q):
    skull = ellipsoid(q, (0, -1.5, 100.0), (29.0, 26.0, 24.5))
    cheeks = ellipsoid(q, (0, -3.0, 93.0), (29.5, 24.0, 17.5))
    head = smin(skull, cheeks, 6.0)
    # triangular upright ears, a little forward, cream inside
    ear = flat_cone(q, (16.0, 1.0, 111.5), (21.0, 1.0, 130.0), 11.5, 2.6, 1.7, 1.0)
    inner = rcone(q, (17.6, -5.2, 117.0), (20.6, -2.4, 127.0), 6.2, 1.3)
    ear = smax(ear, -inner, 1.0)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (10.5, 7.5, 7.0)), 3.0)
    # the cream mask: muzzle plus the lower cheeks
    mz = ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (11.5, 9.0, 8.0))
    cheek = ellipsoid(q, (13.0, -19.0, 87.0), (10.0, 10.0, 6.0))
    return dict(head=head, muzzle_region=smin(mz, cheek, 3.0), ear_region=np.maximum(inner - 0.7, 1.0 - smin(skull, cheeks, 6.0)))

def head_panda(q):
    skull = ellipsoid(q, (0, -1.5, 100.5), (29.0, 26.5, 26.0))
    jowl = ellipsoid(q, (0, -3.0, 94.5), (28.5, 24.5, 18.5))
    head = smin(skull, jowl, 6.0)
    ear_c = np.array([20.5, 2.0, 122.0])
    ear = ellipsoid(q, ear_c, (9.0, 6.8, 9.0))
    head = smin(head, ear, 3.5)
    head = smin(head, ellipsoid(q, MUZZLE_C, (10.5, 6.5, 7.5)), 3.0)
    # black: the round ears (down to where they leave the skull) and tilted eye patches, low and outwards
    ears = np.maximum(ellipsoid(q, ear_c, (10.8, 8.6, 10.8)), 0.6 - skull)
    patch = ellipsoid(q, (15.8, -21.5, 95.2), (7.3, 9.0, 9.2), rot_y(-28))
    return dict(head=head,
                muzzle_region=ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (11.5, 8.5, 8.5)),
                patch_region=np.minimum(ears, patch))

def head_fox(q):
    skull = ellipsoid(q, (0, -1.5, 99.5), (29.0, 26.0, 24.5))
    cheeks = ellipsoid(q, (0, -3.0, 92.5), (30.5, 24.0, 17.0))
    head = smin(skull, cheeks, 6.0)
    # big pointed ears with dark tips, white inside
    a, b = np.array([15.0, 1.5, 110.0]), np.array([25.0, 1.5, 137.0])
    ear = flat_cone(q, a, b, 13.0, 2.4, 1.7, 1.5)
    inner = rcone(q, (17.2, -5.4, 116.5), (23.4, -2.6, 131.5), 7.2, 1.3)
    ear = smax(ear, -inner, 1.0)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (9.0, 8.0, 6.5)), 3.5)       # a pointed snout
    L = float(np.linalg.norm(b - a)); u = (b - a) / L
    tip = np.maximum(ear - 1.5, L * 0.66 - (q - a) @ u)
    mz = ellipsoid(q, np.array(MUZZLE_C) + (0, -1.2, -0.3), (10.0, 9.5, 7.5))
    cheek = ellipsoid(q, (13.5, -17.5, 88.0), (12.5, 11.0, 7.0))
    return dict(head=head, muzzle_region=smin(mz, cheek, 3.0), ear_region=np.maximum(inner - 0.7, 1.0 - smin(skull, cheeks, 6.0)), patch_region=tip)

def head_penguin(q):
    skull = ellipsoid(q, (0, -1.5, 100.5), (28.0, 26.0, 26.5))
    jowl = ellipsoid(q, (0, -3.0, 94.0), (27.0, 24.0, 18.5))
    head = smin(skull, jowl, 6.0)
    # no ears, no muzzle bump: a white heart-shaped face mask round the eyes and beak
    lobe = ellipsoid(q, (9.0, -21.0, 97.5), (10.0, 10.0, 11.5))
    chin = ellipsoid(q, (0, -21.0, 88.5), (14.5, 10.0, 9.0))
    return dict(head=head, muzzle_region=smin(lobe, chin, 4.0))

def head_hamster(q):
    skull = ellipsoid(q, (0, -1.0, 100.5), (27.0, 25.5, 24.5))
    jowl = ellipsoid(q, (0, -2.5, 93.5), (28.0, 24.0, 17.5))
    head = smin(skull, jowl, 6.0)
    puff = ellipsoid(q, (17.5, -9.5, 89.0), (14.5, 13.0, 12.5))           # round, chubby cheek pouches
    head = smin(head, puff, 5.0)
    ear_c = np.array([18.0, 2.5, 120.0]); dish = ear_c + (0, -6.0, 0.5)    # small round ears
    ear = ellipsoid(q, ear_c, (7.2, 5.2, 7.2))
    ear = smax(ear, -sphere(q, dish, 4.6), 1.2)
    head = smin(head, ear, 3.0)
    head = smin(head, ellipsoid(q, MUZZLE_C, (7.5, 5.5, 5.8)), 3.0)
    white = smin(smin(ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.4), (8.5, 8.0, 7.0)),        # muzzle, cheeks and chin
                      ellipsoid(q, (17.0, -13.5, 86.5), (15.0, 13.5, 10.5)), 4.0),             # in one piece
                 ellipsoid(q, (0, -16.0, 84.5), (15.0, 12.0, 7.5)), 4.0)
    return dict(head=head, muzzle_region=white, ear_region=sphere(q, dish, 5.0))

def head_tiger(q):
    skull = ellipsoid(q, (0, -1.5, 100.0), (29.5, 26.5, 25.0))
    cheeks = ellipsoid(q, (0, -3.0, 93.0), (30.5, 24.0, 17.5))
    head = smin(skull, cheeks, 6.0)
    ear_c = np.array([20.5, 1.5, 120.5]); dish = ear_c + (0, -8.0, 0.5)    # round ears: white inside, dark back
    ear = ellipsoid(q, ear_c, (9.4, 6.8, 9.4))
    ear = smax(ear, -sphere(q, dish, 6.0), 1.5)
    head = smin(head, ear, 3.5)
    head = smin(head, ellipsoid(q, MUZZLE_C, (11.0, 7.0, 7.5)), 3.0)
    back = np.maximum(np.maximum(ellipsoid(q, ear_c, (10.8, 8.4, 10.8)), (ear_c[1] + 0.8) - q[..., 1]), 0.6 - skull)
    white = smin(ellipsoid(q, np.array(MUZZLE_C) + (0, -1.0, -0.2), (12.0, 9.0, 8.6)),
                 ellipsoid(q, (13.5, -18.5, 87.5), (11.5, 10.5, 7.0)), 3.0)
    return dict(head=head, muzzle_region=white, ear_region=sphere(q, dish, 6.5), patch_region=back)

HEAD = {"bear": head_bear, "mouse": head_mouse, "cat": head_cat, "rabbit": head_rabbit, "puppy": head_puppy,
        "panda": head_panda, "fox": head_fox, "penguin": head_penguin, "hamster": head_hamster, "tiger": head_tiger}[WHICH]
# short tails that are part of the skin (they poke out through a snug hole in the hoodie); long ones are shells, below
POM = {"bear": lambda q: sphere(q, TAIL_C, 5.0),
       "rabbit": lambda q: sphere(q, (0.0, 19.6, 44.0), 6.2),                         # round cotton tail
       "panda": lambda q: sphere(q, (0.0, 18.8, 43.5), 5.0),
       "hamster": lambda q: sphere(q, (0.0, 16.8, 41.0), 3.4),                        # tiny
       "penguin": lambda q: rcone(q, (0.0, 14.5, 39.5), (0.0, 23.0, 34.5), 5.2, 1.8),  # short and pointed
       }.get(WHICH)
# colour regions on the body (below the hem and past the cuffs): fields < 0 inside, like the head regions
BODY_REGIONS = {
    "panda": lambda q, z, xa, arm_, tail: dict(limb_region=np.minimum(np.maximum(z - 44.0, 0.3 - tail),
                                                                      np.maximum((CUFF_X - 1.5) - xa, arm_ - 4.0))),
    "penguin": lambda q, z, xa, arm_, tail: dict(feet_region=z - 10.0),
}.get(WHICH)
# faces take the first region they are inside (the hoodie always wins); edge loops are cut along each border in this order
REGIONS = SP.get("regions", [("muzzle_region", "Muzzle"), ("ear_region", "Accent")])
BODY_REGION_MATS = SP.get("body_regions", [])

def parts(p):
    """All component distances at points p (N,3), in the modelled pose. Units are the armature's (about cm)."""
    q = np.array(p, dtype=float, copy=True)
    q[..., 0] = np.abs(q[..., 0])
    x, y, z = q[..., 0], q[..., 1], q[..., 2]
    qa = arm_space(q)
    xa = qa[..., 0]
    d = dict(HEAD(q))
    head = d["head"]
    # ---- body. The clips bring the wrists within ~14 units of the spine, so the torso stays slim
    # and the roundness goes into the belly, front and back.
    chest = ellipsoid(q, (0, -0.5, 54.0), (14.0, 13.0, 20.5))
    belly = ellipsoid(q, (0, -2.2, 42.0), (16.0, 16.2, 15.5))
    torso = smin(chest, belly, 7.0)
    yoke = rcone(q, (0.0, SH[1], SH[2] - 0.8), (11.5, SH[1], SH[2] - 0.3), 8.2, 7.2)   # round shoulders
    torso = smin(torso, yoke, 5.0)
    armcone = rcone(qa, (10.5, SH[1], SH[2] + 0.2), (WR[0] - 1.0, WR[1], WR[2] - 0.1), 5.6, 5.0)
    # mitten: one pad for the four fingers (it bends at the knuckles) and a separate thumb on the thumb bones
    # (as long as the rig's own fingers, so a raised hand shows past the big head)
    mitten = ellipsoid(qa, (WR[0] + 8.6, WR[1] - 0.2, WR[2] - 0.4), (10.2, 7.4, 5.6))
    tdir = (TH1 - TH0) / np.linalg.norm(TH1 - TH0)
    thumb = rcone(qa, TH0 - tdir * 1.0, TH1 + tdir * 5.5, 3.4, 3.0)     # longer than the bones: it has to show past the pad
    arm_ = smin(smin(armcone, mitten, 2.5), thumb, 1.3)
    # the leg axis sits 1.5 outside the bone so thick legs still leave a gap a 2-unit mesh can resolve
    legcone = rcone(q, (HP[0] + 1.5, HP[1], HP[2] + 0.8), (AN[0] + 1.7, AN[1] - 0.4, AN[2] + 1.4), 9.3, 8.5)
    foot = ellipsoid(q, (AN[0] + 1.9, -5.0, 5.9), (9.2, 13.2, 6.5))
    leg = smin(legcone, foot, 3.0)
    leg = smax(leg, -0.3 - z, 1.2)                       # flat sole just under z = 0, like the mouse (-0.34)
    body = smin(torso, arm_, 3.5)
    body = smin(body, leg, 5.0)
    tail = POM(q) if POM else np.full(x.shape, 1e3)
    body = smin(body, tail, 1.2)
    d["body"] = body
    if BODY_REGIONS:
        d.update(BODY_REGIONS(q, z, xa, arm_, tail))
    d["fur"] = smin(head, body, 2.0)
    # ---- hoodie: torso and sleeves grown outwards, flaring a little at hem and cuffs
    torso_c = torso - (CLOTH_T + 1.3 * (1 - sstep(HEM_Z, HEM_Z + 10.0, z)))
    torso_c = smax(torso_c, HEM_Z - z, 1.0)
    sleeve_c = armcone - (CLOTH_T + 1.0 * sstep(CUFF_X - 8.0, CUFF_X, xa))
    sleeve_c = smax(sleeve_c, xa - CUFF_X, 1.0)
    cloth_a = smin(torso_c, sleeve_c, 3.5)
    # collar: an elliptical ring round the base of the head, fatter at the back where the hood gathers
    cx, cy, cz, ax, ay = 0.0, 1.0, 72.3, 13.0, 11.8
    ring = (np.sqrt((x / ax) ** 2 + ((y - cy) / ay) ** 2) - 1.0) * (ax + ay) * 0.5
    collar = np.sqrt(ring ** 2 + (z - cz) ** 2) - (3.3 + 1.3 * sstep(-4.0, 10.0, y))
    hood = ellipsoid(q, (0, 13.6, 61.5), (13.5, 4.4, 12.5), rot_x(10))      # a flat rounded flap on the back
    cloth_b = smin(collar, hood, 3.0)
    hole = -(tail - 0.8)                                  # the pom-pom pokes out through a snug hole
    cloth_a = smax(cloth_a, hole, 0.8)
    cloth_b = smax(cloth_b, hole, 0.8)
    d["cloth_a"] = cloth_a                                # body and sleeves
    d["cloth_b"] = cloth_b                                # collar roll and hood flap
    cloth = smin(cloth_a, cloth_b, 0.5)                   # nearly sharp: the flap edge is a real crease
    d["cloth"] = cloth
    d["nothead"] = np.minimum(body, cloth)
    d["total"] = smin(d["fur"], cloth, 0.6)
    return d

def F(name):
    return lambda p: parts(p)[name]

total = F("total")

def grad(fn, p, eps=0.04):
    g = np.empty_like(p)
    for i in range(3):
        dp = np.zeros(3); dp[i] = eps
        g[:, i] = (fn(p + dp) - fn(p - dp)) / (2 * eps)
    return g

def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)

def project(p, fn=total, iters=8, keep_x0=None):
    p = np.array(p, dtype=float)
    for _ in range(iters):
        f = fn(p)
        g = grad(fn, p)
        step = (f / np.maximum((g * g).sum(1), 1e-9))[:, None] * g
        p = p - np.clip(step, -1.5, 1.5)
        if keep_x0 is not None:
            p[keep_x0, 0] = 0.0
    return p

# ------------------------------------------------------------------ surface nets (numpy)
def surface_nets(fn, lo, hi, h):
    n = np.ceil((np.array(hi) - np.array(lo)) / h).astype(int) + 1
    axes = [lo[i] + h * np.arange(n[i]) for i in range(3)]
    f = np.empty(n)
    for i, xv in enumerate(axes[0]):                      # slab by slab to keep memory small
        yy, zz = np.meshgrid(axes[1], axes[2], indexing="ij")
        pts = np.stack([np.full(yy.shape, xv), yy, zz], -1).reshape(-1, 3)
        f[i] = fn(pts).reshape(n[1], n[2])
    cells = n - 1
    sumpos = np.zeros((*cells, 3))
    cnt = np.zeros(cells)
    quads_idx = []
    for a in range(3):
        o1, o2 = (a + 1) % 3, (a + 2) % 3
        s0 = [slice(None)] * 3; s1 = [slice(None)] * 3
        s0[a] = slice(0, -1); s1[a] = slice(1, None)
        f0, f1 = f[tuple(s0)], f[tuple(s1)]
        cross = (f0 < 0) != (f1 < 0)
        idx = np.argwhere(cross)
        t = f0[cross] / (f0[cross] - f1[cross])
        pos = idx.astype(float)
        pos[:, a] += t
        ring = []
        ok = np.ones(len(idx), bool)
        for d1, d2 in ((0, 0), (-1, 0), (-1, -1), (0, -1)):
            c = idx.copy()
            c[:, o1] += d1; c[:, o2] += d2
            valid = (c[:, o1] >= 0) & (c[:, o1] < cells[o1]) & (c[:, o2] >= 0) & (c[:, o2] < cells[o2])
            ok &= valid
            cv = c[valid]
            np.add.at(sumpos, (cv[:, 0], cv[:, 1], cv[:, 2]), pos[valid])
            np.add.at(cnt, (cv[:, 0], cv[:, 1], cv[:, 2]), 1)
            ring.append(c)
        quads_idx.append((ring, ok, f0[cross] < 0))
    mask = cnt > 0
    vid = -np.ones(cells, dtype=np.int64)
    vid[mask] = np.arange(mask.sum())
    verts = np.array(lo) + h * (sumpos[mask] / cnt[mask][:, None])
    quads = []
    for ring, ok, inside_first in quads_idx:
        q = np.stack([vid[c[:, 0].clip(0, cells[0] - 1), c[:, 1].clip(0, cells[1] - 1), c[:, 2].clip(0, cells[2] - 1)] for c in ring], 1)
        q = q[ok]
        flip = ~inside_first[ok]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    return verts, np.concatenate(quads)

V, Q = surface_nets(total, (-58.0, -42.0, -4.0), (58.0, 30.0, SP.get("bbox_z", 140.0)), GRID)
V = project(V, iters=4)
log("dense mesh", len(V), "verts", len(Q), "quads")

def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

me = bpy.data.meshes.new("dense")
me.from_pydata([tuple(v) for v in V], [], [tuple(int(i) for i in f) for f in Q])
me.update()
body = bpy.data.objects.new(WHICH.capitalize(), me)
scene.collection.objects.link(body)
activate(body)
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(body.data)
bm.free()

# Surface nets can leave a non-manifold edge where two sheets share a cell (between the legs).
# A voxel remesh at about the same cell size returns a guaranteed manifold skin; the vertices are
# snapped back onto the exact field later, so nothing is lost.
body.data.remesh_voxel_size = GRID * 0.9
body.data.use_remesh_fix_poles = False
bpy.ops.object.voxel_remesh()

# ------------------------------------------------------------------ remesh to the budget, symmetric
def diag(bm, label):
    bnd = [e for e in bm.edges if e.is_boundary]
    nm = [e for e in bm.edges if not e.is_manifold and not e.is_boundary]
    if bnd or nm:
        where = ["(%.1f %.1f %.1f)" % tuple((e.verts[0].co + e.verts[1].co) / 2) for e in (nm + bnd)[:6]]
        log("topology", label, "boundary", len(bnd), "non-manifold", len(nm), " ".join(where))
    return len(bnd), len(nm)

dense = body.data.copy()      # the dense skin, kept so a retry can start from it again

def right_half(seed):
    """Quad-remesh the closed skin, then cut it at the mirror plane and keep x >= 0.
    QuadriFlow's own symmetry option leaves a ragged, unwelded seam, so the cut is done here:
    vertices near the plane are put on it first, which keeps the cut from leaving slivers.
    Returns (bmesh, set of seam vertices), or None when the seam is not a clean set of loops."""
    old = body.data
    body.data = dense.copy()
    if old is not dense:
        bpy.data.meshes.remove(old)
    activate(body)
    res = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=False, use_preserve_sharp=False, use_preserve_boundary=False,
                                           preserve_attributes=False, smooth_normals=False, mode="FACES",
                                           target_faces=HALF_QUADS * 2, seed=seed)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    if "FINISHED" not in res or any(diag(bm, "after remesh")):
        bm.free()
        return None
    for v in bm.verts:
        if abs(v.co.x) < 0.55:
            v.co.x = 0.0
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(1, 0, 0),
                           clear_inner=True, dist=1e-4)
    flat = [f for f in bm.faces if all(abs(v.co.x) < 1e-5 for v in f.verts)]
    if flat:
        bmesh.ops.delete(bm, geom=flat, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    seam = set()
    for v in bm.verts:
        if abs(v.co.x) < 1e-5:
            v.co.x = 0.0
            seam.add(v)
    stray = [e for e in bm.edges if e.is_boundary and not all(v in seam for v in e.verts)]
    pinch = [v for v in seam if sum(1 for e in v.link_edges if e.is_boundary) != 2]
    nonman = [e for e in bm.edges if not e.is_manifold and not e.is_boundary]
    log("quadriflow seed", seed, "right half", len(bm.verts), "verts", len(bm.faces), "faces | seam", len(seam),
        "stray", len(stray), "pinched", len(pinch), "non-manifold", len(nonman))
    if stray or pinch or nonman:
        bm.free()
        return None
    return bm, seam

for seed in range(10):
    got = right_half(seed)
    if got:
        break
else:
    raise RuntimeError("no clean seam after 10 remesh attempts")
bm, onplane = got
bm.verts.ensure_lookup_table()

def bm_project(bm, fn=total, iters=10):
    bm.verts.ensure_lookup_table()
    co = np.array([v.co[:] for v in bm.verts])
    x0 = np.array([v in onplane for v in bm.verts])
    co = project(co, fn, iters, keep_x0=x0)
    for v, c in zip(bm.verts, co):
        v.co = c

def relax(bm, rounds=3, lam=0.5):
    # tangential smoothing: evens out the quads, then the projection puts the vertices back on the form
    for _ in range(rounds):
        new = {}
        for v in bm.verts:
            nb = [e.other_vert(v) for e in v.link_edges]
            if v in onplane:
                nb = [w for w in nb if w in onplane]
            if not nb:
                continue
            avg = sum((w.co for w in nb), Vector()) / len(nb)
            new[v] = v.co.lerp(avg, lam)
        for v, c in new.items():
            v.co = c
            if v in onplane:
                v.co.x = 0.0
        bm_project(bm, iters=3)

bm_project(bm)
relax(bm)
bm_project(bm)

# ------------------------------------------------------------------ cut along the paint borders
def contour_cut(bm, fn, snap=0.24, mask=None):
    """Insert an edge loop where fn == 0 so material borders are clean lines, not stair-steps.
    mask(p) <= 0 limits the cut to part of the surface (used for the hood crease, which only exists on the hoodie)."""
    bm.verts.ensure_lookup_table()
    co = np.array([v.co[:] for v in bm.verts])
    f = fn(co)
    inside = np.ones(len(co), bool) if mask is None else (mask(co) <= 0.02)
    fv = {v: float(f[i]) for i, v in enumerate(bm.verts)}
    ok = {v: bool(inside[i]) for i, v in enumerate(bm.verts)}
    for e in bm.edges:
        a, b = e.verts
        if not (ok[a] and ok[b]):
            continue
        fa, fb = fv[a], fv[b]
        if fa * fb < 0:
            t = fa / (fa - fb)
            if t < snap and (a not in onplane or b in onplane):
                a.co = a.co.lerp(b.co, t); fv[a] = 0.0
            elif t > 1 - snap and (b not in onplane or a in onplane):
                b.co = a.co.lerp(b.co, t); fv[b] = 0.0
    zero = [v for v in bm.verts if fv[v] == 0.0 and ok[v]]
    for e in list(bm.edges):
        a, b = e.verts
        if not (ok.get(a, True) and ok.get(b, True)):
            continue
        fa, fb = fv[a], fv[b]
        if fa * fb < 0:
            t = fa / (fa - fb)
            ne, nv = bmesh.utils.edge_split(e, a, t)
            fv[nv] = 0.0; ok[nv] = True
            zero.append(nv)
            if a in onplane and b in onplane:
                onplane.add(nv); nv.co.x = 0.0
    bmesh.ops.connect_verts(bm, verts=zero, check_degenerate=True)
    if zero:   # slide the border vertices onto the exact curve (fn == 0 on the surface)
        p = np.array([v.co[:] for v in zero])
        x0 = np.array([v in onplane for v in zero])
        for _ in range(6):
            n = unit(grad(total, p))
            g = grad(fn, p)
            g -= (g * n).sum(1)[:, None] * n
            step = (fn(p) / np.maximum((g * g).sum(1), 1e-6))[:, None] * g
            p = p - np.clip(step, -0.8, 0.8)
            p[x0, 0] = 0.0
            p = project(p, total, 2, keep_x0=x0)
        for v, c in zip(zero, p):
            v.co = c

cloth_minus_fur = lambda p: (lambda d: d["cloth"] - d["fur"])(parts(p))
hood_minus_body = lambda p: (lambda d: d["cloth_b"] - d["cloth_a"])(parts(p))
fur_minus_cloth = lambda p: (lambda d: d["fur"] - d["cloth"])(parts(p))
contour_cut(bm, cloth_minus_fur)
for name, _ in REGIONS:                       # mouse, cat, bear: muzzle_region, then ear_region
    contour_cut(bm, F(name))
for name, _ in BODY_REGION_MATS:              # only on the fur: the borders lie under the hem and cuffs
    contour_cut(bm, F(name), mask=fur_minus_cloth)
contour_cut(bm, hood_minus_body, mask=cloth_minus_fur)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])

# mirror to the left side and weld the seam
bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), merge_dist=0.0005, axis="X")
bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if abs(v.co.x) < 1e-4], dist=0.001)
if any(e.is_boundary for e in bm.edges):
    log("seam left holes: filling")
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=12)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.normal_update()
diag(bm, "after mirror")

# ------------------------------------------------------------------ materials (same five names for every species)
def material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    return m

MATS = {
    "Fur": material("Fur", SP["fur"], 0.62),
    "Main": material("Main", MAIN_GREY, 0.58),
    "Muzzle": material("Muzzle", SP["muzzle"], 0.60),
    "Eye": material("Eye", EYE_DARK, 0.18),
    "Accent": material("Accent", SP["accent"], 0.60),
}
if "patch" in SP:
    MATS["Patch"] = material("Patch", SP["patch"], 0.62)
SLOT = {n: i for i, n in enumerate(MATS)}
for m in MATS.values():
    body.data.materials.append(m)

bm.faces.ensure_lookup_table()
cent = np.array([f.calc_center_median()[:] for f in bm.faces])
dc = parts(cent)
is_cloth = dc["cloth"] < dc["fur"]
paint = np.full(len(cent), SLOT["Fur"])
for name, mat in reversed(REGIONS + BODY_REGION_MATS):     # the first region in the list wins
    paint[dc[name] < 0] = SLOT[mat]
paint[is_cloth] = SLOT["Main"]
for f, k in zip(bm.faces, paint):
    f.material_index = int(k)
    f.smooth = True
bm.to_mesh(body.data)
bm.free()
body.data.update()
me = body.data
N_BODY_V = len(me.vertices)
N_BODY_T = sum(len(p.vertices) - 2 for p in me.polygons)
log("body skin", N_BODY_V, "verts", N_BODY_T, "tris")

# ------------------------------------------------------------------ skinning in the modelled pose
# A copy of the armature gets its upper arms turned ARM_DOWN degrees and that pose applied as its rest pose.
armA = arm.copy()
armA.data = arm.data.copy()
armA.animation_data_clear()
scene.collection.objects.link(armA)
armA.data.pose_position = "POSE"
activate(armA)
bpy.ops.object.mode_set(mode="POSE")
for pb in armA.pose.bones:            # the copy still holds whatever frame of Idle was last evaluated
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
ARM_ROT = {}
for side, sgn in (("Left", 1.0), ("Right", -1.0)):
    bone = armA.data.bones["mixamorig" + side + "Arm"]
    head = bone.head_local.copy()
    D = Matrix.Translation(head) @ Matrix.Rotation(math.radians(sgn * ARM_DOWN), 4, "Y") @ Matrix.Translation(-head)
    armA.pose.bones[bone.name].matrix = D @ bone.matrix_local
    ARM_ROT[side] = (np.array(D.to_3x3()), np.array(head))
bpy.context.view_layer.update()
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
chk = np.array(armA.data.bones["mixamorigLeftHand"].head_local)
log("posed copy: left wrist at", np.round(chk, 1), "(T-pose", np.round(WR, 1), ")")

activate(body)
armA.select_set(True)
bpy.context.view_layer.objects.active = armA
res = bpy.ops.object.parent_set(type="ARMATURE_AUTO")

def read_weights(ob):
    W = np.zeros((len(ob.data.vertices), len(BONES)))
    gi = {g.index: B[g.name] for g in ob.vertex_groups if g.name in B}
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group in gi:
                W[v.index, gi[g.group]] = g.weight
    return W

def write_weights(ob, W):
    ob.vertex_groups.clear()
    groups = [ob.vertex_groups.new(name=n) for n in BONES]   # all 46, so the skin keeps every joint
    for j, g in enumerate(groups):
        for i in np.nonzero(W[:, j] > 0)[0]:
            g.add([int(i)], float(W[i, j]), "REPLACE")

W = read_weights(body)
unweighted = np.nonzero(W.sum(1) < 1e-6)[0]
log("auto weights", res, "verts without weights", len(unweighted))
co = np.empty(N_BODY_V * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
if len(unweighted):   # stray vertices: nearest bone segment of the posed copy
    heads = np.array([armA.data.bones[n].head_local[:] for n in BONES]); tails = np.array([armA.data.bones[n].tail_local[:] for n in BONES])
    ab = tails - heads
    for i in unweighted:
        t = np.clip(((co[i] - heads) * ab).sum(1) / (ab * ab).sum(1), 0, 1)
        W[i, int(np.linalg.norm(co[i] - (heads + t[:, None] * ab), axis=1).argmin())] = 1.0
# the posed copy has done its job; the mesh goes onto the real armature
body.modifiers.clear()
body.parent = None
bpy.data.objects.remove(armA, do_unlink=True)

# 1. mitten: index, middle and ring bones all drive one finger pad through the middle finger's first joint,
#    so a fist folds the pad at the knuckles. The thumb keeps its own three bones.
for side in ("Left", "Right"):
    pad = bi(side + "HandMiddle1")
    for n in BONES:
        if n.startswith("mixamorig" + side + "Hand") and any(k in n for k in ("Index", "Middle", "Ring")) and B[n] != pad:
            W[:, pad] += W[:, B[n]]; W[:, B[n]] = 0
# 2. no cross-talk between the two sides
left = np.array(["Left" in n for n in BONES]); right = np.array(["Right" in n for n in BONES])
W[np.ix_(co[:, 0] < -1.0, left)] = 0
W[np.ix_(co[:, 0] > 1.0, right)] = 0
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)

edges = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get("vertices", edges); edges = edges.reshape(-1, 2)
def smooth_weights(W, rounds, lam, mask=None):
    for _ in range(rounds):
        acc = np.zeros_like(W); deg = np.zeros(len(W))
        np.add.at(acc, edges[:, 0], W[edges[:, 1]]); np.add.at(acc, edges[:, 1], W[edges[:, 0]])
        np.add.at(deg, edges[:, 0], 1); np.add.at(deg, edges[:, 1], 1)
        S = (1 - lam) * W + lam * acc / np.maximum(deg, 1)[:, None]
        W = S if mask is None else np.where(mask[:, None], S, W)
    return W

hand_zone = arm_space(np.abs(co) * (1, 0, 0) + co * (0, 1, 1))[:, 0] > WR[0] - 2.0
W = smooth_weights(W, 2, 0.5, mask=~hand_zone)       # the small hand keeps its sharp finger and thumb weights
near = np.zeros(N_BODY_V, bool)                       # shoulders and hips fold the most: spread those wider
for c, r in ((SH, 16.0), (HP, 12.0)):
    for sx in (1, -1):
        near |= np.linalg.norm(co - c * np.array([sx, 1, 1]), axis=1) < r
W = smooth_weights(W, 8, 0.5, mask=near)
# 3. head, ears and muzzle ride the head bone rigidly; only a narrow band at the neck crease blends
dp = parts(co)
s = dp["nothead"] - dp["head"]                       # > 0 on the head, < 0 on body and hoodie
t = np.clip((s + 1.2) / 3.6, 0, 1)
w_head = t * t * (3 - 2 * t)
Wb = W.copy()
Wb[:, bi("Neck")] += Wb[:, bi("Head")]               # the body may follow the neck, never the head
Wb[:, bi("Head")] = 0
Wb /= np.maximum(Wb.sum(1, keepdims=True), 1e-9)
W = Wb * (1 - w_head)[:, None]
W[:, bi("Head")] += w_head
# 4. the hoodie hangs from the hips and spine: thighs slide under the hem instead of dragging it.
#    Only the front of the hem gives way a little, so a raised knee lifts it instead of coming through it.
is_cloth_v = dp["cloth"] < dp["fur"] + 0.3
front = sstep(2.0, -6.0, co[:, 1])
for side in ("Left", "Right"):
    up = bi(side + "UpLeg")
    cap = np.where(is_cloth_v, (0.12 + 0.43 * front) * (1 - np.clip((co[:, 2] - HEM_Z) / 7.0, 0, 1)), 1.0)
    extra = np.maximum(W[:, up] - cap, 0)
    W[:, up] -= extra
    W[:, bi("Hips")] += extra
    for n in ("Leg", "Foot", "ToeBase"):
        j = bi(side + n)
        e2 = np.where(is_cloth_v, W[:, j], 0)
        W[:, j] -= e2; W[:, bi("Hips")] += e2
# 5. at most four influences, normalised
order = np.argsort(-W, axis=1)
keep = np.zeros_like(W, dtype=bool)
np.put_along_axis(keep, order[:, :4], True, axis=1)
W = np.where(keep & (W > 0.01), W, 0)
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
write_weights(body, W)
log("weights fixed: max influences", int((W > 0).sum(1).max()), "rigid head verts", int((w_head > 0.999).sum()))

# ------------------------------------------------------------------ small shells: face, drawstrings, tails
def surface_hit(x, z, y0=-48.0):
    """Front surface point at (x, z), marching along +Y."""
    y = y0
    for _ in range(300):
        dval = float(total(np.array([[x, y, z]]))[0])
        if dval < 0.01:
            break
        y += max(dval * 0.8, 0.01)
    pt = np.array([[x, y, z]])
    return pt[0], unit(grad(total, pt))[0]

def frame(n, up=(0, 0, 1)):
    n = Vector(n).normalized()
    t1 = Vector(up).cross(n).normalized()
    t2 = n.cross(t1).normalized()
    return Matrix((t1, t2, n)).transposed()      # columns: right, up, out

def finish(name, bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m); bm.free()
    for p in m.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, m)
    scene.collection.objects.link(ob)
    for mt in (mat if isinstance(mat, (list, tuple)) else [mat]):
        m.materials.append(mt)
    return ob

def blob(name, centre, n, radii, mat, segs=(14, 8), sink=0.5, shift=(0, 0)):
    """Ellipsoid glued to the surface. radii = (right, up, out); sink = how much of the 'out' radius is buried."""
    R = frame(n)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    c = Vector(centre) + R @ Vector((shift[0], shift[1], 0)) - Vector(n).normalized() * (radii[2] * (2 * sink - 1))
    bm.transform(Matrix.Translation(c) @ R.to_4x4() @ Matrix.Diagonal((radii[0], radii[1], radii[2], 1)))
    return finish(name, bm, mat)

def tube(name, pts, radius, mat, sides=5):
    """Thin closed tube lying on the surface: mouth lines and drawstrings."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        p = Vector(p)
        a = Vector(pts[max(i - 1, 0)]); b = Vector(pts[min(i + 1, len(pts) - 1)])
        tan = (b - a).normalized()
        nrm = Vector(unit(grad(total, np.array([p[:]])))[0])
        side = tan.cross(nrm).normalized()
        r = radius * (0.55 if i in (0, len(pts) - 1) else 1.0)
        rings.append([bm.verts.new(p + (side * math.cos(k * 2 * math.pi / sides) + nrm * math.sin(k * 2 * math.pi / sides)) * r) for k in range(sides)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    return finish(name, bm, mat)

def tail_tube(name, keys, r0, r1, mats, tip_from=2.0, sides=8, rings=18, radius=None, band=None):
    """A free-standing tail: a smooth curve through the key points, tapering from r0 to r1, round tip.
    mats = (main material, tip material); rings past tip_from (0..1 along the tail) take the tip material.
    radius(u) and band(u) (u = 0..1 along the tail) override the straight taper and the tip rule: a bushy tail,
    a ringed tail. With radius, r1 must be radius(1)."""
    P = [np.array(k, float) for k in keys]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    pts = []
    for i in range(rings):
        u = i / (rings - 1) * (len(keys) - 1)
        k = min(int(u), len(keys) - 2); f = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        pts.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3))
    bm = bmesh.new()
    loops = []
    nrm = Vector((1, 0, 0))
    for i, p in enumerate(pts):
        tan = Vector(pts[min(i + 1, rings - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = (nrm - tan * nrm.dot(tan)).normalized()          # parallel transport keeps the rings from twisting
        bin_ = tan.cross(nrm)
        r = r0 + (r1 - r0) * i / (rings - 1) if radius is None else radius(i / (rings - 1))
        loops.append([bm.verts.new(Vector(p) + (nrm * math.cos(k * 2 * math.pi / sides) + bin_ * math.sin(k * 2 * math.pi / sides)) * r) for k in range(sides)])
    tan = Vector(pts[-1] - pts[-2]).normalized()
    cap = [bm.verts.new(Vector(pts[-1]) + tan * r1 * 0.55 + (v.co - Vector(pts[-1])) * 0.62) for v in loops[-1]]
    tipv = bm.verts.new(Vector(pts[-1]) + tan * r1 * 0.95)
    loops.append(cap)
    for i, (a, b) in enumerate(zip(loops, loops[1:])):
        for k in range(sides):
            f = bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
            u = i / (rings - 1)
            f.material_index = int(band(u)) if band else 1 if u >= tip_from else 0
    for k in range(sides):
        f = bm.faces.new((cap[k], cap[(k + 1) % sides], tipv))
        f.material_index = int(band(1.0)) if band else 1 if tip_from <= 1.0 else 0
    bm.faces.new(loops[0][::-1])
    return finish(name, bm, list(mats))

def ribbon(name, xz, half_w, mat, thick=0.5, sides=6, n=9):
    """A painted-on stripe: a thin flat shell along the front surface through the (x, z) points, wide at the
    first point and pointed at the last. Half of it is buried, so it reads as paint with a soft edge."""
    P = [np.array(k, float) for k in xz]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    pts, nrms = [], []
    for i in range(n):
        u = i / (n - 1) * (len(xz) - 1)
        k = min(int(u), len(xz) - 2); f = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        x, z = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)
        pt, nr = surface_hit(x, z)
        pts.append(Vector(pt)); nrms.append(Vector(nr))
    bm = bmesh.new()
    rings = []
    for i, (p, nr) in enumerate(zip(pts, nrms)):
        u = i / (n - 1)
        tan = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = tan.cross(nr).normalized()
        w = half_w * max(0.10, math.sin(math.pi * (0.28 + 0.72 * u)))
        c = p + nr * 0.05
        rings.append([bm.verts.new(c + side * (math.cos(a) * w) + nr * (math.sin(a) * thick))
                      for a in (k * 2 * math.pi / sides for k in range(sides))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    return finish(name, bm, mat)

head_parts, body_parts, hip_parts = [], [], []
EX, EZ = SP["eye"]
for sx in (1, -1):
    pt, n = surface_hit(sx * EX, EZ)
    head_parts.append(blob("Eye", pt, n, (3.3, 4.3, 1.8), MATS["Eye"], segs=(20, 8), sink=0.62))
    # glint: same screen-side on both eyes, like one light source
    head_parts.append(blob("Glint", pt, n, (0.85, 0.95, 0.5), MATS["Muzzle"], segs=(7, 4), sink=-0.35, shift=(-0.9, 1.5)))
NO = SP["nose"]
pt, n = surface_hit(0.0, NO["z"])
head_parts.append(blob("Nose", pt, n, NO["r"], MATS[NO["mat"]], segs=(18, 8), sink=NO["sink"]))
MO = SP["mouth"]
mouth = []
for k in (range(11) if MO else ()):
    u = -1 + 2 * k / 10
    if MO["style"] == "cat":      # two small arcs meeting under the nose
        xs, zs = MO["w"] * u, MO["z"] - MO["d"] * math.sin(math.pi * abs(u)) ** 0.8
    else:                         # one shallow smile
        ang = math.radians(58 * u)
        xs, zs = MO["w"] * math.sin(ang), MO["z"] - MO["d"] * (math.cos(ang) - math.cos(math.radians(58)))
    p, n = surface_hit(xs, zs)
    mouth.append(p + n * 0.05)
if MO:      # the penguin has a beak instead
    head_parts.append(tube("Mouth", mouth, 0.42, MATS["Eye"]))
    mid_z = MO["z"] if MO["style"] == "cat" else MO["z"] - MO["d"] * (1 - math.cos(math.radians(58))) - 0.2
    philtrum = []
    for k in range(3):
        p, n = surface_hit(0.0, MO["top"] + (mid_z - MO["top"]) * k / 2)
        philtrum.append(p + n * 0.05)
    head_parts.append(tube("Philtrum", philtrum, 0.42, MATS["Eye"]))
if "eye_ring" in SP:      # panda: a white ring keeps the eyes readable inside the black patches
    for sx in (1, -1):
        pt, n = surface_hit(sx * EX, EZ)
        head_parts.append(blob("EyeRing", pt, n, SP["eye_ring"], MATS["Muzzle"], segs=(20, 8), sink=0.62))
for bx, bz, br in SP.get("brows", []):      # shiba: cream dots above the eyes
    for sx in (1, -1):
        pt, n = surface_hit(sx * bx, bz)
        head_parts.append(blob("Brow", pt, n, br, MATS["Muzzle"], segs=(12, 6), sink=0.45))
for xz, hw in SP.get("stripes", []):     # tiger
    for sx in ((1,) if all(abs(x) < 1e-6 for x, _ in xz) else (1, -1)):
        head_parts.append(ribbon("Stripe", [(sx * x, z) for x, z in xz], hw, MATS["Patch"]))

# hoodie drawstrings: two short cords with a knot, the cheapest thing that says "hoodie" from the front
for sx in (1, -1):
    pts = []
    for k in range(6):
        pnt, nrm = surface_hit(sx * (3.6 + 0.22 * k), 69.8 - 2.1 * k, y0=-30.0)
        pts.append(pnt + nrm * 0.3)
    body_parts.append(tube("Cord", pts, 0.72, MATS["Muzzle"]))
    body_parts.append(blob("Knot", pts[-1], unit(grad(total, np.array([pts[-1]])))[0], (1.25, 1.6, 1.1), MATS["Muzzle"], segs=(7, 4), sink=0.3))

# long tails are free-standing shells on the hips (the rig has no tail bones); the bear's pom-pom is part of the skin
if WHICH == "mouse":      # long and thin, trailing low with the tip turned up
    hip_parts.append(tail_tube("Tail", [(0, 9, 30), (1.5, 20, 26), (4, 31, 21), (7, 42, 18), (9.5, 52, 18.5), (10, 60, 23), (8, 65, 30), (5, 67, 37)],
                               2.7, 1.4, (MATS["Accent"], MATS["Accent"]), sides=7, rings=20))
elif WHICH == "cat":      # thick, standing up behind the back in a curve, pale tip
    hip_parts.append(tail_tube("Tail", [(0, 9, 32.5), (0, 20, 32), (0.5, 28, 36), (2, 32.5, 45), (4, 33.5, 54), (7, 32, 62.5), (10.5, 29, 69), (14, 25.5, 73)],
                               4.4, 3.5, (MATS["Fur"], MATS["Muzzle"]), tip_from=0.78, sides=9, rings=20))
elif WHICH == "puppy":    # shiba: up from the rump and curled over onto the back, cream tip
    hip_parts.append(tail_tube("Tail", [(0, 9, 33), (0, 18, 32.5), (1, 26.5, 35), (2, 32, 42), (3, 31, 50), (3.5, 25.5, 53.5), (3.5, 20.5, 50), (3, 20.5, 44.5)],
                               5.0, 3.4, (MATS["Fur"], MATS["Muzzle"]), tip_from=0.74, sides=9, rings=22))
elif WHICH == "fox":      # big and bushy, sweeping out and up, white tip
    hip_parts.append(tail_tube("Tail", [(0, 9, 33), (1, 18, 31.5), (3, 27.5, 34), (6, 34.5, 41), (9, 38, 50), (11, 37.5, 59), (12, 33.5, 67)],
                               3.4, 3.4, (MATS["Fur"], MATS["Muzzle"]), tip_from=0.8, sides=10, rings=22,
                               radius=lambda u: 3.4 + 7.6 * math.sin(math.pi * u ** 1.3)))
elif WHICH == "tiger":    # like the cat's, with dark rings and a dark tip
    rings_at = ((0.36, 0.44), (0.54, 0.62), (0.72, 0.80))
    hip_parts.append(tail_tube("Tail", [(0, 9, 32.5), (0, 20, 32), (0.5, 28, 36), (2, 32.5, 45), (4, 33.5, 54), (7, 32, 62.5), (10.5, 29, 69), (14, 25.5, 73)],
                               4.3, 3.5, (MATS["Fur"], MATS["Patch"]), sides=9, rings=24,
                               band=lambda u: u >= 0.9 or any(a <= u < b for a, b in rings_at)))

for ob in head_parts:
    ob.vertex_groups.new(name="mixamorigHead").add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
for ob in hip_parts:
    ob.vertex_groups.new(name="mixamorigHips").add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
kd = kdtree.KDTree(N_BODY_V)
for i, c in enumerate(co):
    kd.insert(c, i)
kd.balance()
for ob in body_parts:     # cords take the weights of the skin they lie on
    groups = {}
    for v in ob.data.vertices:
        _, idx, _ = kd.find(v.co)
        for j in np.nonzero(W[idx] > 0)[0]:
            g = groups.get(j) or groups.setdefault(j, ob.vertex_groups.new(name=BONES[j]))
            g.add([v.index], float(W[idx, j]), "REPLACE")

for o in bpy.context.view_layer.objects:
    o.select_set(False)
for ob in head_parts + body_parts + hip_parts:
    ob.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
me = body.data
if dense.users == 0:
    bpy.data.meshes.remove(dense)
body.name = me.name = WHICH.capitalize()

# ------------------------------------------------------------------ normals from the field (still in the modelled pose)
nv = len(me.vertices)
co = np.empty(nv * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
vn = np.array([v.normal[:] for v in me.vertices])
nl = len(me.loops)
lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
loop_n = vn[lv].copy()
pm = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("material_index", pm)
lt = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
loop_mat = np.repeat(pm, lt)
slots = [s.material.name for s in body.material_slots]
main_slot = slots.index("Main")
is_body_loop = lv < N_BODY_V
g_fur = unit(grad(F("fur"), co[:N_BODY_V]))
g_cloth = unit(grad(F("cloth_a"), co[:N_BODY_V]))
g_hood = unit(grad(F("cloth_b"), co[:N_BODY_V]))
g_tot = unit(grad(total, co[:N_BODY_V]))
pc = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("center", pc); pc = pc.reshape(-1, 3)
dpc = parts(pc)
loop_hood = np.repeat(dpc["cloth_b"] < dpc["cloth_a"], lt)
# Fur, hoodie body and hood each take the normal of their own surface, so hem and flap edge read as crisp edges.
sel_c = is_body_loop & (loop_mat == main_slot)
sel_f = is_body_loop & (loop_mat != main_slot)
sel_h = sel_c & loop_hood
loop_n[sel_c] = g_cloth[lv[sel_c]]
loop_n[sel_h] = g_hood[lv[sel_h]]
loop_n[sel_f] = g_fur[lv[sel_f]]
bad = is_body_loop & ((loop_n * g_tot[np.minimum(lv, N_BODY_V - 1)]).sum(1) < 0.5)   # component normal off: use the blended one
loop_n[bad] = g_tot[lv[bad]]

# ------------------------------------------------------------------ un-pose to the real T rest pose
# In the game: p_posed = (sum_j w_j M_j) p_rest. The arms were modelled with M = "upper arm ARM_DOWN degrees down"
# for the arm chain and identity elsewhere, so p_rest = (sum_j w_j M_j)^-1 p_modelled, vertex by vertex.
Wall = read_weights(body)
Wall /= np.maximum(Wall.sum(1, keepdims=True), 1e-9)
L = np.zeros((nv, 3, 3)); tvec = np.zeros((nv, 3))
w_rest = np.ones(nv)
for side in ("Left", "Right"):
    R, c = ARM_ROT[side]
    chain = np.array([n.startswith("mixamorig" + side) and any(k in n for k in ("Arm", "Hand")) for n in BONES])
    w = Wall[:, chain].sum(1)
    w_rest -= w
    L += w[:, None, None] * R
    tvec += w[:, None] * (c - R @ c)
L += w_rest[:, None, None] * np.eye(3)
Linv = np.linalg.inv(L)
co_rest = np.einsum("nij,nj->ni", Linv, co - tvec)
loop_n = unit(np.einsum("nji,nj->ni", L[lv], loop_n))      # normals go with the transpose of L
me.vertices.foreach_set("co", co_rest.ravel())
me.update()
me.normals_split_custom_set([tuple(n) for n in loop_n])
me.update()
moved = np.linalg.norm(co_rest - co, axis=1)
log("un-posed: vertices moved", int((moved > 0.01).sum()), "max", round(float(moved.max()), 1))

# bind to the real armature (weights are already in the vertex groups)
body.parent = arm
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = arm

# ------------------------------------------------------------------ checks
bm = bmesh.new(); bm.from_mesh(me)
n_open = sum(1 for e in bm.edges if e.is_boundary)
n_nm = sum(1 for e in bm.edges if not e.is_manifold)
zmin = min(v.co.z for v in bm.verts); zmax = max(v.co.z for v in bm.verts)
bm.free()
tris = sum(len(p.vertices) - 2 for p in me.polygons)
log("final mesh", nv, "verts", tris, "tris (skin %d, shells %d)" % (N_BODY_T, tris - N_BODY_T), "materials", slots)
log("boundary edges", n_open, "non-manifold edges", n_nm, "z range", round(zmin, 2), round(zmax, 2))

# ------------------------------------------------------------------ export
# Clip lengths: 4.1667 s * 30 is 124.99999 in float, and the exporter would drop that last frame.
for act in bpy.data.actions:
    a, b = act.frame_range
    act.use_frame_range = True
    act.frame_start, act.frame_end = round(a), round(b)

# Smaller file without an external packer: the clips are 30 fps keys on every bone, about 690 KB per animal.
# Thin them per bone: a key is dropped when interpolating between its kept neighbours lands within KEY_TOL_DEG
# of it (0.02 units for the hip position). First and last key always stay, so every clip keeps its length.
def thin_keys(act):
    groups = {}
    for fc in act.fcurves:
        groups.setdefault(fc.data_path, []).append(fc)
    before = after = 0
    for path, fcs in groups.items():
        fcs.sort(key=lambda f: f.array_index)
        n = len(fcs[0].keyframe_points)
        if n < 3 or any(len(fc.keyframe_points) != n for fc in fcs):
            continue
        frames = np.array([kp.co[0] for kp in fcs[0].keyframe_points])
        vals = np.array([[kp.co[1] for kp in fc.keyframe_points] for fc in fcs]).T
        rot = path.endswith("rotation_quaternion")
        if rot:
            vals = vals / np.linalg.norm(vals, axis=1, keepdims=True)
        def fits(a, b):
            for k in range(a + 1, b):
                u = (frames[k] - frames[a]) / (frames[b] - frames[a])
                v = vals[a] * (1 - u) + vals[b] * u
                if rot:
                    ang = 2 * math.degrees(math.acos(min(1.0, abs(float(v @ vals[k])) / float(np.linalg.norm(v)))))
                    if ang > KEY_TOL_DEG:
                        return False
                elif np.abs(v - vals[k]).max() > 0.02:
                    return False
            return True
        keep, a = {0}, 0
        while a < n - 1:
            b = min(n - 1, a + KEY_MAX_GAP)
            while b > a + 1 and not fits(a, b):
                b -= 1
            keep.add(b); a = b
        for fc in fcs:
            for i in sorted(set(range(n)) - keep, reverse=True):
                fc.keyframe_points.remove(fc.keyframe_points[i], fast=True)
            fc.update()
        before += n; after += len(keep)
    return before, after
tb = ta = 0
for act in bpy.data.actions:
    b_, a_ = thin_keys(act)
    tb += b_; ta += a_
log("animation keys kept", ta, "of", tb, "(tolerance %.2f deg, max gap %d frames)" % (KEY_TOL_DEG, KEY_MAX_GAP))

arm.data.pose_position = "POSE"
for o in bpy.context.view_layer.objects:
    o.select_set(False)
arm.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_yup=True,
    export_apply=False, export_texcoords=False, export_normals=True, export_tangents=False,
    export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
    export_skins=True, export_all_influences=False, export_def_bones=False, export_morph=False,
    export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=False,   # write the thinned keys as they are
    export_frame_range=False, export_anim_single_armature=True, export_reset_pose_bones=True,
    export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=False,
    export_rest_position_armature=True,
)
log("exported", OUT, os.path.getsize(OUT) // 1024, "KB")
