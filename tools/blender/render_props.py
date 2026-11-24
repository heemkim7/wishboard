# Renders pictures of the prop GLBs that tools/blender/build_props.py writes (the five plot buildings, the taxi,
# the plaza tree, the air dancer): a three-quarter view of each on the dark navy backdrop of the game's icons, a
# 256 px icon of each building framed like icons/lot.jpg ... tower.jpg, a contact sheet and a before/after sheet.
# Needs Blender 4.5 LTS. It renders the exported GLB itself (not the build scene), so the picture is the model the
# game would load. Nothing is written into the repository: the default folders are <repository>/out/blender/...
#
#   blender --background --factory-startup --python tools/blender/render_props.py -- all
#   blender --background --factory-startup --python tools/blender/render_props.py -- lot2_pocha taxi [--dummy]
#   options: --glb <dir>     where the GLBs are (default out/blender/glb)
#            --out <dir>     where the pictures go (default out/blender/renders)
#            --tint #rrggbb  the owner's colour put on the `Accent` material (default #ff5a3c; the empty lot has no
#                            owner and is always drawn with the game's unowned colour, TINT_OF below)
#            --dummy         add a plain 1.6 m figure for scale and write <name>_dummy.png instead of the final files
#            --bare          leave out the stand-in screen and name sign (shows the bare mounts)
#            --no-sheets     skip sheet.png and compare_buildings.png
#            --no-spill      leave out the small coloured lamps beside the glowing parts
#            --frame <0..1>  where in its clip a rigged model is shown (default 0.2); given explicitly it writes a small
#                            <name>_fNNN.png instead of the final files, to check the motion frame by frame
#            --frames <n>    for a rigged model: n evenly spaced frames of its clip on one sheet, <name>_frames.png
#            --icons-only    skip the big picture
#            --jpg <dir>     also write each building's interface icon as a JPEG into <dir> under the name the game
#                            asks for (lot.jpg, tent.jpg, pocha.jpg, shop.jpg, tower.jpg; 256 x 256, at most 20 KB):
#                            --jpg icons from the repository root replaces the pictures ui.js LEVELS shows
#            --az <deg> --pitch <deg>   camera for the big picture (default 35 and 20)
#
# Writes <name>.png (768 x 768), sheet.png, compare_buildings.png and, for the buildings, two 256 x 256 icons:
#   <name>_icon.png       for the interface: framed on the building itself (the FOCUS box below) from closer and lower
#                         (32 degrees to the side, 14 to 21 up), the stand-in screen switched off (dark navy, at most
#                         12% bright: "a screen goes here") so the building is the subject; the tent's and the
#                         stall's board runs out of the top of the picture
#   <name>_icon_full.png  the whole lot with its board lit, as the game shows it (35 degrees to the side, 26 up)
#
# What is in the picture besides the model:
#   - a stand-in screen and a stand-in name sign where the game mounts them (a soft gradient and a glowing bar: no
#     artwork, no lettering), with the game's own 0.16 m board frame. That is where BoardAnchor and SignAnchor say,
#     but for the tower's sign, which the game stands on the board's top rim (SIGN_AT below, ts3d/layout.js LOT.faces);
#   - for the assets that have no lot pad, a plain round floor so they do not float;
#   - small coloured lamps next to the model's glowing parts, because Eevee does not let a glowing surface light its
#     surroundings, and a bloom added afterwards. Engine: Eevee Next; PROPS_CYCLES=1 falls back to Cycles on the CPU.
import bpy, sys, os, math, zlib, struct, tempfile
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ROOT = REPO.split(os.sep + ".claude" + os.sep + "worktrees" + os.sep)[0]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPT = {"--glb": os.path.join(ROOT, "out", "blender", "glb"), "--out": os.path.join(ROOT, "out", "blender", "renders"),
       "--tint": "#ff5a3c", "--az": "35", "--pitch": "20", "--frame": "0.2", "--frames": "0", "--jpg": ""}
FRAME_GIVEN = "--frame" in argv
FLAGS, names, i = set(), [], 0
while i < len(argv):
    if argv[i] in OPT:
        OPT[argv[i]] = argv[i + 1]; i += 2
    elif argv[i].startswith("--"):
        FLAGS.add(argv[i]); i += 1
    else:
        names.append(argv[i].lower()); i += 1
GLB_DIR, OUT = os.path.abspath(OPT["--glb"]), os.path.abspath(OPT["--out"])
ALL = ("lot0_empty", "lot1_tent", "lot2_pocha", "lot3_shop", "lot4_tower", "taxi", "xmas_tree", "air_dancer")
LOTS = ALL[:5]
OLD_ICON = dict(lot0_empty="lot.jpg", lot1_tent="tent.jpg", lot2_pocha="pocha.jpg", lot3_shop="shop.jpg", lot4_tower="tower.jpg")
# What the small icon is framed on, in the game's axes (x0, x1, y0, y1, z0, z1): the building itself, not the whole
# pad. Where the box stops below the board (tent, stall) the board runs out of the top of the picture.
FOCUS = dict(lot0_empty=(-2.7, 2.7, 0.0, 5.05, 0.3, 3.0), lot1_tent=(-3.1, 3.1, 0.0, 3.1, -2.1, 2.7),
             lot2_pocha=(-4.15, 4.0, 0.0, 4.2, -1.6, 3.0), lot3_shop=(-4.5, 5.0, 0.0, 9.0, -3.3, 3.5),
             lot4_tower=(-4.2, 4.2, 0.0, 19.0, -3.3, 4.3))
ICON_PITCH = dict(lot0_empty=16.0, lot1_tent=21.0, lot2_pocha=21.0, lot3_shop=16.0, lot4_tower=14.0)   # the low ones from a little higher: their pad fills the picture's foot
ICON_SCREEN = ("#0a1020", "#151e36")       # the stand-in screen in the interface icons: switched off, dark navy from its foot to its top (at most 12% bright)
# Where the game draws a name sign that is not at the model's SignAnchor, in the game's axes (ts3d/layout.js LOT.faces):
# the tower's plate is on its crown, behind the board; the game stands the sign on the board's top rim.
SIGN_AT = dict(lot4_tower=(0.0, 17.1, 3.4))
JPG_DIR = os.path.abspath(OPT["--jpg"]) if OPT["--jpg"] else ""
JPG_MAX = 20000                            # bytes: the quality goes down from 92 until the icon fits
FRAMES = int(OPT["--frames"])
DUMMY, BARE = "--dummy" in FLAGS, "--bare" in FLAGS
TMP = os.path.join(tempfile.gettempdir(), "kts-props")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

def lin(hexcol):
    h = hexcol.lstrip("#")
    return tuple((c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in (int(h[k:k + 2], 16) / 255 for k in (0, 2, 4)))

BG_IN, BG_OUT = "#101a3a", "#0a0e1c"       # backdrop: lighter in the middle, darker at the corners
TINT = lin(OPT["--tint"])
# An empty lot has no owner: the game colours its kerb sand (EMPTY_ACCENT in ts3d/lotmodels.js), whatever --tint says.
TINT_OF = dict(lot0_empty="#ffe2a8")
CAB_YELLOW = "#ffc21a"                     # TAXI_BODY in ts3d/traffic.js: the taxi's `Paint` is exported neutral

# ====================================================================================================== pictures as arrays
def write_png(path, rgb):
    """rgb: (h, w, 3) uint8, top row first."""
    h, w = rgb.shape[:2]
    raw = b"".join(b"\x00" + rgb[r].tobytes() for r in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def write_jpg(path, rgb, max_bytes=JPG_MAX):
    """rgb: (h, w, 3) uint8, top row first. Saved as stored (no view transform), at the best quality that fits."""
    h, w = rgb.shape[:2]
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb[::-1].astype(np.float32) / 255.0
    img = bpy.data.images.new("icon_jpg", w, h, alpha=False)
    img.pixels.foreach_set(px.ravel())
    img.file_format = "JPEG"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    quality = 92
    while True:
        img.save(filepath=path, quality=quality)
        if os.path.getsize(path) <= max_bytes or quality <= 60:
            break
        quality -= 4
    bpy.data.images.remove(img)
    return quality, os.path.getsize(path)

def read_image(path):
    """(h, w, 4) float32, top row first, values as stored (linear for EXR, sRGB for PNG and JPG)."""
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].copy()

def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def shoulder(x, knee=0.62):
    """Straight up to the knee, then a soft roll-off to 1."""
    return np.where(x < knee, x, knee + (1 - knee) * (1 - np.exp(-(x - knee) / (1 - knee))))

def tone(x):
    """The roll-off applied to the brightest channel and the other two scaled with it, so neon keeps its hue
    instead of clipping to magenta or yellow; only very bright pixels get a little white in the core."""
    m = np.max(x, axis=-1, keepdims=True)
    y = x * (shoulder(m) / np.maximum(m, 1e-6))
    w = np.clip((m - 1.2) / 9.0, 0.0, 0.5)
    return y + (1 - y) * w

def box_blur(a, r, axis):
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)

def blur(a, sigma):
    r = max(1, int(round(sigma * 0.9)))
    for _ in range(3):
        a = box_blur(box_blur(a, r, 0), r, 1)
    return a

def backdrop(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((xx - w / 2) / (w * 0.62), (yy - h * 0.52) / (h * 0.62))
    t = np.clip(d, 0, 1)[..., None]
    t = t * t * (3 - 2 * t)
    return np.array(lin(BG_IN), np.float32) * (1 - t) + np.array(lin(BG_OUT), np.float32) * t

def finish_picture(exr, size):
    """Linear RGBA render (twice the final size) -> bloom, backdrop, tone curve, sRGB, averaged down to `size`."""
    px = read_image(exr)
    rgb, a = px[..., :3], np.clip(px[..., 3:4], 0, 1)
    h, w = rgb.shape[:2]
    hot = np.clip(rgb - 1.0, 0, 24)
    glow = 0.16 * blur(hot, w * 0.004) + 0.07 * blur(hot, w * 0.012) + 0.03 * blur(hot, w * 0.035)
    out = rgb + backdrop(h, w) * (1 - a) + glow
    out = to_srgb(tone(out))
    k = h // size
    out = out.reshape(size, k, size, k, 3).mean((1, 3))
    return np.clip(np.round(out * 255), 0, 255).astype(np.uint8)

FONT = {  # 5 x 7 dots
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001", "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10101 10001 10001 10001", "N": "10001 11001 10101 10011 10001 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110", "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 11011 10001", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "_": "00000 00000 00000 00000 00000 00000 11111", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100", ":": "00000 01100 01100 00000 01100 01100 00000",
    "/": "00001 00010 00010 00100 01000 01000 10000", " ": "00000 00000 00000 00000 00000 00000 00000",
}

def draw_text(img, text, x, y, scale=2, color=(215, 222, 240)):
    for ch in text.upper():
        rows = FONT.get(ch, FONT[" "]).split()
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit == "1":
                    img[y + r * scale:y + (r + 1) * scale, x + c * scale:x + (c + 1) * scale] = color
        x += 6 * scale
    return x

def text_width(text, scale=2):
    return len(text) * 6 * scale - scale

def resize(img, size):
    """(h, w, 3) uint8 -> size x size, by averaging when it divides evenly, else bilinear."""
    h, w = img.shape[:2]
    if h == size and w == size:
        return img
    if h % size == 0 and w % size == 0 and h // size == w // size:
        k = h // size
        return np.round(img.reshape(size, k, size, k, 3).astype(np.float32).mean((1, 3))).astype(np.uint8)
    ys = (np.arange(size) + 0.5) * h / size - 0.5
    xs = (np.arange(size) + 0.5) * w / size - 0.5
    y0, x0 = np.clip(np.floor(ys).astype(int), 0, h - 2), np.clip(np.floor(xs).astype(int), 0, w - 2)
    fy, fx = np.clip(ys - y0, 0, 1)[:, None, None], np.clip(xs - x0, 0, 1)[None, :, None]
    f = img.astype(np.float32)
    top = f[y0][:, x0] * (1 - fx) + f[y0][:, x0 + 1] * fx
    bot = f[y0 + 1][:, x0] * (1 - fx) + f[y0 + 1][:, x0 + 1] * fx
    return np.round(top * (1 - fy) + bot * fy).astype(np.uint8)

def read_rgb8(path):
    px = read_image(path)
    return np.clip(np.round(px[..., :3] * 255), 0, 255).astype(np.uint8)

# ====================================================================================================== the scene
def emission(name, color, strength, base=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*(base or color), 1)
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m

def plain(name, color, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m

def add_box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name, o.scale = name, size
    o.data.materials.append(mat)
    return o

def world_points(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        w = np.array(ev.matrix_world)
        out.append(co.reshape(-1, 3) @ w[:3, :3].T + w[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(out)

def screen_material():
    """A soft moving-light gradient in the game's pink, violet and cyan: stands for whatever the owner shows."""
    m = bpy.data.materials.new("StandInScreen")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.25)          # object space of a unit box: -0.5 .. 0.5
    mp.inputs["Rotation"].default_value = (0, math.radians(28), 0)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.35
    noise.inputs["Detail"].default_value = 0.6
    noise.inputs["Distortion"].default_value = 1.6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.30, (*lin("#241060"), 1)
    el[1].position, el[1].color = 0.72, (*lin("#3fd0ff"), 1)
    for pos, col in ((0.44, "#8a3cf0"), (0.56, "#ff3d9a")):
        e = el.new(pos)
        e.color = (*lin(col), 1)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.25
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

def screen_off_material():
    """The stand-in screen switched off, for the interface icons: dark navy, a little lighter toward the top. It gives
    off no light to speak of, so the building carries the picture and the panel reads as the place of a screen."""
    m = bpy.data.materials.new("StandInScreenOff")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    up = nt.nodes.new("ShaderNodeMath")                           # object space of a unit box: z -0.5 (foot) .. 0.5 (top)
    up.operation = "ADD"
    up.inputs[1].default_value = 0.5
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, (*lin(ICON_SCREEN[0]), 1)
    el[1].position, el[1].color = 1.0, (*lin(ICON_SCREEN[1]), 1)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], up.inputs[0])
    nt.links.new(up.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

def stand_ins(anchors, name="", tint=TINT):
    """The screen (with the game's frame) and the name sign, where the game mounts them. Returns light hints."""
    hints = []
    b = anchors.get("BoardAnchor")
    if b is not None:
        c = b.matrix_world.translation
        w, h = b.scale.x, b.scale.z
        if w / h > 16 / 9:
            w = h * 16 / 9
        else:
            h = w * 9 / 16
        dark = plain("BoardFrame", (0.012, 0.013, 0.018), 0.45)
        add_box("BoardFrameBox", (w + 0.32, 0.28, h + 0.32), (c.x, c.y + 0.08, c.z), dark)
        scr = add_box("BoardScreen", (w, 0.02, h), (c.x, c.y - 0.07, c.z), screen_material())
        hints.append((Vector((c.x, c.y - 0.5 - 0.12 * w, c.z)), lin("#b060ff"), w * h * 1.1))
    s = anchors.get("SignAnchor")
    if s is not None:
        c = s.matrix_world.translation
        if name in SIGN_AT:                                    # game axes (x, y up, z front) -> Blender (x, -z, y)
            gx, gy, gz = SIGN_AT[name]
            c = Vector((gx, -gz, gy))
        w, h = s.scale.x, s.scale.z
        glow = emission("StandInSign", tint, 3.2)
        add_box("SignBar", (w * 0.62, 0.02, h * 0.30), (c.x, c.y - 0.012, c.z), glow)
        t = max(0.025, h * 0.06)
        for sz in (-1, 1):
            add_box("SignEdge", (w * 0.94, 0.02, t), (c.x, c.y - 0.012, c.z + sz * (h * 0.40)), glow)
        for sx in (-1, 1):
            add_box("SignEdge", (t, 0.02, h * 0.80 + t), (c.x + sx * (w * 0.47), c.y - 0.012, c.z), glow)
        hints.append((Vector((c.x, c.y - 0.3, c.z)), tint, w * h * 1.5))
    return hints

def glow_lamps(meshes, centre, size, extra):
    """Eevee does not let a glowing surface light what is next to it. Put small coloured lamps beside the glowing
    parts instead: one per patch of glow (the faces are gathered on a coarse grid), a little off the surface."""
    cell = max(size / 7.0, 0.5)
    spill = min(max((size / 8.0) ** 1.3, 0.6), 3.0)        # a bigger model is seen from further away
    lamps = []
    for o in meshes:
        me = o.data
        mw = o.matrix_world
        rot = mw.to_3x3()
        for mi, slot in enumerate(o.material_slots):
            m = slot.material
            b = m.node_tree.nodes.get("Principled BSDF") if m and m.use_nodes else None
            if b is None:
                continue
            strength = b.inputs["Emission Strength"].default_value
            col = tuple(b.inputs["Emission Color"].default_value[:3])
            if strength < 1.5 or max(col) < 0.05:
                continue
            cells = {}
            for p in me.polygons:
                if p.material_index != mi:
                    continue
                c = mw @ p.center
                key = (int(math.floor(c.x / cell)), int(math.floor(c.y / cell)), int(math.floor(c.z / cell)))
                acc = cells.setdefault(key, [Vector((0, 0, 0)), Vector((0, 0, 0)), 0.0])
                acc[0] += c * p.area
                acc[1] += (rot @ p.normal) * p.area
                acc[2] += p.area
            for acc in cells.values():
                area = acc[2]
                if area < 0.004:
                    continue
                pos = acc[0] / area
                n = acc[1] / area
                if n.length < 0.35:
                    n = Vector((pos.x - centre.x, pos.y - centre.y, 0.25))
                n.normalize()
                lamps.append((min(0.8 + area * strength * 5.0, 14.0) * spill, col, pos + n * 0.25, 0.15))
    lamps.sort(key=lambda t: -t[0])
    lamps = lamps[:56] + [(power * spill, col, pos, 0.5) for pos, col, power in extra]
    for energy, col, pos, soft in lamps:
        L = bpy.data.lights.new("GlowScreen" if soft > 0.3 else "Glow", "POINT")
        L.color, L.energy, L.shadow_soft_size = col, energy, soft
        L.use_shadow = soft > 0.3                              # only the screen's lamp casts shadows
        L.specular_factor = 0.15
        lo = bpy.data.objects.new("Glow", L)
        bpy.context.scene.collection.objects.link(lo)
        lo.location = pos
    return len(lamps)

def area_light(name, loc, target, power, color, size, spread=None):
    L = bpy.data.lights.new(name, "AREA")
    L.energy, L.color, L.size = power, color, size
    if spread:
        L.spread = math.radians(spread)
    o = bpy.data.objects.new(name, L)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o

def fit_camera(cam, pts, az, pitch, margin=0.07, lens=85.0, lift=0.0):
    """Perspective camera looking at the points from `az` degrees right of the front and `pitch` degrees above,
    as close as keeps every point inside the square frame with `margin` to spare. When the points are wider than
    tall, `lift` (0..1) moves them up in the frame by that share of the room above them (1 = they touch the top)."""
    cam.data.lens, cam.data.sensor_fit, cam.data.sensor_width = lens, "HORIZONTAL", 36.0
    a, p = math.radians(az), math.radians(pitch)
    back = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))      # from the aim to the camera
    q = (-back).to_track_quat("-Z", "Y")
    right, up = q @ Vector((1, 0, 0)), q @ Vector((0, 1, 0))
    half = (18.0 / lens) * (1 - margin)
    aim = Vector(((pts[:, 0].min() + pts[:, 0].max()) / 2, (pts[:, 1].min() + pts[:, 1].max()) / 2, (pts[:, 2].min() + pts[:, 2].max()) / 2))
    R, U, B = np.array(right), np.array(up), np.array(back)
    dist = 10.0
    for _ in range(12):
        rel = pts - np.array(aim)
        x, y, depth = rel @ R, rel @ U, -(rel @ B)
        dist = float(np.max(np.maximum(np.abs(x), np.abs(y)) / half - depth))
        sx, sy = x / (dist + depth), y / (dist + depth)
        aim = aim + right * float((sx.min() + sx.max()) / 2 * dist) + up * float((sy.min() + sy.max()) / 2 * dist)
    if lift:
        rel = pts - np.array(aim)
        sy = (rel @ U) / (dist - (rel @ B))
        aim = aim - up * float(max(0.0, half - sy.max()) * lift * dist)
    cam.location = aim + back * dist
    cam.rotation_euler = q.to_euler()
    cam.data.clip_start, cam.data.clip_end = max(0.1, dist * 0.05), dist * 6
    return dist

def setup_engine(scene):
    r = scene.render
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.color_depth = "OPEN_EXR", "RGBA", "16"
    engine = None
    if os.environ.get("PROPS_CYCLES") != "1":
        try:
            r.engine = "BLENDER_EEVEE_NEXT"
            scene.eevee.taa_render_samples = 48
            for attr, val in (("use_raytracing", True), ("shadow_ray_count", 2), ("shadow_step_count", 6)):
                try:
                    setattr(scene.eevee, attr, val)
                except Exception as e:
                    print("eevee opt", attr, e)
            engine = "EEVEE"
        except Exception as e:
            print("Eevee not available:", e)
    if engine is None:
        r.engine = "CYCLES"
        scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising = "CPU", 48, True
        engine = "CYCLES"
    return engine

def render_asset(name):
    path = os.path.join(GLB_DIR, name + ".glb")
    if not os.path.exists(path):
        print("MISSING", path)
        return False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(scene.objects):
        if o.type == "MESH" and o.parent is None and len(o.data.polygons) <= 80 and o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)        # the importer's bone-shape icosphere
    meshes = [o for o in scene.objects if o.type == "MESH"]
    anchors = {o.name: o for o in scene.objects if o.type == "EMPTY" and o.name in ("BoardAnchor", "SignAnchor")}
    arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
    if arm is not None and arm.animation_data and bpy.data.actions:
        act = bpy.data.actions[0]
        arm.animation_data.action = act
        try:
            if arm.animation_data.action_slot is None and act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        scene.frame_set(int(round(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * float(OPT["--frame"]))))
    bpy.context.view_layer.update()
    tint = lin(TINT_OF[name]) if name in TINT_OF else TINT
    for m in bpy.data.materials:                               # what the game tints: the owner's colour, the cab's paint
        if not m.use_nodes:
            continue
        b = m.node_tree.nodes.get("Principled BSDF")
        if b is not None and m.name.split(".")[0] == "Accent":
            b.inputs["Base Color"].default_value = (*tint, 1)
            b.inputs["Emission Color"].default_value = (*tint, 1)
            b.inputs["Emission Strength"].default_value = 0.55
        if b is not None and m.name.split(".")[0] == "Paint":
            b.inputs["Base Color"].default_value = (*lin(CAB_YELLOW), 1)
    pts = world_points(meshes)
    lo, hi = pts.min(0), pts.max(0)
    centre = Vector((lo + hi) / 2)
    size = float(max(hi - lo))
    hints = [] if BARE else stand_ins(anchors, name, tint)
    if name not in LOTS:                                       # a plain round floor for the things that have no pad
        r = float(max(hi[0] - lo[0], hi[1] - lo[1])) * 0.54 + 0.2
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=r, depth=0.12, location=(centre.x, centre.y, lo[2] - 0.06))
        floor = bpy.context.object
        floor.data.materials.append(plain("Floor", lin("#232a3d"), 0.8))
        bev = floor.modifiers.new("Bevel", "BEVEL")
        bev.width, bev.segments = 0.04, 2
        for p in floor.data.polygons:
            p.use_smooth = True
    if DUMMY:
        grey = plain("Dummy", (0.55, 0.55, 0.58), 0.6)
        dx = hi[0] - 0.8 if name in LOTS else hi[0] + 0.55
        dy = lo[1] + 0.45 if name in LOTS else centre.y
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.2, depth=1.05, location=(dx, dy, lo[2] + 0.13 + 0.525))
        bpy.context.object.data.materials.append(grey)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.3, location=(dx, dy, lo[2] + 0.13 + 1.3))
        bpy.context.object.data.materials.append(grey)        # feet at the paving, top of the head at 1.6 m
    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.017, 0.042, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    # key from the front left and above, a cool fill from the camera's side, magenta and cyan rims from behind
    D = size * 1.9
    k = D * D
    tgt = (centre.x, centre.y, centre.z)
    area_light("Key", (centre.x - 0.95 * D, centre.y - 1.25 * D, centre.z + 1.25 * D), tgt, 26.0 * k, (1.0, 0.95, 0.88), size * 0.7)
    area_light("Fill", (centre.x + 1.5 * D, centre.y - 0.9 * D, centre.z + 0.35 * D), tgt, 8.0 * k, (0.55, 0.66, 1.0), size * 0.9)
    rim = 22.0 if name in LOTS else 5.0                         # glossy paint and thin garlands take less
    area_light("RimMagenta", (centre.x - 1.3 * D, centre.y + 1.1 * D, centre.z + 0.9 * D), tgt, rim * k, (1.0, 0.08, 0.62), size * 0.5, 80)
    area_light("RimCyan", (centre.x + 1.25 * D, centre.y + 1.2 * D, centre.z + 0.9 * D), tgt, rim * k, (0.05, 0.85, 1.0), size * 0.5, 80)
    area_light("Top", (centre.x, centre.y - 0.2 * D, centre.z + 1.8 * D), tgt, 7.0 * k, (0.62, 0.72, 1.0), size * 1.2)
    n_glow = 0 if "--no-spill" in FLAGS else glow_lamps(meshes, centre, size, hints)
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    engine = setup_engine(scene)
    frame = [o for o in scene.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    fpts = world_points(frame)
    exr = os.path.join(TMP, name + ".exr")
    scene.render.filepath = exr

    screen_obj = bpy.data.objects.get("BoardScreen")
    screen_lit = screen_obj.data.materials[0] if screen_obj else None
    screen_off = screen_off_material() if screen_obj else None
    screen_lamps = [(L, L.energy) for L in bpy.data.lights if L.name.startswith("GlowScreen")]

    def shot(az, pitch, size_px, margin, out_name, pts=None, screen=True, save=True, lift=0.0):
        if screen_obj:                                         # the interface icons show the stand-in screen switched off
            screen_obj.data.materials[0] = screen_lit if screen else screen_off
            for L, e in screen_lamps:
                L.energy = e if screen else 0.0
        fit_camera(cam, fpts if pts is None else pts, az, pitch, margin, lift=lift)
        scene.render.resolution_x = scene.render.resolution_y = size_px * 2
        bpy.ops.render.render(write_still=True)
        img = finish_picture(exr, size_px)
        if save:
            out = os.path.join(OUT, out_name)
            write_png(out, img)
            print("PICTURE", out)
        return img

    az, pitch = float(OPT["--az"]), float(OPT["--pitch"])
    if DUMMY:
        shot(az, pitch, 768, 0.06, name + "_dummy.png")
    elif FRAMES > 0 and arm is not None and bpy.data.actions:   # the whole clip on one sheet, same camera for every frame
        a0, a1 = bpy.data.actions[0].frame_range
        frames = [int(round(a0 + (a1 - a0) * k / FRAMES)) for k in range(FRAMES)]
        every = []
        for f in frames:
            scene.frame_set(f)
            bpy.context.view_layer.update()
            every.append(world_points(frame))
        every = np.concatenate(every)
        tile, label, cols = 384, 34, 4
        rows = (FRAMES + cols - 1) // cols
        sheet = canvas(rows * (tile + label), cols * tile)
        for k, f in enumerate(frames):
            scene.frame_set(f)
            bpy.context.view_layer.update()
            r, c = divmod(k, cols)
            sheet[r * (tile + label):r * (tile + label) + tile, c * tile:(c + 1) * tile] = shot(az, pitch, tile, 0.05, "", pts=every, save=False)
            t = "FRAME %d  %.2f S" % (f, (f - a0) / scene.render.fps)
            draw_text(sheet, t, c * tile + (tile - text_width(t)) // 2, r * (tile + label) + tile + 9, color=(150, 160, 190))
        out = os.path.join(OUT, name + "_frames.png")
        write_png(out, sheet)
        print("PICTURE", out)
    elif FRAME_GIVEN:                                           # a look at one moment of a clip, not a final picture
        shot(az, pitch, 384, 0.06, name + "_f%03d.png" % round(float(OPT["--frame"]) * 100))
    else:
        if "--icons-only" not in FLAGS:
            shot(az, pitch, 768, 0.06, name + ".png")
        if name in LOTS:
            # two icons: the whole lot as the game shows it, and the one for the interface, framed on the building
            # from closer and lower, the stand-in screen switched off so the building carries the picture
            shot(35.0, 26.0, 256, 0.05, name + "_icon_full.png")
            x0, x1, y0, y1, z0, z1 = FOCUS[name]
            box = np.array([(x, -z, y) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)])
            icon = shot(32.0, ICON_PITCH[name], 256, 0.03, name + "_icon.png", pts=box, screen=False, lift=0.5)
            if JPG_DIR:
                jpg = os.path.join(JPG_DIR, OLD_ICON[name])
                q, size = write_jpg(jpg, icon)
                print("ICON", jpg, "quality", q, size, "bytes")
    print("RENDERED", name, engine, "glow lamps", n_glow)
    return True

# ====================================================================================================== sheets
def canvas(h, w):
    """A sheet filled with the backdrop's corner colour."""
    img = np.empty((h, w, 3), np.uint8)
    img[:] = np.round(to_srgb(np.array(lin(BG_OUT), np.float32)) * 255).astype(np.uint8)
    return img

def make_sheet():
    have = [n for n in ALL if os.path.exists(os.path.join(OUT, n + ".png"))]
    if not have:
        return
    tile, label, cols = 384, 40, 4
    rows = (len(have) + cols - 1) // cols
    img = canvas(rows * (tile + label), cols * tile)
    for k, n in enumerate(have):
        r, c = divmod(k, cols)
        y, x = r * (tile + label), c * tile
        img[y:y + tile, x:x + tile] = resize(read_rgb8(os.path.join(OUT, n + ".png")), tile)
        draw_text(img, n, x + (tile - text_width(n)) // 2, y + tile + 12)
    write_png(os.path.join(OUT, "sheet.png"), img)
    print("SHEET", os.path.join(OUT, "sheet.png"))

def make_compare():
    have = [n for n in LOTS if os.path.exists(os.path.join(OUT, n + "_icon.png"))]
    if not have:
        return
    tile, label, head = 384, 36, 40
    img = canvas(head + 2 * (tile + label), len(have) * tile)
    for c, n in enumerate(have):
        x = c * tile
        draw_text(img, n, x + (tile - text_width(n)) // 2, 13)
        old = os.path.join(ROOT, "icons", OLD_ICON[n])
        if os.path.exists(old):
            img[head:head + tile, x:x + tile] = resize(read_rgb8(old), tile)
        t = "CURRENT: ICONS/" + OLD_ICON[n]
        draw_text(img, t, x + (tile - text_width(t)) // 2, head + tile + 10, color=(150, 160, 190))
        y = head + tile + label
        img[y:y + tile, x:x + tile] = resize(read_rgb8(os.path.join(OUT, n + "_icon.png")), tile)
        t = "NEW: RENDER OF THE MODEL"
        draw_text(img, t, x + (tile - text_width(t)) // 2, y + tile + 10, color=(150, 160, 190))
    write_png(os.path.join(OUT, "compare_buildings.png"), img)
    print("COMPARE", os.path.join(OUT, "compare_buildings.png"))

if __name__ == "__main__":
    todo = list(ALL) if not names or names == ["all"] else names
    if "--sheets-only" not in FLAGS:
        for n in todo:
            render_asset(n)
    if "--no-sheets" not in FLAGS and not DUMMY and not FRAME_GIVEN and FRAMES == 0:
        make_sheet()
        make_compare()
