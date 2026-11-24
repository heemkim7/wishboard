# Builds the modelled props of the game as GLB files:
#   lot0_empty  lot1_tent  lot2_pocha  lot3_shop  lot4_tower   - the five building levels of a plot, each on the lot pad
#   taxi        xmas_tree  air_dancer                           - the cab, the plaza tree, the rigged inflatable figure
# Models only: nothing here is wired into the game yet.
#
# Needs: Blender 4.5 LTS (its glTF exporter and the Weighted Normal modifier). Nothing else, no downloads, no textures.
# Run from anywhere:
#   "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" --background --factory-startup
#       --python tools/blender/build_props.py -- all                 (or names: lot2_pocha taxi ...)
#   optional: --out <folder>   (default <repository>/out/blender/glb, which git ignores)
# Check:    node tools/blender/inspect_glb.mjs out/blender/glb/lot3_shop.glb --nodes [--anims]
# Look:     blender --background --factory-startup --python tools/blender/render_props.py -- all
#
# Conventions (the file is written in the game's own axes, so the numbers can be compared with ts3d/landmarks.js
# buildPlot and ts3d/traffic.js vehicleKits directly):
#   - metres, x to the right, y up, z to the front. The GLB has the same axes (glTF is y-up).
#   - a building stands on the lot pad (8.4 wide, 7.6 deep), origin at the pad centre on the ground, front toward +z.
#   - every building has two empty nodes, BoardAnchor and SignAnchor: at the centre of the screen and of the name
#     sign that buildPlot mounts for that level, scaled (width, height, 1), looking toward +z. The model keeps a dark
#     flat plate behind each (0.24 m behind the screen plane: the game's own board frame is 0.22 deep; 0.03 m behind
#     the sign plane) and nothing in front of it.
#   - the taxi drives toward +z like the kit in vehicleKits (headlights at +z); its left wheels are at +x. Wheel
#     nodes sit on the axles at (+-0.86, 0.40, +-1.45), radius 0.40 (the kit: +-0.86, 0.34, +-1.45, radius 0.34).
#   - materials are flat colours, single-sided. `Accent` is what the game tints with the owner's colour: it is
#     exported neutral light grey with a mild glow of the same grey (emissive 0.45 of the colour), so set both color
#     and emissive to the theme colour. The taxi's `Paint` is exported near-white for the same reason.
#     Neon materials (NeonPink, NeonCyan, NeonGold, Glass, Lantern, Lights, ...) carry an emissive strength above 1
#     (KHR_materials_emissive_strength, which three.js reads as emissiveIntensity).
#   - shading: hard edges have a small chamfer and the normals are weighted by face area, so the big faces stay
#     flat and the chamfers catch the light. Parts too small to show a chamfer are plain boxes shaded round
#     (`soft`): 8 vertices instead of 24 in the file. No texture coordinates are written.
#   - budgets are printed after every build (triangles, KB, materials); a line ending in OVER BUDGET needs trimming.
import bpy, bmesh, os, sys, math, random, time
from contextlib import contextmanager
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ROOT = REPO.split(os.sep + ".claude" + os.sep + "worktrees" + os.sep)[0]     # an agent worktree writes into the main checkout
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.join(ROOT, "out", "blender", "glb")
names, i = [], 0
while i < len(argv):
    if argv[i] == "--out":
        OUT_DIR = os.path.abspath(argv[i + 1]); i += 2
        continue
    names.append(argv[i].lower()); i += 1
T0 = time.time()

def log(*a):
    print("[props %6.1fs]" % (time.time() - T0), *a)
    sys.stdout.flush()

# ====================================================================================================== maths
PI = math.pi
rad = math.radians

def lin(hexcol):
    """#rrggbb (sRGB) -> linear RGB tuple."""
    h = hexcol.lstrip("#")
    return tuple((c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in (int(h[k:k + 2], 16) / 255 for k in (0, 2, 4)))

def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))

def R(rx=0.0, ry=0.0, rz=0.0):
    """Degrees. Turn about z first, then x, then y (y is up)."""
    return Matrix.Rotation(rad(ry), 4, "Y") @ Matrix.Rotation(rad(rx), 4, "X") @ Matrix.Rotation(rad(rz), 4, "Z")

def S(sx=1.0, sy=1.0, sz=1.0):
    return Matrix.Diagonal((sx, sy, sz, 1.0))

def frange(a, b, n):
    return [a + (b - a) * k / (n - 1) for k in range(n)] if n > 1 else [a]

# ====================================================================================================== raw shapes
def recalc(verts, faces):
    """Faces of closed shells turned outwards (the order of the faces is kept)."""
    bm = bmesh.new()
    bv = [bm.verts.new(p) for p in verts]
    for f in faces:
        bm.faces.new([bv[k] for k in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()
    out = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    return out

def orient_from(verts, faces, c):
    """Turn every face of a convex shape away from the point c."""
    c = Vector(c)
    out = []
    for f in faces:
        p = [Vector(verts[k]) for k in f]
        n = Vector((0, 0, 0))
        for a in range(len(p)):
            n += p[a].cross(p[(a + 1) % len(p)])
        mid = sum(p, Vector((0, 0, 0))) / len(p)
        out.append(tuple(f) if n.dot(mid - c) >= 0 else tuple(reversed(f)))
    return out

def g_box(a, b, c, t):
    """Box of half sizes a, b, c with a one-step chamfer t on every edge: 24 vertices, 44 triangles."""
    if t <= 1e-5:
        v = [(sx * a, sy * b, sz * c) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        q = lambda i, j, k: i * 4 + j * 2 + k
        f = [(q(0, 0, 0), q(0, 0, 1), q(0, 1, 1), q(0, 1, 0)), (q(1, 0, 0), q(1, 1, 0), q(1, 1, 1), q(1, 0, 1)),
             (q(0, 0, 0), q(1, 0, 0), q(1, 0, 1), q(0, 0, 1)), (q(0, 1, 0), q(0, 1, 1), q(1, 1, 1), q(1, 1, 0)),
             (q(0, 0, 0), q(0, 1, 0), q(1, 1, 0), q(1, 0, 0)), (q(0, 0, 1), q(1, 0, 1), q(1, 1, 1), q(0, 1, 1))]
        return v, orient_from(v, f, (0, 0, 0))
    v = []
    vid = lambda i, j, k, face: ((i * 2 + j) * 2 + k) * 3 + face
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                sx, sy, sz = 2 * i - 1, 2 * j - 1, 2 * k - 1
                v.append((sx * a, sy * (b - t), sz * (c - t)))
                v.append((sx * (a - t), sy * b, sz * (c - t)))
                v.append((sx * (a - t), sy * (b - t), sz * c))
    ring = ((0, 0), (1, 0), (1, 1), (0, 1))
    f = []
    for i in (0, 1):
        f.append(tuple(vid(i, j, k, 0) for j, k in ring))
    for j in (0, 1):
        f.append(tuple(vid(i, j, k, 1) for i, k in ring))
    for k in (0, 1):
        f.append(tuple(vid(i, j, k, 2) for i, j in ring))
    for i in (0, 1):
        for j in (0, 1):
            f.append((vid(i, j, 0, 0), vid(i, j, 1, 0), vid(i, j, 1, 1), vid(i, j, 0, 1)))
    for j in (0, 1):
        for k in (0, 1):
            f.append((vid(0, j, k, 1), vid(1, j, k, 1), vid(1, j, k, 2), vid(0, j, k, 2)))
    for i in (0, 1):
        for k in (0, 1):
            f.append((vid(i, 0, k, 0), vid(i, 1, k, 0), vid(i, 1, k, 2), vid(i, 0, k, 2)))
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                f.append((vid(i, j, k, 0), vid(i, j, k, 1), vid(i, j, k, 2)))
    return v, orient_from(v, f, (0, 0, 0))

def g_lathe(profile, seg, phase=0.0, radial=None):
    """Profile [(r, y)] turned about the y axis. r = 0 is a pole. radial(angle, r, y) -> r lets the rim wobble.
    Returns verts, faces and for every face the index of the profile segment it came from."""
    verts, rings = [], []
    for r, y in profile:
        if abs(r) < 1e-6:
            rings.append([len(verts)]); verts.append((0.0, y, 0.0))
        else:
            ring = []
            for k in range(seg):
                a = 2 * PI * (k + phase) / seg
                rr = radial(a, r, y) if radial else r
                ring.append(len(verts)); verts.append((rr * math.cos(a), y, rr * math.sin(a)))
            rings.append(ring)
    faces, band = [], []
    for bi, (A, B) in enumerate(zip(rings, rings[1:])):
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(A) == 1:
                faces.append((A[0], B[k], B[k2]))
            elif len(B) == 1:
                faces.append((A[k], B[0], A[k2]))
            else:
                faces.append((A[k], B[k], B[k2], A[k2]))
            band.append(bi)
    return verts, faces, band, rings

def g_tube(pts, r, seg=4, closed=False, phase=0.5):
    """A tube of radius r (number or function of 0..1 along the path) swept along the polyline pts. Corners are mitred."""
    P = [Vector(p) for p in pts]
    n = len(P)
    d = lambda a, b: (P[b] - P[a]).normalized()
    t0 = d(0, 1)
    up = Vector((0, 1, 0)) if abs(t0.y) < 0.9 else Vector((1, 0, 0))
    nrm = (up - t0 * up.dot(t0)).normalized()
    verts, rings = [], []
    for i in range(n):
        if closed:
            din, dout = d((i - 1) % n, i), d(i, (i + 1) % n)
        else:
            din = d(i - 1, i) if i > 0 else d(0, 1)
            dout = d(i, i + 1) if i < n - 1 else d(n - 2, n - 1)
        t = din + dout
        if t.length < 1e-6:
            t = dout.copy()
        t.normalize()
        nrm = nrm - t * nrm.dot(t)
        nrm.normalize()
        bn = t.cross(nrm)
        m = dout - din
        stretch = 0.0
        if m.length > 1e-6:
            m.normalize()
            stretch = 1.0 / max(t.dot(dout), 0.35) - 1.0
        rr = r(i / (n - 1)) if callable(r) else r
        ring = []
        for k in range(seg):
            a = 2 * PI * (k + phase) / seg
            o = rr * (math.cos(a) * nrm + math.sin(a) * bn)
            if stretch:
                o = o + m * o.dot(m) * stretch
            ring.append(len(verts)); verts.append(tuple(P[i] + o))
        rings.append(ring)
    faces = []
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            faces.append((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
    if not closed:
        faces.append(tuple(reversed(rings[0])))
        faces.append(tuple(rings[-1]))
    return verts, faces

def poly_area(p):
    return 0.5 * sum(p[k][0] * p[(k + 1) % len(p)][1] - p[(k + 1) % len(p)][0] * p[k][1] for k in range(len(p)))

def offset_poly(p, dist):
    """Counter-clockwise polygon moved inwards by dist (mitred)."""
    n, out = len(p), []
    for k in range(n):
        a, b, c = Vector(p[k - 1]), Vector(p[k]), Vector(p[(k + 1) % n])
        e1, e2 = (b - a).normalized(), (c - b).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))
        m = n1 + n2
        if m.length < 1e-6:
            m = n1.copy()
        m.normalize()
        s = dist / max(m.dot(n1), 0.3)
        out.append((b.x + m.x * s, b.y + m.y * s))
    return out

def g_prism(poly, depth, bevel=0.0):
    """Polygon [(x, y)] pushed along z, centred on z = 0. bevel chamfers the two caps."""
    poly = list(poly)
    if poly_area(poly) < 0:
        poly.reverse()
    h = depth / 2
    if bevel > 1e-5:
        inner = offset_poly(poly, bevel)
        rows = [(inner, -h), (poly, -h + bevel), (poly, h - bevel), (inner, h)]
    else:
        rows = [(poly, -h), (poly, h)]
    n = len(poly)
    verts = [(x, y, z) for pts, z in rows for x, y in pts]
    faces = []
    for ri in range(len(rows) - 1):
        a, b = ri * n, (ri + 1) * n
        for k in range(n):
            faces.append((a + k, a + (k + 1) % n, b + (k + 1) % n, b + k))
    faces.append(tuple(reversed(range(n))))
    faces.append(tuple(range((len(rows) - 1) * n, len(rows) * n)))
    return verts, faces

def g_loft(sections, closed=True, cap0=True, cap1=True):
    """Rings of points (all the same count) joined into a skin."""
    n = len(sections[0])
    verts = [tuple(p) for s in sections for p in s]
    faces, at = [], []
    for si in range(len(sections) - 1):
        a, b = si * n, (si + 1) * n
        for k in range(n if closed else n - 1):
            faces.append((a + k, a + (k + 1) % n, b + (k + 1) % n, b + k))
            at.append((si, k))
    if cap0:
        faces.append(tuple(reversed(range(n)))); at.append((-1, 0))
    if cap1:
        faces.append(tuple(range((len(sections) - 1) * n, len(sections) * n))); at.append((len(sections), 0))
    return verts, faces, at

def g_sheet(grid, thick):
    """A grid of points given thickness (downwards along its own normals): cloth that is not paper-thin."""
    nu, nv = len(grid), len(grid[0])
    P = [[Vector(p) for p in row] for row in grid]
    top, bot = [], []
    for a in range(nu):
        for b in range(nv):
            du = P[min(a + 1, nu - 1)][b] - P[max(a - 1, 0)][b]
            dv = P[a][min(b + 1, nv - 1)] - P[a][max(b - 1, 0)]
            nrm = du.cross(dv)
            if nrm.length < 1e-9:
                nrm = Vector((0, 1, 0))
            nrm.normalize()
            if nrm.y < 0:
                nrm = -nrm
            top.append(tuple(P[a][b])); bot.append(tuple(P[a][b] - nrm * thick))
    verts = top + bot
    q = lambda a, b, layer=0: layer * nu * nv + a * nv + b
    faces, cell = [], []
    for a in range(nu - 1):
        for b in range(nv - 1):
            faces.append((q(a, b), q(a, b + 1), q(a + 1, b + 1), q(a + 1, b))); cell.append((a, b))
            faces.append((q(a, b, 1), q(a + 1, b, 1), q(a + 1, b + 1, 1), q(a, b + 1, 1))); cell.append((a, b))
    for a in range(nu - 1):
        faces.append((q(a, 0), q(a + 1, 0), q(a + 1, 0, 1), q(a, 0, 1))); cell.append((a, 0))
        faces.append((q(a, nv - 1), q(a, nv - 1, 1), q(a + 1, nv - 1, 1), q(a + 1, nv - 1))); cell.append((a, nv - 2))
    for b in range(nv - 1):
        faces.append((q(0, b), q(0, b, 1), q(0, b + 1, 1), q(0, b + 1))); cell.append((0, b))
        faces.append((q(nu - 1, b), q(nu - 1, b + 1), q(nu - 1, b + 1, 1), q(nu - 1, b, 1))); cell.append((nu - 2, b))
    return verts, faces, cell

# ====================================================================================================== one mesh node
class Geo:
    """Collects the faces of one mesh node. Points are in the game's axes, relative to `origin`.
    Three ways a part can be shaded:
      default  smooth, with hard edges where the fold is steeper than SHARP_DEG (a chamfered box: 24 vertices)
      soft     smooth all over, no hard edges: for parts too small to show a chamfer (a plain box is 8 vertices
               instead of 24 in the GLB, which is what keeps the files small)
      flat     every face on its own (the gem)."""
    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name, self.origin = name, Vector(origin)
        self.v, self.f, self.fm, self.flat, self.soft = [], [], [], [], []
        self.stack = [Matrix.Identity(4)]

    @contextmanager
    def at(self, x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0, sx=1.0, sy=1.0, sz=1.0):
        self.stack.append(self.stack[-1] @ T(x, y, z) @ R(rx, ry, rz) @ S(sx, sy, sz))
        try:
            yield self
        finally:
            self.stack.pop()

    def emit(self, verts, faces, mat, M=None, fix="recalc", flat=False, soft=False):
        """mat: one name, or one name per face. fix: 'recalc' for closed shells, None when the winding is already right."""
        if fix == "recalc":
            faces = recalc(verts, faces)
        W = self.stack[-1] @ M if M is not None else self.stack[-1]
        flip = W.determinant() < 0
        base = len(self.v)
        self.v.extend(W @ Vector(p) for p in verts)
        for k, f in enumerate(faces):
            self.f.append(tuple(base + q for q in (reversed(f) if flip else f)))
            self.fm.append(mat if isinstance(mat, str) else mat[k])
            self.flat.append(flat)
            self.soft.append(soft)

    # ---- shapes
    def box(self, mat, sx, sy, sz, x=0.0, y=0.0, z=0.0, b=None, rx=0.0, ry=0.0, rz=0.0, base=False, soft=False):
        """Chamfered box, sizes along x, y, z, centred on (x, y, z); base=True puts its underside at y.
        soft=True: a plain box shaded round (for small parts)."""
        if base:
            y += sy / 2
        if b is None:
            b = max(0.012, min(0.05, 0.14 * min(sx, sy, sz)))
        b = 0.0 if soft else min(b, 0.45 * min(sx, sy, sz))
        v, f = g_box(sx / 2, sy / 2, sz / 2, b)
        self.emit(v, f, mat, T(x, y, z) @ R(rx, ry, rz), fix=None, soft=soft)

    def beam(self, mat, p0, p1, w, d=None, b=None, soft=False):
        """A chamfered bar from p0 to p1 with cross-section w x d (a brace, a strut, a rail)."""
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        L = axis.length
        d = w if d is None else d
        if b is None:
            b = max(0.01, min(0.04, 0.16 * min(w, d)))
        v, f = g_box(w / 2, L / 2, d / 2, 0.0 if soft else min(b, 0.45 * min(w, d, L)))
        q = Vector((0, 1, 0)).rotation_difference(axis.normalized())
        self.emit(v, f, mat, T(*((p0 + p1) / 2)) @ q.to_matrix().to_4x4(), fix=None, soft=soft)

    def lathe(self, mat, profile, x=0.0, y=0.0, z=0.0, seg=12, rx=0.0, ry=0.0, rz=0.0, cap0=False, cap1=False,
              flat=False, soft=False, radial=None, phase=0.0, scale=(1.0, 1.0, 1.0)):
        """mat: one name, or one per profile segment (a cone with a white band, a lantern with dark caps)."""
        v, f, band, rings = g_lathe(profile, seg, phase, radial)
        fm = [mat if isinstance(mat, str) else mat[bi] for bi in band]
        if cap0 and len(rings[0]) > 1:
            f.append(tuple(rings[0])); fm.append(mat if isinstance(mat, str) else mat[0])
        if cap1 and len(rings[-1]) > 1:
            f.append(tuple(rings[-1])); fm.append(mat if isinstance(mat, str) else mat[-1])
        self.emit(v, f, fm, T(x, y, z) @ R(rx, ry, rz) @ S(*scale), flat=flat, soft=soft)

    def cyl(self, mat, r, h, x=0.0, y=0.0, z=0.0, seg=12, b=0.02, r2=None, axis="y", base=True, **kw):
        """Cylinder or cone frustum (r at the bottom, r2 at the top) with chamfered rims. axis: y (up), x or z.
        b=0 with soft=True is the cheapest: two fans and the wall, shaded round."""
        r2 = r if r2 is None else r2
        b0, b1 = min(b, r * 0.5, h * 0.3), min(b, r2 * 0.5, h * 0.3)
        y0 = 0.0 if base else -h / 2
        prof = [(0.0, y0), (r - b0, y0), (r, y0 + b0), (r2, y0 + h - b1), (r2 - b1, y0 + h), (0.0, y0 + h)]
        prof = [p for k, p in enumerate(prof) if k == 0 or abs(p[0] - prof[k - 1][0]) + abs(p[1] - prof[k - 1][1]) > 1e-6]
        rot = dict(y={}, x=dict(rz=-90.0), z=dict(rx=90.0))[axis]
        self.lathe(mat, prof, x, y, z, seg=seg, **rot, **kw)

    def ball(self, mat, r, x=0.0, y=0.0, z=0.0, seg=6, rings=3, scale=(1.0, 1.0, 1.0), **kw):
        prof = [(r * math.sin(PI * k / rings), -r * math.cos(PI * k / rings)) for k in range(rings + 1)]
        prof[0], prof[-1] = (0.0, -r), (0.0, r)
        kw.setdefault("soft", True)             # a ball has no hard edges, however few sides it has
        self.lathe(mat, prof, x, y, z, seg=seg, scale=scale, **kw)

    def tube(self, mat, pts, r, seg=4, closed=False):
        v, f = g_tube(pts, r, seg, closed)
        self.emit(v, f, mat)

    def ring(self, mat, r, tube_r, x=0.0, y=0.0, z=0.0, n=14, seg=4, axis="y"):
        """A hoop of radius r (a neon circle, a halo) about the given axis."""
        pts = []
        for k in range(n):
            c, s = r * math.cos(2 * PI * k / n), r * math.sin(2 * PI * k / n)
            pts.append(dict(y=(x + c, y, z + s), z=(x + c, y + s, z), x=(x, y + c, z + s))[axis])
        self.tube(mat, pts, tube_r, seg=seg, closed=True)

    def prism(self, mat, poly, depth, x=0.0, y=0.0, z=0.0, b=0.0, rx=0.0, ry=0.0, rz=0.0, soft=False):
        """Outline [(x, y)] pushed along local z (centred), then turned and moved."""
        v, f = g_prism(poly, depth, b)
        self.emit(v, f, mat, T(x, y, z) @ R(rx, ry, rz), soft=soft)

    def loft(self, mat, sections, closed=True, cap0=True, cap1=True, pick=None, flat=False):
        """pick(section index, point index) -> material name, for skins with more than one colour."""
        v, f, at = g_loft(sections, closed, cap0, cap1)
        fm = mat if pick is None else [pick(si, k) or mat for si, k in at]
        self.emit(v, f, fm, flat=flat)

    def sheet(self, mat, grid, thick=0.05, pick=None):
        """Cloth with thickness. pick(row, column) -> material name for that cell (top and underside)."""
        v, f, cell = g_sheet(grid, thick)
        fm = mat if pick is None else [(pick(*c) or mat) if c else mat for c in cell]
        self.emit(v, f, fm)

    def plate(self, mat, w, h, x=0.0, y=0.0, z=0.0, ry=0.0):
        """One flat rectangle looking toward +z before the turn ry (90 looks toward +x). For window panes on a wall."""
        v = [(-w / 2, -h / 2, 0.0), (w / 2, -h / 2, 0.0), (w / 2, h / 2, 0.0), (-w / 2, h / 2, 0.0)]
        self.emit(v, [(0, 1, 2, 3)], mat, T(x, y, z) @ R(0.0, ry, 0.0), fix=None)

    def lid(self, mat, x0, x1, z0, z1, y0, y1, c):
        """A paving slab: the top and four sloped sides only (the underside sits on something)."""
        v = [(x0, y0, z0), (x0, y0, z1), (x1, y0, z1), (x1, y0, z0),
             (x0 + c, y1, z0 + c), (x0 + c, y1, z1 - c), (x1 - c, y1, z1 - c), (x1 - c, y1, z0 + c)]
        f = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.emit(v, orient_from(v, f, ((x0 + x1) / 2, y0 - 1.0, (z0 + z1) / 2)), mat, fix=None)

    def pane(self, mat, w, h, x=0.0, y=0.0, z=0.0, ry=0.0, proud=0.03, c=0.03):
        """A window pane standing `proud` of a wall that looks toward ry: the face and four sloped edges, no back."""
        with self.at(x, y, z, ry=ry, rx=90.0):
            self.lid(mat, -w / 2, w / 2, -h / 2, h / 2, 0.0, proud, c)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

# ====================================================================================================== materials
# name: (base colour, roughness, metallic, glow colour or None, glow strength)
PALETTE = {
    "Body":     ("#262d42", 0.72, 0.0, None, 0.0),        # dark navy walls, the pad's slab, dark steel
    "Stone":    ("#474e63", 0.88, 0.0, None, 0.0),        # paving, plinths, footings
    "Trim":     ("#7c88ab", 0.62, 0.0, None, 0.0),        # cornices, piers, window frames
    "Metal":    ("#aeb7c6", 0.36, 0.65, None, 0.0),       # stainless steel, truss, poles
    "Wood":     ("#a8703f", 0.74, 0.0, None, 0.0),
    "WoodDark": ("#6a4126", 0.78, 0.0, None, 0.0),
    "Cloth":    ("#f1e7d2", 0.90, 0.0, None, 0.0),        # canvas, steam, cream details
    "Accent":   ("#dcdcdc", 0.55, 0.0, "#dcdcdc", 0.45),  # the owner's colour: tinted by the game
    "Glass":    ("#ffd9a0", 0.30, 0.0, "#ffc978", 1.5),   # lit windows, warm lamps
    "GlassDark": ("#15223e", 0.12, 0.5, "#1c3f73", 0.35),  # unlit windows
    "NeonPink": ("#ff3d9a", 0.40, 0.0, "#ff3d9a", 3.0),
    "NeonCyan": ("#3fe6ff", 0.40, 0.0, "#3fe6ff", 2.6),
    "NeonGold": ("#ffcf5a", 0.40, 0.0, "#ffcf5a", 2.6),
    "Lantern":  ("#ff3b26", 0.50, 0.0, "#ff3b26", 1.8),   # the red paper lantern, red sauce, beacons
    "Cone":     ("#ff6a1a", 0.50, 0.0, "#ff6a1a", 0.25),  # traffic-cone orange
    "Gem":      ("#ffcf5a", 0.18, 0.3, "#ffb52e", 1.3),   # the gem over an empty lot: facets, not a flat glow
}
MATS = {}
LOCAL = {}            # an asset's own materials (the taxi, the tree, the air dancer): they win over PALETTE

def material(name):
    if name in MATS:
        return MATS[name]
    base, rough, metal, glow, strength = LOCAL.get(name) or PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True          # every part is a closed shell: single-sided in the GLB
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(base), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:
        b.inputs["Emission Color"].default_value = (*lin(glow), 1)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m

# ====================================================================================================== scene
SHARP_DEG = 50.0      # folds steeper than this are hard edges; a 45 degree chamfer stays smooth

def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    MATS.clear()

def to_blender(p):
    return (p[0], -p[2], p[1])        # game (x, y up, z front) -> Blender (x, y back, z up); the exporter turns it back

def finish(g, weighted=True):
    """Geo -> mesh object: materials, hard edges by angle (none on soft parts), normals weighted by face area."""
    me = bpy.data.meshes.new(g.name)
    me.from_pydata([to_blender(p) for p in g.v], [], g.f)
    order = []
    for n in g.fm:
        if n not in order:
            order.append(n)
    for n in order:
        me.materials.append(material(n))
    me.polygons.foreach_set("material_index", [order.index(n) for n in g.fm])
    me.polygons.foreach_set("use_smooth", [not fl for fl in g.flat])
    me.update()
    if me.validate():
        log("  note: validate() changed", g.name)
    assert len(me.polygons) == len(g.f), "validate() dropped faces of " + g.name
    me.set_sharp_from_angle(angle=rad(SHARP_DEG))
    sharp = me.attributes.get("sharp_edge")
    if sharp is not None and any(g.soft):
        keys = set()
        for p, s in zip(me.polygons, g.soft):
            if s:
                keys.update(p.edge_keys)
        for e in me.edges:
            if e.key in keys:
                sharp.data[e.index].value = False
    ob = bpy.data.objects.new(g.name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = to_blender(g.origin)
    if weighted:
        mod = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        mod.mode, mod.weight, mod.keep_sharp, mod.thresh = "FACE_AREA", 50, True, 0.01
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob

def anchor(name, spec):
    """An empty at the centre of a w x h rectangle, scaled (w, h, 1) in the GLB, looking toward +z."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type, e.empty_display_size = "PLAIN_AXES", 0.5
    bpy.context.scene.collection.objects.link(e)
    e.location = to_blender((spec["x"], spec["y"], spec["z"]))
    e.scale = (spec["w"], 1.0, spec["h"])
    return e

def export(name, objects, skin=False, anim=False):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.context.view_layer.update()            # without this the empties made a moment ago are not in the view layer yet
    for o in bpy.context.scene.objects:
        o.select_set(o in objects)
    bpy.context.view_layer.objects.active = objects[0]
    assert all(o.select_get() for o in objects), "not every node was selected for export"
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True,
        export_apply=False, export_texcoords=False, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
        export_skins=skin, export_all_influences=False, export_def_bones=False, export_morph=False,
        export_animations=anim, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_range=False, export_anim_single_armature=True, export_reset_pose_bones=True,
        export_optimize_animation_size=True,       # drops the channels that never change; the turning bones keep every frame
    )
    return path

def report(name, geos, path, budget_tris, budget_kb):
    tris = sum(g.tris() for g in geos)
    mats = sorted({m for g in geos for m in g.fm})
    kb = os.path.getsize(path) / 1024
    flag = "" if tris <= budget_tris and kb <= budget_kb and len(mats) <= 8 else "   <-- OVER BUDGET"
    log("%-11s %5d tris (<= %d)  %6.1f KB (<= %d)  %d mesh nodes  %d materials: %s%s"
        % (name, tris, budget_tris, kb, budget_kb, len(geos), len(mats), " ".join(mats), flag))

# ====================================================================================================== shared parts
PAD_W, PAD_D = 8.4, 7.6
PAD_TOP = 0.10           # top of the slab; the paving sits 3 cm above it

def pad(g, pavers=True, skip=None):
    """The lot pad every level stands on: a dark slab, a kerb in the owner's colour, paving slabs.
    skip: (x0, x1, z0, z1) under a building, where paving is not needed."""
    g.box("Body", PAD_W, PAD_TOP, PAD_D, y=PAD_TOP / 2, b=0.03)
    for s in (-1, 1):
        g.box("Accent", PAD_W - 0.04, 0.09, 0.13, y=PAD_TOP + 0.03, z=s * (PAD_D / 2 - 0.085), b=0.03)
        g.box("Accent", 0.13, 0.09, PAD_D - 0.30, x=s * (PAD_W / 2 - 0.085), y=PAD_TOP + 0.03, b=0.03)
    if not pavers:
        return
    nx, nz, gap = 6, 5, 0.07
    x0, z0 = -PAD_W / 2 + 0.19, -PAD_D / 2 + 0.19
    cw, cd = (PAD_W - 0.38) / nx, (PAD_D - 0.38) / nz
    for a in range(nx):
        for b in range(nz):
            xa, xb = x0 + a * cw + gap / 2, x0 + (a + 1) * cw - gap / 2
            za, zb = z0 + b * cd + gap / 2, z0 + (b + 1) * cd - gap / 2
            if skip and xa >= skip[0] and xb <= skip[1] and za >= skip[2] and zb <= skip[3]:
                continue
            g.lid("Stone", xa, xb, za, zb, PAD_TOP - 0.005, PAD_TOP + 0.035, 0.035)

BOARD_BACK = 0.24        # the plate's face sits this far behind the screen plane (the game's board frame is 0.22 deep)

def board_mount(g, spec, sides="lrtb", plate="Body", rim="Metal", neon=None, lamps=0, lamp="Glass"):
    """The flat plate a billboard screen is mounted on, with a rim just outside the game's own frame.
    sides: which rim bars to build (l, r, t, b). neon: a material for a tube round the rim. lamps: gooseneck lamps on top."""
    x, y, z, w, h = spec["x"], spec["y"], spec["z"], spec["w"], spec["h"]
    zf = z - BOARD_BACK
    g.box(plate, w + 0.5, h + 0.5, 0.12, x, y, zf - 0.06, b=0.03)
    rw, rd = 0.15, 0.30                       # rim bar: width, depth (it comes 0.18 forward of the plate)
    ox, oy = w / 2 + 0.18 + rw / 2, h / 2 + 0.18 + rw / 2
    zc = zf + 0.18 - rd / 2
    if "t" in sides:
        g.box(rim, w + 0.36 + 2 * rw, rw, rd, x, y + oy, zc, b=0.035)
    if "b" in sides:
        g.box(rim, w + 0.36 + 2 * rw, rw, rd, x, y - oy, zc, b=0.035)
    if "l" in sides:
        g.box(rim, rw, h + 0.36, rd, x - ox, y, zc, b=0.035)
    if "r" in sides:
        g.box(rim, rw, h + 0.36, rd, x + ox, y, zc, b=0.035)
    if neon:
        e, zn = rw / 2 + 0.05, zf + 0.16
        g.tube(neon, [(x - ox - e, y - oy - e, zn), (x + ox + e, y - oy - e, zn), (x + ox + e, y + oy + e, zn), (x - ox - e, y + oy + e, zn)],
               0.035, seg=4, closed=True)
    for k in range(lamps):
        lx = x + (k - (lamps - 1) / 2) * (w / max(lamps, 1))
        ty = y + oy + rw / 2
        g.tube("Body", [(lx, ty - 0.02, zc), (lx, ty + 0.36, zc + 0.08), (lx, ty + 0.38, zc + 0.5)], 0.03, seg=4)
        g.cyl("Body", 0.05, 0.2, lx, ty + 0.38, zc + 0.5, seg=6, r2=0.13, b=0.0, rx=150.0, soft=True)
        g.ball(lamp, 0.075, lx, ty + 0.255, zc + 0.575, seg=5, rings=3)

def sign_mount(g, spec, plate="Body", rim="Trim"):
    """The dark plate behind the name sign (the game draws the sign itself on a see-through plane)."""
    x, y, z, w, h = spec["x"], spec["y"], spec["z"], spec["w"], spec["h"]
    g.box(plate, w + 0.16, h + 0.16, 0.10, x, y, z - 0.03 - 0.05, b=0.03)
    if rim:
        t = 0.07
        for s in (-1, 1):
            g.box(rim, w + 0.16 + 2 * t, t, 0.14, x, y + s * (h / 2 + 0.08 + t / 2), z - 0.07, b=0.02)
            g.box(rim, t, h + 0.16, 0.14, x + s * (w / 2 + 0.08 + t / 2), y, z - 0.07, b=0.02)

def cone(g, x, z, y=PAD_TOP + 0.03, s=1.0, ry=0.0, band="Trim"):
    """A traffic cone with a pale band on a square foot."""
    with g.at(x, y, z, ry=ry, sx=s, sy=s, sz=s):
        g.box("Body", 0.52, 0.06, 0.52, y=0.03, b=0.02)
        g.lathe(["Cone", "Cone", band, "Cone", "Cone", "Cone"],
                [(0.215, 0.06), (0.20, 0.10), (0.155, 0.36), (0.125, 0.53), (0.058, 0.90), (0.04, 0.94), (0.0, 0.95)],
                seg=10, cap0=True)

def bulbs(g, mat, a, b, n, sag=0.15, r=0.07, wire="Body"):
    """A string of n round bulbs hanging between a and b, on a wire."""
    a, b = Vector(a), Vector(b)
    pts = []
    for k in range(n + 2):
        t = k / (n + 1)
        p = a.lerp(b, t)
        p.y -= sag * 4 * t * (1 - t)
        pts.append(p)
    if wire:
        g.tube(wire, pts, 0.014, seg=3)
    for p in pts[1:-1]:
        g.ball(mat, r, p.x, p.y - r * 0.9, p.z, seg=5, rings=3)

def window(g, x, y, z, w, h, ry, glass="Glass", frame="Trim", sill=True, bar=True):
    """A lit pane in a frame on a wall that looks toward ry (0 front, 90 right, 180 back, -90 left)."""
    with g.at(x, y, z, ry=ry):
        g.box(frame, w + 0.18, h + 0.18, 0.09, 0.0, 0.0, 0.0, b=0.03)
        g.pane(glass, w, h, 0.0, 0.0, 0.045, proud=0.02, c=0.025)
        if bar:
            g.box(frame, 0.05, h - 0.04, 0.03, 0.0, 0.0, 0.07, soft=True)
        if sill:
            g.box(frame, w + 0.32, 0.09, 0.2, 0.0, -h / 2 - 0.13, 0.05, b=0.025)

# ====================================================================================================== lot 0: the empty lot
def lot0_empty():
    board = dict(x=0.0, y=2.2, z=2.72, w=3.7, h=2.05)
    sign = dict(x=0.0, y=3.7, z=2.6, w=3.2, h=0.55)
    g = Geo("Lot")
    pad(g)
    top = PAD_TOP + 0.03
    # ---- the hoarding: a framed board on two timber legs with back braces, the name sign as its header
    board_mount(g, board, sides="lrb", rim="Wood")
    zf = board["z"] - BOARD_BACK
    plate_top = board["y"] + board["h"] / 2 + 0.25
    sign_mount(g, sign, rim="Wood")
    g.box("Wood", 3.9, 0.12, 0.16, 0.0, plate_top - 0.02, zf - 0.02, b=0.03)       # the ledge the header sits on
    for s in (-1, 1):
        px, pz = s * 1.55, zf - 0.22
        g.box("Wood", 0.2, 3.25, 0.2, px, top, pz, b=0.035, base=True)
        g.box("Stone", 0.56, 0.2, 0.56, px, top, pz, b=0.05, base=True)
        g.beam("Wood", (px, 2.35, pz - 0.08), (px, top + 0.08, pz - 1.45), 0.13, 0.13)
        g.box("Stone", 0.4, 0.14, 0.4, px, top, pz - 1.45, b=0.04, base=True)
        g.box("NeonGold", 0.09, 0.09, 0.09, s * 2.02, plate_top + 0.02, zf + 0.12, soft=True)   # corner studs of the frame
        g.box("NeonGold", 0.09, 0.09, 0.09, s * 2.02, board["y"] - board["h"] / 2 - 0.26, zf + 0.12, soft=True)
    g.box("Wood", 3.3, 0.12, 0.1, 0.0, 0.62, zf - 0.22, b=0.025)                    # rail between the legs
    g.tube("NeonGold", [(-2.13, 0.93, zf + 0.2), (2.13, 0.93, zf + 0.2)], 0.03, seg=4)   # glow line under the board
    # ---- cones, a barrier, a stack of planks, a heap of gravel with a shovel, survey pegs
    cone(g, -2.7, 1.7)
    cone(g, 2.7, 1.7)
    cone(g, -3.2, -0.9, s=0.9, ry=20)
    with g.at(3.0, top, -0.25, ry=78):                                              # striped barrier on two A-legs
        for s in (-1, 1):
            g.beam("Wood", (s * 0.85, 0.0, 0.28), (s * 0.85, 0.98, 0.0), 0.09, 0.07)
            g.beam("Wood", (s * 0.85, 0.0, -0.28), (s * 0.85, 0.98, 0.0), 0.09, 0.07)
        for k in range(6):
            g.box("Cone" if k % 2 == 0 else "Trim", 0.355, 0.24, 0.07, -0.89 + k * 0.356, 0.78, 0.07, b=0.02)
            g.box("Trim" if k % 2 == 0 else "Cone", 0.355, 0.14, 0.07, -0.89 + k * 0.356, 0.42, 0.11, b=0.02)
        g.box("Body", 0.16, 0.1, 0.12, 0.0, 1.02, 0.0, soft=True)
        g.ball("NeonGold", 0.1, 0.0, 1.15, 0.0, seg=8, rings=4)
    with g.at(0.75, top, -2.7, ry=-5):                                              # planks and blocks waiting for the builder
        for k, (dx, ry) in enumerate(((0.0, 0), (0.05, 3), (-0.04, -2), (0.03, 5))):
            g.box("Wood", 2.3, 0.09, 0.34, dx, 0.05 + k * 0.095, (k % 2) * 0.12 - 0.06, b=0.02, ry=ry)
        g.box("Stone", 0.5, 0.22, 0.26, -0.5, 0.11, 0.62, b=0.03, ry=12)
        g.box("Stone", 0.5, 0.22, 0.26, 0.12, 0.11, 0.66, b=0.03, ry=-6)
        g.box("Stone", 0.5, 0.22, 0.26, -0.2, 0.33, 0.64, b=0.03, ry=4)
    with g.at(2.9, top, -2.3):                                                      # gravel and a shovel stuck in it
        g.lathe("Stone", [(0.0, -0.02), (0.95, -0.02), (0.86, 0.12), (0.55, 0.36), (0.22, 0.5), (0.0, 0.53)], seg=10,
                radial=lambda a, r, y: r * (1.0 + 0.09 * math.sin(3 * a + 1.0) + 0.05 * math.sin(5 * a)))
        g.beam("Wood", (0.25, 0.3, 0.2), (0.62, 1.42, 0.42), 0.06, 0.06)
        g.box("Body", 0.26, 0.3, 0.04, 0.2, 0.22, 0.17, b=0.012, rx=-10, rz=-18)
        g.beam("Wood", (0.52, 1.42, 0.42), (0.72, 1.42, 0.42), 0.055, 0.055, soft=True)
    for sx in (-1, 1):                                                              # pegs with a ribbon at the back corners
        with g.at(sx * 3.55, top, -3.15):
            g.box("Wood", 0.09, 0.7, 0.09, y=0.0, b=0.02, base=True)
            g.prism("Accent", [(0.0, 0.0), (0.42, 0.1), (0.0, 0.22)], 0.03, x=0.045 * sx, y=0.44, ry=90 - sx * 60, b=0.008)
    # ---- the spot the gem floats over: a gold ring let into the paving
    g.ring("NeonGold", 0.92, 0.035, 0.0, top + 0.035, 0.6, n=20)
    # ---- the floating gem, its own node so the game can turn and bob it
    gem = Geo("Gem", origin=(0.0, 4.35, 0.6))
    gem.lathe("Gem", [(0.0, -0.66), (0.40, -0.06), (0.40, 0.08), (0.24, 0.44), (0.0, 0.66)], seg=6, flat=True)
    return dict(geos=[g, gem], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(6000, 150))

# ====================================================================================================== lot 1: the market tent
def lot1_tent():
    board = dict(x=0.0, y=4.7, z=0.4, w=6.2, h=3.5)
    sign = dict(x=0.0, y=1.55, z=2.28, w=2.8, h=0.5)
    g = Geo("Lot")
    pad(g)
    top = PAD_TOP + 0.03
    zf = board["z"] - BOARD_BACK
    # ---- the billboard: a plate on two steel masts with back stays, lamps over it
    board_mount(g, board, neon="NeonGold", lamps=3, lamp="NeonGold")
    for s in (-1, 1):
        mx, mz = s * 2.98, zf - 0.22
        g.box("Metal", 0.2, 6.55, 0.2, mx, top, mz, b=0.035, base=True)
        g.box("Stone", 0.6, 0.24, 0.6, mx, top, mz, b=0.05, base=True)
        g.beam("Metal", (mx, 5.3, mz - 0.06), (mx, top + 0.1, -3.0), 0.12, 0.12)
        g.box("Stone", 0.46, 0.16, 0.46, mx, top, -3.0, b=0.04, base=True)
        g.beam("Metal", (mx, 2.75, mz - 0.06), (mx, 2.75, -1.62), 0.09, 0.09, soft=True)
    for y in (3.3, 4.7, 6.1):
        g.box("Metal", 5.9, 0.12, 0.1, 0.0, y, zf - 0.17, soft=True)
    # ---- the tent: four posts, a striped canopy with its ridge under the board, pointed valance, bulbs.
    # The front eave stops just in front of the counter so nothing hangs in front of the name board.
    EAVE, RIDGE, ZB, ZF, HX = 2.12, 2.56, -2.05, 2.32, 2.7
    zs = [ZB, ZB / 2, 0.0, ZF / 2, ZF]
    ys = [EAVE, (EAVE + RIDGE) / 2 - 0.03, RIDGE, (EAVE + RIDGE) / 2 - 0.03, EAVE]
    xs = frange(-HX, HX, 10)
    g.sheet("Cloth", [[(x, y, z) for x in xs] for z, y in zip(zs, ys)], 0.05, pick=lambda a, b: "Accent" if b % 2 == 0 else "Cloth")
    for k in range(9):                                                              # front valance, colours swapped
        g.prism("Cloth" if k % 2 == 0 else "Accent", [(0.0, 0.0), (0.6, 0.0), (0.6, -0.15), (0.3, -0.27), (0.0, -0.15)], 0.045,
                x=-HX + k * 0.6, y=EAVE - 0.02, z=ZF + 0.01, b=0.01)
    for s in (-1, 1):                                                               # gable ends: a cloth band along the slope
        g.prism("Cloth", [(ZB, EAVE), (0.0, RIDGE), (ZF, EAVE), (ZF, EAVE - 0.22), (0.0, RIDGE - 0.22), (ZB, EAVE - 0.22)], 0.045,
                x=s * (HX + 0.01), y=-0.02, ry=-90, b=0.01)
        for z in (ZF - 0.27, ZB + 0.28):
            g.box("WoodDark", 0.16, EAVE - top - 0.04, 0.16, s * 2.4, top, z, b=0.03, base=True)
            g.box("Stone", 0.34, 0.1, 0.34, s * 2.4, top, z, soft=True, base=True)
        g.beam("WoodDark", (s * 2.4, EAVE - 0.1, ZB + 0.28), (s * 2.4, RIDGE - 0.12, 0.0), 0.1, 0.1, soft=True)
        g.beam("WoodDark", (s * 2.4, RIDGE - 0.12, 0.0), (s * 2.4, EAVE - 0.1, ZF - 0.27), 0.1, 0.1, soft=True)
    g.box("WoodDark", 4.9, 0.1, 0.1, 0.0, EAVE - 0.1, ZF - 0.27, b=0.02)
    g.box("WoodDark", 4.9, 0.1, 0.1, 0.0, EAVE - 0.1, ZB + 0.28, soft=True)
    g.box("WoodDark", 4.9, 0.1, 0.1, 0.0, RIDGE - 0.12, 0.0, soft=True)
    bulbs(g, "NeonGold", (-HX, EAVE - 0.04, ZF + 0.09), (HX, EAVE - 0.04, ZF + 0.09), 9, sag=0.07, r=0.07)
    for s in (-1, 1):
        bulbs(g, "NeonGold", (s * (HX + 0.09), EAVE - 0.3, ZF), (s * (HX + 0.09), RIDGE - 0.32, 0.0), 4, sag=0.08, r=0.065)
    for lx in (-1.3, 1.3):                                                          # two shaded lamps under the ridge
        g.tube("Body", [(lx, RIDGE - 0.15, 0.9), (lx, 2.0, 0.9)], 0.015, seg=3)
        g.cyl("Metal", 0.2, 0.14, lx, 1.88, 0.9, seg=8, r2=0.06, b=0.0)
        g.ball("NeonGold", 0.085, lx, 1.86, 0.9, seg=5, rings=3)
    # ---- the counter with the name board on its front edge, goods on top
    g.box("Body", 4.7, 0.1, 0.86, 0.0, top, 1.75, soft=True, base=True)
    g.box("WoodDark", 4.6, 0.83, 0.8, 0.0, top + 0.1, 1.75, b=0.03, base=True)
    g.box("Wood", 4.9, 0.09, 1.0, 0.0, 1.105, 1.75, b=0.025)
    for px in (-1.52, 0.0, 1.52):
        g.box("Wood", 1.36, 0.58, 0.06, px, 0.66, 2.15, b=0.03)
    sign_mount(g, sign, rim="Wood")
    for s in (-1, 1):
        g.box("WoodDark", 0.1, 0.2, 0.16, s * 1.2, 1.17, 2.17, soft=True)
    with g.at(0.0, 1.15, 1.72):
        for cx, mat in ((-1.85, "Accent"), (-0.95, "Cloth")):                       # crates of round goods
            g.box("WoodDark", 0.66, 0.2, 0.46, cx, 0.1, 0.0, b=0.025)
            for a in range(3):
                for b in range(2):
                    g.ball(mat, 0.115, cx - 0.2 + a * 0.2, 0.24, -0.1 + b * 0.2, seg=5, rings=3)
        g.box("Metal", 0.5, 0.1, 0.36, 0.2, 0.05, 0.0, soft=True)                   # a scale
        g.cyl("Metal", 0.2, 0.05, 0.2, 0.16, 0.0, seg=8, r2=0.26, b=0.0, soft=True)
        g.box("Body", 0.06, 0.2, 0.06, 0.2, 0.2, 0.0, soft=True)
        for k in range(3):                                                          # a stack of boxed sweets
            g.box("Accent" if k % 2 else "Cloth", 0.5 - k * 0.06, 0.11, 0.36 - k * 0.05, 1.25, 0.055 + k * 0.115, 0.0, b=0.02, ry=k * 9)
        g.cyl("Cloth", 0.13, 0.26, 1.95, 0.0, 0.05, seg=8, r2=0.16, b=0.0, soft=True)   # a jar with a lid
        g.cyl("WoodDark", 0.17, 0.05, 1.95, 0.26, 0.05, seg=8, b=0.0, soft=True)
    # ---- behind the counter: crates, a barrel, sacks, a stool
    with g.at(-1.2, top, -1.35, ry=4):
        for k, (cx, cy, mat) in enumerate(((-0.75, 0.0, "Wood"), (0.1, 0.0, "WoodDark"), (0.95, 0.0, "Wood"), (-0.3, 0.52, "WoodDark"), (0.55, 0.52, "Wood"))):
            g.box(mat, 0.8, 0.5, 0.6, cx, cy, 0.0, b=0.03, base=True, ry=(k * 7) % 5 - 2)
    with g.at(1.75, top, -1.2):                                                     # a barrel with two steel hoops
        g.lathe(["Wood", "Wood", "Metal", "Wood", "Wood", "Metal", "Wood", "Wood", "Wood"],
                [(0.0, 0.0), (0.3, 0.0), (0.345, 0.14), (0.365, 0.2), (0.39, 0.43), (0.365, 0.66), (0.345, 0.72), (0.3, 0.86), (0.26, 0.88), (0.0, 0.88)], seg=12)
    for sx, sz, r in ((-2.0, 0.55, 0.3), (-1.72, 0.2, 0.26)):
        g.ball("Cloth", r, sx, top + r * 0.7, sz, seg=8, rings=4, scale=(1.0, 0.72, 0.85))
        g.box("WoodDark", 0.1, 0.05, 0.1, sx, top + r * 1.42, sz, soft=True)
    with g.at(0.7, top, 0.75):
        g.cyl("Wood", 0.2, 0.06, 0.0, 0.5, 0.0, seg=8, b=0.015)
        for a in range(3):
            g.beam("WoodDark", (0.13 * math.cos(a * 2.1), 0.5, 0.13 * math.sin(a * 2.1)), (0.2 * math.cos(a * 2.1), 0.0, 0.2 * math.sin(a * 2.1)), 0.05, 0.05, soft=True)
    # ---- a folding board out front
    with g.at(-3.35, top, 3.0, ry=28):
        g.box("WoodDark", 0.66, 1.0, 0.05, 0.0, 0.48, 0.14, b=0.02, rx=-16)
        g.box("WoodDark", 0.66, 1.0, 0.05, 0.0, 0.48, -0.14, b=0.02, rx=16)
        g.box("Body", 0.5, 0.72, 0.03, 0.0, 0.5, 0.175, soft=True, rx=-16)
        g.box("Accent", 0.34, 0.07, 0.03, 0.0, 0.66, 0.15, soft=True, rx=-16)
        g.box("Cloth", 0.26, 0.05, 0.03, 0.0, 0.5, 0.2, soft=True, rx=-16)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(6000, 150))

# ====================================================================================================== lot 2: the street food stall
def lot2_pocha():
    """A tall open stall under the board (the board's plate starts at 4.35 m, the stall reaches 3.9 m): a cart with a
    serving counter, the cooking in view, a lit menu wall and hanging lamps, a tarp roof in the owner's colour that
    is lifted at the front so the inside shows from above too, a big red lantern at the front corner, stools."""
    board = dict(x=0.0, y=6.4, z=2.05, w=6.4, h=3.6)
    sign = dict(x=2.2, y=2.2, z=2.05, w=2.4, h=0.5)
    g = Geo("Lot")
    pad(g, skip=(-3.5, 3.5, -1.4, 1.0))
    top = PAD_TOP + 0.03
    zf = board["z"] - BOARD_BACK
    MX, MZ = 3.15, zf - 0.22                    # the two masts: the stall's front corner posts carry the board
    EF, EB = 3.45, 2.95                         # underside of the roof at the front edge (z = 2.0) and at the back (z = -1.6)
    Y0 = 1.15                                   # top of the cabinet: the cooking stands here
    roof_y = lambda z: EB + (EF - EB) * (z + 1.6) / 3.6
    # ---- the billboard on the masts, stayed to the back of the roof
    board_mount(g, board, neon="NeonPink", lamps=2)
    for s in (-1, 1):
        g.box("Metal", 0.2, 8.25, 0.2, s * MX, top, MZ, b=0.035, base=True)
        g.box("Stone", 0.5, 0.2, 0.5, s * MX, top, MZ, b=0.05, base=True)
        g.beam("Metal", (s * MX, 6.4, MZ - 0.08), (s * MX, EB + 0.3, -1.42), 0.11, 0.11)
    g.box("Metal", 6.5, 0.12, 0.12, 0.0, 4.27, MZ, b=0.02)
    for y in (5.2, 7.6):
        g.box("Metal", 6.2, 0.1, 0.1, 0.0, y, zf - 0.17, soft=True)
    # ---- the cart: stainless cabinet on wheels, serving counter on brackets, a neon line round it
    g.box("Body", 6.8, 0.2, 2.2, 0.0, top, -0.15, soft=True, base=True)
    g.box("Metal", 7.0, 0.82, 2.4, 0.0, top + 0.2, -0.15, b=0.04, base=True)
    for px in (-2.61, -0.87, 0.87, 2.61):
        g.box("Metal", 1.56, 0.56, 0.05, px, 0.74, 1.055, b=0.03)
    for s in (-1, 1):
        for wz in (-1.0, 0.7):
            g.lathe(["Body", "Body", "Body", "Metal", "Metal"], [(0.0, -0.09), (0.19, -0.09), (0.24, -0.04), (0.24, 0.07), (0.12, 0.1), (0.0, 0.1)],
                    x=s * 3.46, y=0.37, z=wz, seg=8, rz=-90.0 * s)
    g.tube("NeonPink", [(-3.56, 0.5, -1.2), (-3.56, 0.5, 1.11), (3.56, 0.5, 1.11), (3.56, 0.5, -1.2)], 0.035, seg=4)
    g.box("Metal", 7.3, 0.07, 0.78, 0.0, 1.2, 1.37, b=0.025)
    for bx in (-2.9, -1.45, 0.0, 1.45, 2.9):
        g.prism("Body", [(0.0, 0.0), (0.6, 0.0), (0.0, -0.42)], 0.07, x=bx, y=1.165, z=1.06, ry=-90, soft=True)
    # ---- the frame: back posts, a header under the roof edge, low side panels
    for s in (-1, 1):
        g.box("Body", 0.14, roof_y(-1.27) - Y0, 0.14, s * 3.42, Y0, -1.27, b=0.025, base=True)
        g.beam("Body", (s * 3.42, roof_y(-1.27) - 0.07, -1.27), (s * 3.42, roof_y(1.5) - 0.07, 1.5), 0.14, 0.14, soft=True)
        g.box("Metal", 0.07, 0.5, 2.25, s * 3.46, Y0, -0.13, b=0.02, base=True)
    g.box("Body", 7.5, 0.3, 0.3, 0.0, roof_y(1.65) - 0.17, 1.65, b=0.04)
    # ---- warm light inside: a lit menu wall behind the cooking, bottles in front of it, lamps over the counter
    g.box("Body", 7.0, EB - Y0 + 0.05, 0.1, 0.0, Y0, -1.3, b=0.02, base=True)
    g.pane("Glass", 5.9, 1.2, -0.2, 2.15, -1.25, proud=0.04, c=0.03)
    for k in range(4):
        g.box("Body", 0.05, 1.24, 0.07, -2.0 + k * 1.2, 2.15, -1.21, soft=True)
    g.box("Body", 5.95, 0.05, 0.07, -0.2, 2.2, -1.21, soft=True)
    g.box("Metal", 6.4, 0.05, 0.3, 0.0, 1.42, -1.1, soft=True)
    for k, mat in enumerate(("Accent", "Lantern", "Cloth", "Accent", "Cloth", "Lantern")):
        g.cyl(mat, 0.06, 0.2 + 0.06 * (k % 2), -2.5 + k * 0.92, 1.445, -1.1, seg=5, r2=0.04, b=0.0, soft=True)
    for lx in (-2.45, -0.95, 0.55):
        g.tube("Body", [(lx, roof_y(0.95), 0.95), (lx, 2.82, 0.95)], 0.014, seg=3)
        g.cyl("Body", 0.2, 0.13, lx, 2.7, 0.95, seg=8, r2=0.05, b=0.0, soft=True)
        g.ball("Glass", 0.105, lx, 2.68, 0.95, seg=6, rings=3)
    g.box("Glass", 6.0, 0.05, 0.1, -0.1, roof_y(1.55) - 0.36, 1.55, soft=True)
    # ---- the name plate hangs from the roof edge on the right, braced to the mast; the counter stays open under it
    sign_mount(g, sign, rim="Metal")
    for hx in (1.25, 3.05):
        g.box("Metal", 0.05, roof_y(1.95) - 2.58, 0.05, hx, 2.58, 1.95, soft=True, base=True)
    g.box("Metal", 0.07, 0.07, 0.34, MX, 2.2, 1.78, soft=True)
    # ---- the tarp roof in the owner's colour, lifted at the front: a low vault with cream ribs, a pointed valance,
    # steel edges, a neon line along the front
    def arch(z0, z1, lift, rise):
        n = 8
        pts = [(z0, roof_y(z0) + lift), (z1, roof_y(z1) + lift), (z1, roof_y(z1) + lift + 0.08)]
        for k in range(1, n):
            z = z1 - (z1 - z0) * k / n
            pts.append((z, roof_y(z) + lift + 0.08 + rise * math.sin(PI * k / n)))
        return pts + [(z0, roof_y(z0) + lift + 0.08)]
    g.prism("Accent", arch(-1.6, 2.0, 0.0, 0.42), 7.8, ry=-90, b=0.05)
    for rx_ in (-2.6, -0.87, 0.87, 2.6):
        g.prism("Cloth", arch(-1.62, 2.02, 0.012, 0.435), 0.22, x=rx_, ry=-90)
    g.box("Metal", 7.9, 0.1, 0.1, 0.0, EF + 0.04, 2.0, b=0.02)
    g.box("Metal", 7.9, 0.1, 0.1, 0.0, EB + 0.04, -1.6, b=0.02)
    g.tube("NeonPink", [(-3.92, EF + 0.14, 2.0), (3.92, EF + 0.14, 2.0)], 0.035, seg=4)
    for k in range(13):
        g.prism("Cloth" if k % 2 else "Accent", [(0.0, 0.0), (0.6, 0.0), (0.6, -0.12), (0.3, -0.22), (0.0, -0.12)], 0.04,
                x=-3.9 + k * 0.6, y=EF - 0.01, z=2.04, soft=True)
    # ---- the big red lantern at the front left corner, a small one at the right
    for lx, ly, lz, sc in ((-3.62, 2.2, 2.3, 1.0), (3.86, 2.42, 2.22, 0.52)):
        sx = -1 if lx < 0 else 1
        g.beam("Body", (sx * MX, ly + 0.56 * sc, MZ), (lx, ly + 0.56 * sc, lz), 0.07, 0.07, soft=True)
        g.tube("Body", [(lx, ly + 0.56 * sc, lz), (lx, ly + 0.5 * sc, lz)], 0.016, seg=3)
        with g.at(lx, ly, lz, sx=sc, sy=sc, sz=sc):
            g.lathe(["Body", "Body", "Lantern", "Lantern", "Lantern", "Lantern", "Lantern", "Body", "Body"],
                    [(0.0, -0.5), (0.2, -0.5), (0.25, -0.42), (0.38, -0.3), (0.46, -0.1), (0.46, 0.1), (0.38, 0.3), (0.25, 0.42), (0.2, 0.5), (0.0, 0.5)],
                    seg=12 if sc == 1.0 else 8)
            g.cyl("Glass", 0.035, 0.3, 0.0, -0.82, 0.0, seg=4, b=0.0, soft=True)
    # ---- the cooking, near the front of the cabinet where it shows: stock pot, fish-cake pot with skewers, the red
    # rice-cake pan, a steamer, a kettle, pancakes on a griddle; steam over the pot and the steamer
    cz = 0.7
    g.box("Body", 5.4, 0.06, 0.72, -0.6, Y0 + 0.03, cz - 0.03, soft=True)
    g.lathe("Metal", [(0.0, 0.0), (0.32, 0.0), (0.35, 0.03), (0.35, 0.46), (0.37, 0.48), (0.37, 0.5), (0.2, 0.57), (0.06, 0.59), (0.06, 0.64), (0.0, 0.65)],
            x=-2.7, y=Y0 + 0.06, z=cz, seg=10)
    g.box("Metal", 0.9, 0.24, 0.56, -1.6, Y0 + 0.18, cz, b=0.03)
    g.lid("Glass", -2.0, -1.2, cz - 0.23, cz + 0.23, Y0 + 0.295, Y0 + 0.315, 0.02)
    for k in range(5):
        sx = -1.93 + k * 0.165
        g.beam("Cloth", (sx, Y0 + 0.3, cz), (sx + 0.04, Y0 + 0.8, cz - 0.12 + (k % 2) * 0.2), 0.028, 0.028, soft=True)
        g.box("Cloth", 0.08, 0.14, 0.05, sx + 0.014, Y0 + 0.48, cz - 0.045 + (k % 2) * 0.075, soft=True)
    g.lathe(["Body", "Body", "Body", "Lantern", "Lantern"], [(0.0, 0.0), (0.4, 0.0), (0.43, 0.02), (0.43, 0.11), (0.38, 0.11), (0.0, 0.13)],
            x=-0.5, y=Y0 + 0.06, z=cz, seg=10)
    g.lathe(["Cloth", "Cloth", "Body", "Cloth", "Body", "Cloth", "Cloth", "Cloth"],
            [(0.0, 0.0), (0.32, 0.0), (0.32, 0.14), (0.33, 0.17), (0.32, 0.31), (0.33, 0.34), (0.26, 0.42), (0.06, 0.47), (0.0, 0.475)],
            x=0.6, y=Y0 + 0.06, z=cz, seg=10)
    g.lathe("Metal", [(0.0, 0.0), (0.16, 0.0), (0.2, 0.08), (0.2, 0.2), (0.12, 0.3), (0.05, 0.32), (0.05, 0.36), (0.0, 0.37)], x=1.5, y=Y0 + 0.06, z=cz, seg=8)
    g.beam("Metal", (1.65, Y0 + 0.2, cz), (1.87, Y0 + 0.34, cz), 0.045, 0.045, soft=True)
    g.box("Body", 0.95, 0.06, 0.6, 2.6, Y0 + 0.03, cz, soft=True)
    for k in range(3):
        g.cyl("Glass", 0.14, 0.03, 2.33 + k * 0.27, Y0 + 0.06, cz - 0.1 + (k % 2) * 0.2, seg=6, b=0.0, soft=True)
    for px, py, pz, pr in ((-2.72, 2.02, cz, 0.15), (-2.58, 2.3, cz + 0.03, 0.21), (-2.76, 2.66, cz - 0.02, 0.16),
                           (0.6, 1.9, cz, 0.14), (0.7, 2.2, cz + 0.02, 0.19)):
        g.ball("Cloth", pr, px, py, pz, seg=6, rings=4)
    # ---- on the counter: plates of skewers, cups, a napkin box, bottles
    yc = 1.235
    for px in (-2.3, -0.5, 0.9):
        g.cyl("Cloth", 0.18, 0.03, px, yc, 1.42, seg=8, b=0.0, soft=True)
        for k in range(2):
            g.box("Glass", 0.05, 0.03, 0.26, px - 0.06 + k * 0.12, yc + 0.045, 1.43, soft=True)
    for k in range(3):
        g.cyl("Accent", 0.05, 0.11, -1.35 + k * 0.13, yc, 1.5, seg=5, r2=0.06, b=0.0, soft=True)
    g.box("Cloth", 0.26, 0.12, 0.16, 0.2, yc + 0.06, 1.5, soft=True)
    for k in range(3):
        g.lathe(["Accent", "Accent", "Metal", "Metal"], [(0.0, 0.0), (0.045, 0.0), (0.045, 0.16), (0.02, 0.19), (0.0, 0.26)],
                x=1.75 + k * 0.12, y=yc, z=1.45 + (k % 2) * 0.1, seg=5, soft=True)
    # ---- stools in front, the gas bottle, the flue with its steam, a folding menu
    for sx in (-2.5, -1.2, 0.1, 1.4):
        g.lathe(["Metal", "Metal", "Metal", "Accent", "Accent", "Accent"],
                [(0.0, 0.0), (0.17, 0.0), (0.035, 0.05), (0.035, 0.38), (0.2, 0.39), (0.21, 0.47), (0.0, 0.49)],
                x=sx, y=top, z=2.8, seg=8)
    g.lathe(["Metal", "Metal", "Metal", "Body", "Metal", "Metal", "Metal", "Lantern", "Lantern"],
            [(0.0, 0.0), (0.15, 0.0), (0.18, 0.04), (0.18, 0.28), (0.18, 0.33), (0.18, 0.62), (0.13, 0.74), (0.06, 0.78), (0.05, 0.9), (0.0, 0.91)],
            x=3.93, y=top, z=-0.95, seg=8)
    g.cyl("Metal", 0.11, 2.85, 2.85, Y0, -1.0, seg=8, b=0.0)
    g.lathe("Metal", [(0.0, 0.0), (0.24, 0.0), (0.24, 0.03), (0.0, 0.2)], x=2.85, y=4.02, z=-1.0, seg=8)
    for px, py, pr in ((2.88, 4.4, 0.16), (2.98, 4.7, 0.22), (2.86, 5.02, 0.15)):
        g.ball("Cloth", pr, px, py, -1.0, seg=6, rings=4)
    with g.at(3.45, top, 3.05, ry=-28):
        g.box("Body", 0.62, 0.95, 0.05, 0.0, 0.46, 0.13, b=0.02, rx=-15)
        g.box("Body", 0.62, 0.95, 0.05, 0.0, 0.46, -0.13, b=0.02, rx=15)
        g.box("Glass", 0.46, 0.2, 0.03, 0.0, 0.66, 0.135, soft=True, rx=-15)
        g.box("Cloth", 0.36, 0.05, 0.03, 0.0, 0.44, 0.19, soft=True, rx=-15)
        g.box("Cloth", 0.36, 0.05, 0.03, 0.0, 0.32, 0.22, soft=True, rx=-15)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(6000, 150))

# ====================================================================================================== lot 3: the neon shop
def lot3_shop():
    board = dict(x=0.0, y=4.6, z=3.15, w=6.6, h=3.7)
    sign = dict(x=0.0, y=7.35, z=1.6, w=5.2, h=0.8)
    g = Geo("Lot")
    pad(g, skip=(-4.0, 4.0, -3.4, 2.5))
    top = PAD_TOP + 0.03
    zf = board["z"] - BOARD_BACK
    ZB, ZG, ZF = -3.3, 2.5, zf - 0.12           # back wall, ground-floor front (set back), upper-storey front
    Y1, Y2 = 2.4, 6.4                           # floor line of the upper storey, roof deck
    # ---- the two storeys
    g.box("Body", 8.0, Y1 - top, ZG - ZB, 0.0, top, (ZG + ZB) / 2, b=0.04, base=True)
    g.box("Body", 8.0, Y2 - Y1, ZF - ZB, 0.0, Y1, (ZF + ZB) / 2, b=0.04, base=True)
    g.box("Stone", 8.12, 0.42, ZG - ZB + 0.12, 0.0, top, (ZG + ZB) / 2, b=0.04, base=True)
    g.box("Trim", 8.14, 0.16, ZF - ZB + 0.08, 0.0, Y1 + 0.02, (ZF + ZB) / 2, b=0.03)        # belt between the storeys
    g.box("Trim", 8.3, 0.2, ZF - ZB + 0.15, 0.0, Y2 - 0.12, (ZF + ZB) / 2 - 0.075, b=0.04)   # cornice (flush at the front)
    # ---- shopfront: piers, two display windows, the double door in the owner's colour, steps, the awning
    for px, pw in ((-3.72, 0.56), (3.72, 0.56), (-1.05, 0.36), (1.05, 0.36)):
        g.box("Trim", pw, Y1 - top, 0.32, px, top, ZG + 0.13, b=0.04, base=True)
        g.box("Stone", pw + 0.08, 0.46, 0.38, px, top, ZG + 0.13, b=0.04, base=True)
    for s in (-1, 1):
        cx = s * 2.335
        g.box("Stone", 2.22, 0.5, 0.22, cx, top, ZG + 0.09, b=0.03, base=True)
        g.pane("Glass", 2.16, 1.52, cx, 1.43, ZG + 0.02, proud=0.03, c=0.02)
        g.box("Trim", 2.22, 0.08, 0.12, cx, 2.2, ZG + 0.05, soft=True)
        g.box("Trim", 0.07, 1.5, 0.1, cx, 1.43, ZG + 0.06, soft=True)
        g.box("Trim", 2.14, 0.06, 0.09, cx, 1.86, ZG + 0.06, soft=True)
        for k in range(3):                                                          # goods on show: three plinths with a glow
            g.box("Body", 0.34, 0.26 + 0.12 * (k % 2), 0.2, cx - 0.62 + k * 0.62, 0.81 + 0.06 * (k % 2), ZG + 0.14, soft=True)
            g.ball("NeonPink" if (k + (s > 0)) % 2 else "NeonCyan", 0.11, cx - 0.62 + k * 0.62, 1.1 + 0.12 * (k % 2), ZG + 0.16, seg=5, rings=3)
        g.box("Accent", 0.72, 1.98, 0.07, s * 0.375, top + 0.16, ZG + 0.05, b=0.02, base=True)
        g.pane("Glass", 0.46, 1.2, s * 0.375, 1.38, ZG + 0.085, proud=0.02, c=0.02)
        g.box("NeonGold", 0.045, 0.34, 0.05, s * 0.09, 1.2, ZG + 0.12, soft=True)
        g.box("Trim", 0.1, 2.14, 0.14, s * 0.81, top + 0.1, ZG + 0.06, b=0.02, base=True)
    g.box("Trim", 1.72, 0.1, 0.14, 0.0, 2.28, ZG + 0.06, b=0.02)
    g.box("Stone", 2.3, 0.16, 0.62, 0.0, top, ZG + 0.34, b=0.03, base=True)
    g.box("Stone", 2.8, 0.08, 0.98, 0.0, top, ZG + 0.5, b=0.025, base=True)
    awn = [(ZF - 0.02, 2.36), (ZF + 0.45, 2.14), (ZF + 0.45, 1.94), (ZF + 0.39, 1.94), (ZF + 0.39, 2.08), (ZF - 0.02, 2.27)]
    g.prism("Accent", awn, 7.5, ry=-90, b=0.02)
    g.tube("NeonCyan", [(-3.76, 1.95, ZF + 0.48), (3.76, 1.95, ZF + 0.48)], 0.035, seg=4)
    for s in (-1, 1):                                                               # lamps by the door, bollards, planters
        g.box("Body", 0.1, 0.16, 0.14, s * 1.05, 1.9, ZG + 0.34, soft=True)
        g.ball("Glass", 0.1, s * 1.05, 1.76, ZG + 0.36, seg=5, rings=3)
        g.lathe(["Body", "Body", "Body", "NeonCyan", "NeonCyan"], [(0.0, 0.0), (0.1, 0.0), (0.09, 0.6), (0.1, 0.62), (0.08, 0.74), (0.0, 0.78)],
                x=s * 3.75, y=top, z=3.45, seg=6)
        g.box("Stone", 1.3, 0.34, 0.38, s * 2.5, top, 3.1, b=0.04, base=True)
        for k in range(4):
            g.ball("Accent", 0.14, s * 2.5 - 0.42 + k * 0.28, top + 0.4 + 0.04 * (k % 2), 3.1, seg=5, rings=3)
    # ---- the board: plate on the upper storey, gold tube round it, pilasters with gold lines at the corners
    board_mount(g, board, neon="NeonGold", rim="Trim")
    for s in (-1, 1):
        g.box("Trim", 0.3, Y2 - Y1 - 0.3, 0.12, s * 3.84, Y1 + 0.1, ZF + 0.03, b=0.03, base=True)
        g.tube("NeonGold", [(s * 3.84, Y1 + 0.25, ZF + 0.12), (s * 3.84, Y2 - 0.3, ZF + 0.12)], 0.04, seg=4)
    # ---- side walls: lit windows on both floors, a pink line along the belt; signs on brackets
    for s in (-1, 1):
        for wz in (-2.05, -0.3, 1.45):
            window(g, s * 4.0, 4.45, wz, 1.0, 1.6, s * 90)
        for wz in (-2.05, 0.2):
            window(g, s * 4.0, 1.5, wz, 1.2, 1.15, s * 90, sill=False)
        g.tube("NeonPink", [(s * 4.12, Y1 + 0.16, ZB + 0.15), (s * 4.12, Y1 + 0.16, ZF - 0.15)], 0.035, seg=4)
    g.beam("Body", (4.0, 4.05, 2.2), (4.9, 4.05, 2.2), 0.07, 0.07, soft=True)        # round sign on the right
    g.cyl("Body", 0.46, 0.1, 4.55, 3.36, 2.2, seg=12, b=0.03, axis="z", base=False)
    g.box("Body", 0.03, 0.26, 0.03, 4.55, 3.93, 2.2, soft=True)
    for dz in (-0.06, 0.06):
        g.ring("NeonPink", 0.37, 0.03, 4.55, 3.36, 2.2 + dz, n=12, seg=3, axis="z")
    g.box("Body", 0.14, 2.3, 0.62, -4.42, 4.5, 2.1, b=0.04)                          # upright sign on the left
    for by in (3.7, 5.3):
        g.beam("Body", (-4.0, by, 2.1), (-4.36, by, 2.1), 0.06, 0.06, soft=True)
    for dx in (-0.08, 0.08):
        g.tube("NeonCyan", [(-4.42 + dx, 3.5, 1.88), (-4.42 + dx, 5.5, 1.88), (-4.42 + dx, 5.5, 2.32), (-4.42 + dx, 3.5, 2.32)], 0.028, seg=3, closed=True)
    # ---- back wall: a door, two windows, an air conditioner, a downpipe
    g.box("Trim", 0.95, 2.05, 0.08, -2.2, top + 0.02, ZB - 0.02, b=0.02, base=True)
    for wx in (-1.6, 1.6):
        window(g, wx, 4.45, ZB, 1.0, 1.6, 180, sill=False)
    g.box("Trim", 1.0, 0.62, 0.42, 1.5, 1.6, ZB - 0.22, b=0.04)
    g.tube("Trim", [(3.6, Y2 - 0.2, ZB - 0.1), (3.6, top + 0.3, ZB - 0.1), (3.6, top + 0.12, ZB - 0.3)], 0.06, seg=5)
    # ---- roof: parapet with a cap in the owner's colour, the stepped front with the name plate, things on the deck
    cap_y = Y2 + 0.38
    for z in (ZF - 0.125, ZB + 0.125):
        g.box("Body", 8.0, 0.42, 0.25, 0.0, Y2 - 0.02, z, b=0.03, base=True)
        g.box("Accent", 8.14, 0.14, 0.37, 0.0, cap_y, z, b=0.04, base=True)
    for s in (-1, 1):
        g.box("Body", 0.25, 0.42, ZF - ZB - 0.5, s * 3.875, Y2 - 0.02, (ZF + ZB) / 2, b=0.03, base=True)
        g.box("Accent", 0.37, 0.14, ZF - ZB - 0.36, s * 3.875, cap_y, (ZF + ZB) / 2, b=0.04, base=True)
    sign_mount(g, sign, rim="Trim")
    sz = sign["z"] - 0.13
    g.box("Body", 5.7, 1.62, 0.34, 0.0, Y2, sz - 0.17, b=0.04, base=True)
    g.box("Trim", 5.9, 0.12, 0.44, 0.0, Y2 + 1.62, sz - 0.17, b=0.03, base=True)
    g.box("Body", 2.4, 0.3, 0.34, 0.0, Y2 + 1.74, sz - 0.17, b=0.04, base=True)
    g.box("Trim", 2.6, 0.1, 0.44, 0.0, Y2 + 2.04, sz - 0.17, b=0.03, base=True)
    for s in (-1, 1):
        g.box("Body", 0.7, 0.95, 0.34, s * 3.2, Y2, sz - 0.17, b=0.04, base=True)
        g.box("Trim", 0.82, 0.1, 0.44, s * 3.2, Y2 + 0.95, sz - 0.17, b=0.03, base=True)
        g.ball("NeonGold", 0.13, s * 3.2, Y2 + 1.2, sz - 0.17, seg=6, rings=3)
        g.beam("Trim", (s * 2.2, Y2 + 1.4, sz - 0.34), (s * 2.2, Y2 + 0.04, sz - 1.5), 0.09, 0.09, soft=True)
    e = 0.2
    g.tube("NeonGold", [(-2.6 - e, 6.95 - e, sign["z"] - 0.02), (2.6 + e, 6.95 - e, sign["z"] - 0.02), (2.6 + e, 7.75 + e, sign["z"] - 0.02), (-2.6 - e, 7.75 + e, sign["z"] - 0.02)],
           0.035, seg=4, closed=True)
    with g.at(-2.45, Y2, -1.9):                                                     # stair hut
        g.box("Body", 1.7, 1.5, 1.6, 0.0, 0.0, 0.0, b=0.04, base=True)
        g.box("Trim", 1.9, 0.1, 1.8, 0.0, 1.5, 0.0, b=0.03, base=True)
        g.box("Trim", 0.7, 1.2, 0.06, 0.0, 0.02, 0.81, soft=True, base=True)
        g.ball("Glass", 0.09, 0.0, 1.36, 0.86, seg=5, rings=3)
    with g.at(2.35, Y2, -1.75):                                                     # water tank on legs, New York style
        for a in range(4):
            ca, sa = math.cos(PI / 4 + a * PI / 2), math.sin(PI / 4 + a * PI / 2)
            g.beam("Trim", (0.78 * ca, 0.0, 0.78 * sa), (0.6 * ca, 0.8, 0.6 * sa), 0.09, 0.09, soft=True)
        g.lathe(["Trim", "Trim", "Trim", "Trim", "Body", "Trim", "Body", "Trim", "Body", "Trim", "Body", "Body", "Body", "Body"],
                [(0.0, 0.78), (0.86, 0.78), (0.86, 0.86), (0.76, 0.86), (0.76, 1.04), (0.76, 1.1), (0.76, 1.38), (0.76, 1.44), (0.76, 1.72), (0.76, 1.78),
                 (0.76, 1.96), (0.86, 1.96), (0.86, 2.0), (0.08, 2.46), (0.0, 2.48)], seg=12)       # a pale tank with three dark hoops
        g.ball("NeonGold", 0.07, 0.0, 2.54, 0.0, seg=5, rings=3)
    g.box("Trim", 1.7, 0.14, 1.2, 0.2, Y2, -0.45, b=0.03, base=True)                 # skylight
    g.lid("Glass", -0.55, 0.95, -0.95, 0.05, Y2 + 0.14, Y2 + 0.21, 0.05)
    g.box("Trim", 1.0, 0.6, 0.7, 0.3, Y2, -2.5, b=0.04, base=True)                   # air conditioner
    g.cyl("Body", 0.24, 0.04, 0.3, Y2 + 0.6, -2.5, seg=8, b=0.0, soft=True)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(6000, 150))

# ====================================================================================================== lot 4: the tower
def window_inset(g, x, y, z, w, h, ry, glass="Glass", frame="Trim", depth=0.11):
    """A pane on the wall plane inside a proud frame of four bars with a deeper sill: it reads as set into the wall.
    The wall looks toward ry (0 front, 90 right, 180 back, -90 left)."""
    with g.at(x, y, z, ry=ry):
        g.plate(glass, w, h, 0.0, 0.0, 0.012, 0)
        t = 0.09
        g.box(frame, w + 2 * t, t, depth, 0.0, h / 2 + t / 2, depth / 2 - 0.01, soft=True)
        g.box(frame, w + 2 * t + 0.08, t + 0.03, depth + 0.07, 0.0, -h / 2 - t / 2, depth / 2 + 0.025, soft=True)
        for s in (-1, 1):
            g.box(frame, t, h, depth, s * (w / 2 + t / 2), 0.0, depth / 2 - 0.01, soft=True)

def lot4_tower():
    """The board hides the shaft from 8.8 m up, so the part below it carries the building: a tall lobby (glass
    between pilasters, a marquee in the owner's colour, doors) as a podium, the shaft set back on it with its
    windows recessed in a grid of piers and floor bands, neon up the piers and on fins at the sides, and a stepped
    crown with a lit lantern tier, a spire and a beacon that stands above the board. Nothing the game positions has
    moved: the board plate and the name plate are where buildPlot mounts them."""
    board = dict(x=0.0, y=12.6, z=3.55, w=12.6, h=7.1)
    sign = dict(x=0.0, y=16.3, z=1.2, w=6.2, h=0.9)
    g = Geo("Lot")
    pad(g, pavers=False)
    top = PAD_TOP
    zf = board["z"] - BOARD_BACK                    # face of the board's plate
    PF, ZB, HX = zf - 0.24, -2.75, 3.5              # the shaft's pier faces: front (rails carry the plate off it), back, half width
    IN = 0.2                                        # the glass wall stands this far inside the pier faces
    Y1, Y2, FL = 4.3, 15.8, 1.28                    # top of the podium, roof of the shaft, floor to floor
    ZC = (PF + ZB) / 2
    # ---- the podium: a tall lobby
    PZ, PB, PW = 3.42, -3.22, 7.9                   # its front and back faces, its width
    pc = (PZ + PB) / 2
    g.box("Body", PW, Y1 - top, PZ - PB, 0.0, top, pc, b=0.06, base=True)
    g.box("Trim", PW + 0.12, 0.4, PZ - PB + 0.12, 0.0, top, pc, b=0.05, base=True)
    g.box("Trim", PW + 0.2, 0.3, PZ - PB + 0.2, 0.0, Y1 - 0.2, pc, b=0.06, base=True)
    e = PW / 2 + 0.16
    g.tube("NeonPink", [(-e, Y1 + 0.14, PB - 0.16), (-e, Y1 + 0.14, PZ + 0.16), (e, Y1 + 0.14, PZ + 0.16), (e, Y1 + 0.14, PB - 0.16)], 0.04, seg=4, closed=True)
    GW, GH, GY = 4.6, 3.1, 0.55                      # the lobby glass: width, height, sill
    g.pane("Glass", GW, GH, 0.0, GY + GH / 2, PZ, 0, proud=0.03, c=0.02)
    for s in (-1, 1):
        g.box("Trim", 0.44, Y1 - top - 0.3, 0.3, s * (GW / 2 + 0.27), top, PZ + 0.1, b=0.05, base=True)      # pilasters
        g.ball("Glass", 0.11, s * (GW / 2 + 0.27), 3.05, PZ + 0.33, seg=6, rings=3)                           # a lamp on each
        g.box("Accent", 0.1, 2.3, 0.16, s * 0.74, top + 0.05, PZ + 0.07, b=0.02, base=True)                   # door jambs
        g.box("NeonGold", 0.04, 0.42, 0.05, s * 0.1, 1.3, PZ + 0.11, soft=True)                               # handles
        window_inset(g, s * 3.38, 2.1, PZ, 0.62, 2.6, 0)
        for wz in (-1.9, 0.1, 2.1):
            window_inset(g, s * PW / 2, 2.15, wz, 1.2, 2.7, s * 90)
        g.lathe(["Body", "Body", "Body", "NeonCyan", "NeonCyan"], [(0.0, 0.0), (0.11, 0.0), (0.1, 0.58), (0.11, 0.6), (0.09, 0.73), (0.0, 0.77)],
                x=s * 2.6, y=top, z=3.6, seg=6)
    g.box("Trim", GW + 1.06, 0.36, 0.3, 0.0, GY + GH + 0.2, PZ + 0.1, b=0.05)                                 # lintel
    for mx in (-1.55, -0.78, 0.78, 1.55):
        g.box("Trim", 0.07, GH, 0.1, mx, GY + GH / 2, PZ + 0.05, soft=True)
    g.box("Trim", GW, 0.08, 0.1, 0.0, 2.52, PZ + 0.05, soft=True)
    g.box("Accent", 1.58, 0.1, 0.16, 0.0, 2.4, PZ + 0.07, b=0.02)
    g.box("Trim", 0.05, 2.25, 0.1, 0.0, top + 0.05, PZ + 0.06, soft=True, base=True)
    for wx in (-2.4, 0.0, 2.4):
        window_inset(g, wx, 2.15, PB, 1.2, 2.7, 180)
    g.box("Trim", 4.2, 0.1, 0.22, 0.0, top, PZ + 0.11, soft=True, base=True)                                  # the step
    AY = 2.82                                                                                                # the marquee
    g.box("Accent", 3.6, 0.2, 1.0, 0.0, AY, PZ + 0.5, b=0.07)
    g.tube("NeonGold", [(-1.86, AY - 0.02, PZ + 0.02), (-1.86, AY - 0.02, PZ + 1.06), (1.86, AY - 0.02, PZ + 1.06), (1.86, AY - 0.02, PZ + 0.02)], 0.035, seg=4)
    for s in (-1, 0, 1):
        g.ball("Glass", 0.08, s * 1.2, AY - 0.13, PZ + 0.6, seg=5, rings=3)
    for s in (-1, 1):
        g.beam("Trim", (s * 1.5, AY + 0.08, PZ + 0.9), (s * 1.5, AY + 0.86, PZ + 0.12), 0.05, 0.05, soft=True)
    # ---- the shaft, set back on the podium: a dark glass wall inside a grid of piers and floor bands
    H = Y2 - Y1
    g.box("Body", 2 * (HX - IN), H, PF - ZB - 2 * IN, 0.0, Y1, ZC, b=0.02, base=True)
    g.box("Trim", 2 * HX + 0.1, 0.34, PF - ZB + 0.1, 0.0, Y1 + 0.02, ZC, b=0.04, base=True)                   # base band
    for k in range(1, 9):
        g.box("Trim", 2 * (HX - 0.07), 0.2, PF - ZB - 0.14, 0.0, Y1 + FL * k, ZC, b=0.03)                     # floor bands
    g.box("Trim", 2 * HX + 0.3, 0.26, PF - ZB + 0.3, 0.0, Y2, ZC, b=0.05)                                     # roof cornice
    for sx in (-1, 1):
        for z in (ZB + 0.25, PF - 0.25):
            g.box("Trim", 0.5, H, 0.5, sx * (HX - 0.25), Y1, z, b=0.05, base=True)                            # corner piers
    side_piers = (ZB + 0.5 + (PF - ZB - 1.0) / 3, ZB + 0.5 + 2 * (PF - ZB - 1.0) / 3)
    side_bays = [ZB + 0.5 + (PF - ZB - 1.0) * (k + 0.5) / 3 for k in range(3)]
    for x in (-1.5, 0.0, 1.5):
        g.box("Trim", 0.22, 8.75 - Y1, 0.22, x, Y1, PF - 0.11, b=0.03, base=True)                             # front piers, to the board
        g.tube("NeonCyan", [(x, Y1 + 0.45, PF + 0.03), (x, 8.6, PF + 0.03)], 0.035, seg=4)
        g.box("Trim", 0.22, H, 0.22, x, Y1, ZB + 0.11, b=0.03, base=True)
    for sx in (-1, 1):
        for z in side_piers:
            g.box("Trim", 0.22, H, 0.22, sx * (HX - 0.11), Y1, z, b=0.03, base=True)
            g.box("Trim", 0.36, H - 0.3, 0.08, sx * (HX + 0.16), Y1 + 0.3, z, b=0.02, base=True)              # a fin on each side pier
            g.tube("NeonPink", [(sx * (HX + 0.37), Y1 + 0.4, z), (sx * (HX + 0.37), Y2 - 0.25, z)], 0.035, seg=4)
        g.tube("NeonCyan", [(sx * (HX + 0.04), Y1 + 0.45, ZB - 0.04), (sx * (HX + 0.04), Y2 - 0.3, ZB - 0.04)], 0.04, seg=4)
        g.tube("NeonCyan", [(sx * (HX + 0.04), Y1 + 0.45, PF + 0.04), (sx * (HX + 0.04), 8.6, PF + 0.04)], 0.04, seg=4)
    rng = random.Random(7)
    def lit():
        r = rng.random()
        return "Glass" if r < 0.55 else "GlassDark" if r < 0.84 else "NeonCyan" if r < 0.92 else "NeonPink"
    row = lambda k: Y1 + FL * (k + 0.5)
    for x in (-2.25, -0.75, 0.75, 2.25):
        for k in range(4):
            g.plate(lit(), 1.26, FL - 0.24, x, row(k), PF - IN + 0.006, 0)
        for k in range(9):
            g.plate(lit(), 1.26, FL - 0.24, x, row(k), ZB + IN - 0.006, 180)
    for sx in (-1, 1):
        for z in side_bays:
            for k in range(9):
                g.plate(lit(), (PF - ZB - 1.0) / 3 - 0.24, FL - 0.24, sx * (HX - IN + 0.006), row(k), z, sx * 90)
    # ---- the big board: wider than the shaft, on rails, its wings carried by outriggers; a warning light on each top corner
    board_mount(g, board, neon="NeonGold", rim="Trim")
    for rx_ in (-3.0, -1.0, 1.0, 3.0):
        g.box("Trim", 0.22, 7.3, 0.12, rx_, board["y"], zf - 0.18, soft=True)
    for sx in (-1, 1):
        g.box("Trim", 0.2, 8.2, 0.2, sx * 6.3, board["y"] + 0.45, zf - 0.22, b=0.03)
        g.ball("NeonPink", 0.11, sx * 6.3, board["y"] + 4.66, zf - 0.22, seg=6, rings=3)
        for y in (9.4, 12.6, 15.75):
            g.beam("Trim", (sx * 3.4, y, zf - 0.22), (sx * 6.4, y, zf - 0.22), 0.2, 0.2, soft=True)
            g.beam("Trim", (sx * 6.25, y, zf - 0.3), (sx * (HX + 0.3), y, side_piers[1]), 0.12, 0.12, soft=True)
    # ---- the crown, behind and above the board: the block with the name plate on its face (it has to reach above the
    # sign at 15.85 .. 16.75), a band in the owner's colour, a lit lantern tier, a cap, the spire and its beacon at 19 m
    CZ = -0.75
    g.box("Body", 6.6, 1.15, 3.7, 0.0, Y2 + 0.1, CZ, b=0.05, base=True)
    sign_mount(g, sign, rim="Trim")
    g.box("Accent", 6.9, 0.2, 4.0, 0.0, Y2 + 1.25, CZ, b=0.06, base=True)
    g.box("Body", 5.4, 0.62, 3.0, 0.0, Y2 + 1.45, CZ, b=0.05, base=True)
    g.pane("Glass", 4.7, 0.34, 0.0, Y2 + 1.76, CZ + 1.5, 0, proud=0.03, c=0.03)
    g.pane("Glass", 4.7, 0.34, 0.0, Y2 + 1.76, CZ - 1.5, 180, proud=0.03, c=0.03)
    for sx in (-1, 1):
        g.pane("Glass", 2.3, 0.34, sx * 2.7, Y2 + 1.76, CZ, sx * 90, proud=0.03, c=0.03)
        for sz in (-1, 1):
            g.box("Trim", 0.34, 0.72, 0.34, sx * 3.05, Y2 + 1.45, CZ + sz * 1.6, b=0.05, base=True)           # corner posts of the crown
            g.ball("NeonGold", 0.11, sx * 3.05, Y2 + 2.28, CZ + sz * 1.6, seg=6, rings=3)
    g.tube("NeonGold", [(-2.78, Y2 + 2.1, CZ - 1.58), (-2.78, Y2 + 2.1, CZ + 1.58), (2.78, Y2 + 2.1, CZ + 1.58), (2.78, Y2 + 2.1, CZ - 1.58)], 0.04, seg=4, closed=True)
    g.box("Trim", 3.6, 0.36, 2.0, 0.0, Y2 + 2.07, CZ, b=0.05, base=True)
    g.box("Accent", 2.4, 0.14, 1.3, 0.0, Y2 + 2.43, CZ, b=0.04, base=True)
    g.lathe("Trim", [(0.0, 0.0), (0.32, 0.0), (0.26, 0.08), (0.11, 0.3), (0.06, 0.52), (0.0, 0.54)], y=Y2 + 2.57, z=CZ, seg=8)
    g.ring("NeonPink", 0.3, 0.03, 0.0, Y2 + 2.82, CZ, n=10, seg=3)
    g.ball("NeonPink", 0.12, 0.0, Y2 + 3.08, CZ, seg=8, rings=4)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(8000, 150))

# ====================================================================================================== taxi
def taxi():
    """A chunky toy cab on the footprint of the box kit in ts3d/traffic.js: it drives toward +z (headlights at +z,
    as the kit does), its left side is +x. Big wheels under flared arches, thick bumpers with over-riders, a chrome
    grille, mirrors, door handles. Nodes: Body, Glass, Checker, Wheel_FL/FR/RL/RR (origins on the axles, they turn
    about x), RoofSign, HeadLights, TailLights."""
    WR, WX, WZ, RA = 0.40, 0.86, 1.45, 0.48          # wheel radius, half track, half wheelbase, arch radius
    HW, SILL, BELT = 0.97, 0.33, 1.04                # half width of the body, its underside, its shoulder line
    body = Geo("Body")
    # ---- the lower body: one skin lofted from tail to nose. The underside lifts over the axles to make the arches.
    def top(z):                                       # the bonnet falls a little toward the nose
        return BELT if z < 1.1 else BELT - 0.07 * (z - 1.1) / 0.83
    rows = [(-2.33, 0.74, 0.47, 0.84), (-2.30, 0.84, 0.41, 0.93), (-2.22, 0.92, 0.36, 0.99), (-2.08, 0.96, 0.34, 1.025)]
    for zc in (-WZ, WZ):
        rows.append((zc - RA - 0.02, HW, SILL, top(zc - RA - 0.02)))
        for dz in (-0.46, -0.37, -0.22, 0.0, 0.22, 0.37, 0.46):
            rows.append((zc + dz, HW, WR + math.sqrt(RA * RA - dz * dz), top(zc + dz)))
        rows.append((zc + RA + 0.02, HW, SILL, top(zc + RA + 0.02)))
    rows += [(2.09, 0.96, 0.34, 0.95), (2.24, 0.92, 0.36, 0.915), (2.32, 0.84, 0.41, 0.86), (2.36, 0.74, 0.47, 0.78)]
    def ring(z, hw, y0, y1):
        rt = min(0.12, (y1 - y0) * 0.45)
        rb = min(0.05, (y1 - y0) * 0.2)
        half = [(0.0, y0), (hw - rb, y0), (hw, y0 + rb), (hw, y1 - rt)]
        half += [(hw - rt + rt * math.cos(a), y1 - rt + rt * math.sin(a)) for a in (PI / 6, PI / 3)]
        half += [(hw - rt, y1), (0.0, y1)]
        pts = half + [(-x, y) for x, y in reversed(half[1:-1])]
        return [(x, y, z) for x, y in pts]
    dark = {0, 1, 12, 13}                             # underside and sill
    body.loft("Paint", [ring(*r) for r in rows], pick=lambda si, k: "Trim" if (0 <= si < len(rows) - 1 and k in dark) else None)
    # ---- flared wheel arches: a lip round each arch, standing 6 cm proud of the body side
    for sx in (-1, 1):
        for zc in (-WZ, WZ):
            secs = []
            for k in range(9):
                a = -0.2 + (PI + 0.4) * k / 8
                c, s = math.cos(a), math.sin(a)
                secs.append([(sx * (HW - 0.03), WR + (RA - 0.02) * s, zc + (RA - 0.02) * c), (sx * (HW + 0.06), WR + (RA - 0.01) * s, zc + (RA - 0.01) * c),
                             (sx * (HW + 0.06), WR + (RA + 0.09) * s, zc + (RA + 0.09) * c), (sx * (HW - 0.03), WR + (RA + 0.11) * s, zc + (RA + 0.11) * c)])
            v, f, _ = g_loft(secs, True, True, True)
            body.emit(v, f, "Paint", soft=True)
    # ---- the cabin: a skin lofted upward; the window band is split off into the Glass node
    levels = [(1.0, 0.89, 1.14, -1.66, 0.22), (1.11, 0.88, 1.08, -1.6, 0.22), (1.47, 0.78, 0.66, -1.26, 0.20),
              (1.55, 0.74, 0.56, -1.16, 0.22), (1.59, 0.62, 0.42, -1.02, 0.20)]
    def cab_ring(y, hx, zf, zr, rc):
        q = rc * math.sqrt(0.5)
        za, zb = zf - rc, zr + rc
        half = [(0.0, zf), (hx - rc, zf), (hx - rc + q, zf - rc + q), (hx, za), (hx, za + (zb - za) * 0.47), (hx, za + (zb - za) * 0.55),
                (hx, zb), (hx - rc + q, zr + rc - q), (hx - rc, zr), (0.0, zr)]
        pts = half + [(-x, z) for x, z in reversed(half[1:-1])]
        return [(x, y, z) for x, z in pts]
    panes = {0, 17, 3, 5, 8, 9, 12, 14}
    v, f, at = g_loft([cab_ring(*l) for l in levels], True, True, True)
    f = recalc(v, f)
    paint = [fc for fc, (si, k) in zip(f, at) if not (si == 1 and k in panes)]
    glass_f = [fc for fc, (si, k) in zip(f, at) if si == 1 and k in panes]
    body.emit(v, paint, "Paint", fix=None)
    glass = Geo("Glass")
    glass.emit(v, glass_f, "Glass", fix=None)
    # ---- bumpers with chrome over-riders and a chrome strip, the grille in a chrome frame, lamp rims
    for z, s in ((2.34, 1), (-2.31, -1)):
        body.box("Trim", 1.86, 0.2, 0.24, 0.0, 0.45, z, b=0.07)
        body.box("Chrome", 1.6, 0.035, 0.03, 0.0, 0.5, z + s * 0.125, soft=True)
        for ox in (-0.5, 0.5):
            body.box("Chrome", 0.09, 0.27, 0.1, ox, 0.46, z + s * 0.1, soft=True)
    body.box("Chrome", 0.8, 0.32, 0.06, 0.0, 0.69, 2.35, b=0.02)
    body.box("Trim", 0.7, 0.22, 0.05, 0.0, 0.69, 2.37, soft=True)
    for gy in (0.63, 0.69, 0.75):
        body.box("Chrome", 0.68, 0.022, 0.05, 0.0, gy, 2.385, soft=True)
    body.box("Chrome", 0.04, 0.24, 0.055, 0.0, 0.69, 2.39, soft=True)
    for s in (-1, 1):
        body.cyl("Chrome", 0.17, 0.07, s * 0.58, 0.69, 2.31, seg=10, b=0.02, axis="z")
        body.box("Trim", 0.38, 0.22, 0.05, s * 0.52, 0.7, -2.325, b=0.02)
        # ---- mirrors on stalks, chrome door handles, the seam between the doors
        body.box("Paint", 0.1, 0.14, 0.2, s * 1.06, 1.17, 0.98, b=0.04)
        body.box("Chrome", 0.08, 0.11, 0.02, s * 1.06, 1.17, 0.875, soft=True)
        body.box("Trim", 0.2, 0.045, 0.07, s * 0.95, 1.13, 1.0, soft=True)
        for hz in (0.42, -0.56):
            body.box("Chrome", 0.035, 0.045, 0.18, s * 0.972, 0.972, hz, soft=True)
        body.box("Trim", 0.012, 0.3, 0.018, s * 0.972, 0.5, -0.1, soft=True)
    # ---- plates, the boot handle, the exhaust, the roof-sign foot
    body.box("White", 0.44, 0.14, 0.03, 0.0, 0.45, 2.465, soft=True)
    body.box("White", 0.44, 0.14, 0.03, 0.0, 0.72, -2.345, soft=True)
    body.box("Chrome", 0.34, 0.035, 0.035, 0.0, 0.87, -2.325, soft=True)
    body.cyl("Chrome", 0.045, 0.14, -0.55, 0.35, -2.42, seg=6, b=0.0, axis="z", soft=True)
    body.box("Trim", 0.56, 0.05, 0.22, 0.0, 1.6, -0.3, b=0.02)
    # ---- the checker stripe along the doors: a pale band with dark squares of 12 cm standing proud of it.
    # Its own node, so the same body can be an ordinary car by leaving this node and RoofSign out.
    checker = Geo("Checker")
    for s in (-1, 1):
        checker.box("White", 0.03, 0.26, 1.94, s * (HW + 0.005), 0.8, 0.0, soft=True)
        for col in range(16):
            for row in range(2):
                if (col + row) % 2 == 0:
                    checker.box("Trim", 0.03, 0.12, 0.12, s * (HW + 0.016), 0.74 + row * 0.12, -0.9 + col * 0.12, soft=True)
    # ---- the lit parts, each its own node: the roof sign (no lettering: the game draws it), head and tail lamps
    sign = Geo("RoofSign")
    sign.box("RoofSign", 0.9, 0.26, 0.22, 0.0, 1.75, -0.3, b=0.06)
    head = Geo("HeadLights")
    tail = Geo("TailLights")
    for s in (-1, 1):
        head.lathe("LightFront", [(0.0, 0.0), (0.135, 0.0), (0.135, 0.05), (0.085, 0.09), (0.0, 0.1)], x=s * 0.58, y=0.69, z=2.34, seg=10, rx=90.0)
        tail.box("LightRear", 0.32, 0.16, 0.07, s * 0.52, 0.7, -2.34, b=0.03)
    # ---- wheels: fat tyre and a chrome dish in one turned shape; the outside face looks away from the car
    wheels = []
    for name, sx, sz in (("Wheel_FL", 1, 1), ("Wheel_FR", -1, 1), ("Wheel_RL", 1, -1), ("Wheel_RR", -1, -1)):
        w = Geo(name, origin=(sx * WX, WR, sz * WZ))
        w.lathe(["Trim", "Trim", "Trim", "Trim", "Trim", "Chrome", "Chrome", "Chrome"],
                [(0.0, -0.14), (0.34, -0.14), (WR, -0.075), (WR, 0.075), (0.34, 0.14), (0.255, 0.14), (0.23, 0.09), (0.12, 0.135), (0.0, 0.145)],
                seg=12, rz=-90.0 * sx)
        wheels.append(w)
    palette = {
        "Paint":      ("#f2f2f2", 0.32, 0.25, None, 0.0),          # neutral: the game tints it (cab yellow #ffc21a, or the owner's colour)
        "Trim":       ("#14161c", 0.55, 0.0, None, 0.0),           # tyres, bumpers, underside, the dark squares
        "Chrome":     ("#c9cfd8", 0.25, 0.8, None, 0.0),
        "White":      ("#ecebe6", 0.5, 0.0, None, 0.0),
        "Glass":      ("#0d1a30", 0.08, 0.4, "#20406e", 0.3),
        "RoofSign":   ("#fff3a0", 0.4, 0.0, "#fff3a0", 1.6),
        "LightFront": ("#fff6da", 0.3, 0.0, "#fff6da", 3.0),
        "LightRear":  ("#ff2018", 0.3, 0.0, "#ff2018", 2.2),
    }
    return dict(geos=[body, glass, checker] + wheels + [sign, head, tail], palette=palette, budget=(3500, 120))

# ====================================================================================================== the plaza tree
def xmas_tree():
    """A 9 m Christmas tree in a wooden tub: six tiers of boughs with a zigzag rim, baubles under the tips, a garland
    with bulbs on every tier (material `Lights`, so the game can blink them), gift boxes at the foot, the star as its
    own node `Star`."""
    g = Geo("Tree")
    g.lathe(["Wood", "Wood", "Wood", "Gold", "Gold", "Gold", "Wood"],
            [(0.0, 0.0), (1.0, 0.0), (1.08, 0.06), (1.2, 0.62), (1.27, 0.66), (1.27, 0.82), (1.17, 0.86), (0.0, 0.82)], seg=16)
    g.cyl("Gold", 1.13, 0.07, 0.0, 0.22, 0.0, seg=16, b=0.02)
    g.cyl("Wood", 0.3, 1.3, 0.0, 0.8, 0.0, seg=8, r2=0.2, b=0.0)
    LOBES, SEG = 9, 18
    tiers = [(1.45, 2.75, 2.0), (2.6, 2.4, 1.9), (3.7, 2.0, 1.8), (4.75, 1.62, 1.65), (5.75, 1.25, 1.5), (6.65, 0.9, 1.45)]
    orn = ("Pink", "Gold", "Cyan")
    count = 0
    for k, (y, R, h) in enumerate(tiers):
        turn = (k * 0.41) % 1.0                       # each tier is turned a little against the one below
        ph = 2 * PI * turn / SEG                      # the angle of its first tip
        wob = lambda a, r, yy, R=R, ph=ph: r * (1.0 + 0.13 * math.cos(LOBES * (a - ph)) * min(1.0, (r / R) ** 2))
        g.lathe("Leaf", [(0.0, y + 0.34), (R * 0.72, y + 0.14), (R, y), (R * 0.93, y + 0.17), (R * 0.56, y + h * 0.5), (R * 0.22, y + h * 0.92), (0.0, y + h)],
                seg=SEG, radial=wob, phase=turn)
        for j in range(LOBES):                                                      # a bauble under every other tip
            if (j + k) % 2:
                continue
            a = ph + 2 * PI * j / LOBES
            r = 0.2 - 0.012 * k
            g.ball(orn[count % 3], r, R * 1.1 * math.cos(a), y - r * 0.55, R * 1.1 * math.sin(a), seg=6, rings=4)
            g.box("Gold", 0.06, 0.07, 0.06, R * 1.1 * math.cos(a), y + r * 0.5, R * 1.1 * math.sin(a), soft=True)
            count += 1
        n = max(6, round(2 * PI * 0.8 * R / 0.62))                                  # the garland with its bulbs, low on the tier where it shows
        ring = []
        for j in range(n):
            a = 2 * PI * j / n + ph * 0.5
            rr = R * 0.80 + 0.07
            ring.append((rr * math.cos(a), y + h * 0.28 + 0.07 * math.cos(4 * a), rr * math.sin(a)))
        g.tube("Gold", ring, 0.03, seg=3, closed=True)
        for p in ring:
            g.lathe("Lights", [(0.0, -0.085), (0.085, 0.0), (0.0, 0.085)], x=p[0] * 1.03, y=p[1] + 0.02, z=p[2] * 1.03, seg=4, soft=True)
    g.lathe("Leaf", [(0.0, 7.62), (0.42, 7.5), (0.5, 7.52), (0.2, 8.0), (0.0, 8.42)], seg=10)
    g.cyl("Gold", 0.05, 0.3, 0.0, 8.3, 0.0, seg=5, b=0.0, soft=True)
    # ---- gifts round the tub
    gifts = [(2.3, 20, 0.8, 0.55, 0.7, "Pink"), (2.45, 62, 0.6, 0.6, 0.6, "Cyan"), (2.25, 105, 0.95, 0.45, 0.6, "Gold"), (2.5, 150, 0.55, 0.8, 0.55, "Pink"),
             (2.3, 208, 0.75, 0.5, 0.75, "Cyan"), (2.4, 255, 0.6, 0.42, 0.9, "Gold"), (2.45, 300, 0.85, 0.65, 0.6, "Pink"), (2.25, 340, 0.5, 0.5, 0.5, "Cyan")]
    for dist, ang, w, h, d, mat in gifts:
        with g.at(dist * math.cos(rad(ang)), 0.0, dist * math.sin(rad(ang)), ry=-ang + 15):
            g.box(mat, w, h, d, 0.0, 0.0, 0.0, b=0.04, base=True)
            g.box("Ribbon", w + 0.02, h + 0.02, 0.12, 0.0, -0.005, 0.0, soft=True, base=True)
            g.box("Ribbon", 0.12, h + 0.02, d + 0.02, 0.0, -0.005, 0.0, soft=True, base=True)
            for s in (-1, 1):
                g.box("Ribbon", 0.2, 0.1, 0.1, s * 0.11, h + 0.06, 0.0, soft=True, rz=s * 28)
    # ---- the star: five points, thick in the middle, its own node
    star = Geo("Star", origin=(0.0, 8.5, 0.0))
    pts = [((0.5 if j % 2 == 0 else 0.21) * math.sin(PI * j / 5), (0.5 if j % 2 == 0 else 0.21) * math.cos(PI * j / 5)) for j in range(10)]
    v = [(x, y, 0.0) for x, y in pts] + [(0.0, 0.0, 0.15), (0.0, 0.0, -0.15)]
    f = [(j, (j + 1) % 10, 10) for j in range(10)] + [((j + 1) % 10, j, 11) for j in range(10)]
    star.emit(v, f, "Star", flat=True)
    palette = {
        "Leaf":   ("#1c7a48", 0.80, 0.0, None, 0.0),
        "Wood":   ("#8a5a35", 0.78, 0.0, None, 0.0),
        "Gold":   ("#ffc94a", 0.30, 0.6, "#ffb52e", 0.35),
        "Pink":   ("#ff3d9a", 0.25, 0.2, "#ff3d9a", 0.5),
        "Cyan":   ("#3fe6ff", 0.25, 0.2, "#3fe6ff", 0.45),
        "Ribbon": ("#f4efe2", 0.60, 0.0, None, 0.0),
        "Star":   ("#ffd86a", 0.30, 0.2, "#ffcf5a", 2.6),
        "Lights": ("#fff1c8", 0.40, 0.0, "#ffe7a0", 3.0),
    }
    return dict(geos=[g, star], palette=palette, budget=(5000, 140))

# ====================================================================================================== the air dancer
def air_dancer():
    """A 4 m inflatable tube figure on a blower, for shop openings. One skinned mesh `Dancer` on eight bones (Body1,
    Body2, Body3, Head, ArmL1, ArmL2, ArmR1, ArmR2) and a 2 second looping clip `Wave` with a key on every frame at
    30 fps. The blower `Base` is a plain node that does not move. It faces +z; its left arm is at +x."""
    SH_Y, ARM_L, UP = 2.5, 1.3, rad(35.0)
    sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (x - a) / (b - a))))
    weights = []                                    # one {bone: weight} per vertex of the Dancer mesh, in order
    g = Geo("Dancer")
    def emit(make, skin):
        n0 = len(g.v)
        make()
        weights.extend(skin(p) for p in g.v[n0:])
    def body_w(p):
        t1, t2, t3 = sstep(0.85, 1.25, p.y), sstep(1.6, 2.0, p.y), sstep(2.35, 2.75, p.y)
        return {"Body1": 1 - t1, "Body2": t1 * (1 - t2), "Body3": t1 * t2 * (1 - t3), "Head": t1 * t2 * t3}
    head_w = lambda p: {"Head": 1.0}
    # ---- the tube: a skirt on the blower, two stripes, a round top
    ys = [0.3 + 0.15 * k for k in range(21)]
    prof = [(0.0, 0.3), (0.4, 0.3)] + [(0.345 - 0.014 * (y - 0.3), y) for y in ys[1:]] + [(0.27, 3.42), (0.17, 3.51), (0.0, 3.55)]
    mats = ["Tube"] * (len(prof) - 1)
    for k in (8, 9, 13, 14):
        mats[k] = "Stripe"
    emit(lambda: g.lathe(mats, prof, seg=12), body_w)
    # ---- the face and the fringe ride the head
    def face():
        for s in (-1, 1):
            with g.at(ry=s * 24.0):                  # the eyes lie on the round of the tube
                g.cyl("Eye", 0.095, 0.035, 0.0, 3.03, 0.285, seg=8, b=0.0, axis="z", soft=True)
                g.cyl("Face", 0.045, 0.03, -s * 0.012, 3.02, 0.305, seg=6, b=0.0, axis="z", soft=True)
        r = 0.305
        g.tube("Face", [(x, 2.8 - 0.07 * math.cos(x / 0.17 * PI / 2), math.sqrt(r * r - x * x) + 0.012) for x in (-0.17, -0.09, 0.0, 0.09, 0.17)], 0.022, seg=3)
        for j, a in enumerate((-62, -40, -18, 0, 18, 40, 62)):
            dx, dy = math.sin(rad(a)), math.cos(rad(a))
            g.beam("Stripe", (dx * 0.1, 3.46, 0.0), (dx * 0.52, 3.46 + dy * 0.5, 0.06 * (j % 2) - 0.03), 0.07, 0.025, soft=True)
    emit(face, head_w)
    # ---- arms: tubes from the shoulders, three streamers at each hand
    bones = [("Body1", (0, 0.3, 0), (0, 1.05, 0), None), ("Body2", (0, 1.05, 0), (0, 1.8, 0), "Body1"),
             ("Body3", (0, 1.8, 0), (0, 2.55, 0), "Body2"), ("Head", (0, 2.55, 0), (0, 3.55, 0), "Body3")]
    for side, sx in (("L", 1), ("R", -1)):
        S = Vector((sx * 0.22, SH_Y, 0.0))
        d = Vector((sx * math.cos(UP), math.sin(UP), 0.0))
        def arm_w(p, S=S, d=d, side=side):
            s = (p - S).dot(d)
            t1, t2 = sstep(0.02, 0.3, s), sstep(0.5, 0.8, s)
            return {"Body3": 1 - t1, "Arm" + side + "1": t1 * (1 - t2), "Arm" + side + "2": t1 * t2}
        emit(lambda: g.tube("Stripe", [S + d * (ARM_L * k / 8) for k in range(9)], lambda t: 0.145 - 0.035 * t, seg=8), arm_w)
        tip = S + d * ARM_L
        def streamers():
            for a in (-30, 0, 30):
                q = Matrix.Rotation(rad(a), 3, "Z") @ d
                g.beam("Tube", tip - d * 0.03, tip + q * 0.34, 0.07, 0.025, soft=True)
        emit(streamers, lambda p, side=side: {"Arm" + side + "2": 1.0})
        mid = S + d * (ARM_L / 2)
        bones.append(("Arm" + side + "1", tuple(S), tuple(mid), "Body3"))
        bones.append(("Arm" + side + "2", tuple(mid), tuple(tip), "Arm" + side + "1"))
    # ---- the blower: a drum on feet with a steel collar and a handle; it does not move
    base = Geo("Base")
    base.cyl("Base", 0.48, 0.3, 0.0, 0.06, 0.0, seg=12, b=0.05)
    base.cyl("Metal", 0.41, 0.06, 0.0, 0.34, 0.0, seg=12, b=0.02)
    for a in (30, 150, 270):
        base.box("Base", 0.2, 0.08, 0.14, 0.42 * math.cos(rad(a)), 0.04, 0.42 * math.sin(rad(a)), soft=True, ry=-a)
    base.tube("Metal", [(-0.2, 0.2, 0.47), (-0.2, 0.2, 0.58), (0.2, 0.2, 0.58), (0.2, 0.2, 0.47)], 0.022, seg=4)
    for a in range(0, 360, 45):
        base.box("Metal", 0.03, 0.2, 0.02, 0.485 * math.cos(rad(a + 100)), 0.2, 0.485 * math.sin(rad(a + 100)), soft=True, ry=-(a + 100) + 90)

    def rig(obs):
        mesh, base_ob = obs[0], obs[1]
        ad = bpy.data.armatures.new("AirDancer")
        arm = bpy.data.objects.new("AirDancer", ad)
        bpy.context.scene.collection.objects.link(arm)
        bpy.context.view_layer.update()
        for o in bpy.context.scene.objects:
            o.select_set(o is arm)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="EDIT")
        for name, head, tail, parent in bones:
            eb = ad.edit_bones.new(name)
            eb.head, eb.tail = to_blender(head), to_blender(tail)
            if parent:
                eb.parent, eb.use_connect = ad.edit_bones[parent], False
        bpy.ops.object.mode_set(mode="OBJECT")
        assert len(weights) == len(mesh.data.vertices), (len(weights), len(mesh.data.vertices))
        groups = {name: mesh.vertex_groups.new(name=name) for name, *_ in bones}
        for vi, w in enumerate(weights):
            tot = sum(w.values())
            for bone, val in w.items():
                if val / tot > 1e-3:
                    groups[bone].add([vi], val / tot, "REPLACE")
        mesh.parent = arm
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        # ---- the clip: the body sways as a wave that climbs the tube, the arms flap twice per sway
        act = bpy.data.actions.new("Wave")
        arm.animation_data_create()
        arm.animation_data.action = act
        FRONT, SIDE, UPAX = (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
        w = 2 * PI
        def about(axis, deg):
            from mathutils import Quaternion
            return Quaternion(Vector(to_blender(axis)), rad(deg))
        def pose(t):
            # The arms rest 35 degrees above level. They flap between about level and 55 degrees up and the forearm
            # never folds past upright, and they are held a little to the front: with a wider flap or a swing to
            # the back an arm crossed the head or went behind it (seen on the 8-frame sheet of the first version).
            s = math.sin
            return {
                "Body1": about(FRONT, 8 * s(w * t)) @ about(SIDE, 5 * s(2 * w * t + 0.6)),
                "Body2": about(FRONT, 13 * s(w * t - 0.9)) @ about(SIDE, 6 * s(2 * w * t + 0.1)),
                "Body3": about(FRONT, 15 * s(w * t - 1.8)) @ about(SIDE, 7 * s(2 * w * t - 0.5)),
                "Head":  about(FRONT, 13 * s(w * t - 2.7)) @ about(SIDE, 8 * s(2 * w * t - 1.1)) @ about(UPAX, 8 * s(w * t + 0.4)),
                "ArmL1": about(FRONT, -10 + 28 * s(2 * w * t + 0.3)) @ about(UPAX, -(10 + 12 * s(w * t + 1.0))),
                "ArmL2": about(FRONT, 5 + 30 * s(2 * w * t - 0.8)),
                "ArmR1": about(FRONT, 10 - 28 * s(2 * w * t + 2.0)) @ about(UPAX, 10 + 12 * s(w * t + 2.4)),
                "ArmR2": about(FRONT, -5 - 30 * s(2 * w * t + 0.9)),
            }
        rest = {b.name: b.matrix_local.to_quaternion() for b in ad.bones}
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
        prev = {}
        for fr in range(61):                         # frame 60 repeats frame 0: the loop closes
            for name, q in pose(fr / 60.0).items():
                pb = arm.pose.bones[name]
                r = rest[name].inverted() @ q @ rest[name]
                if name in prev and prev[name].dot(r) < 0:
                    r.negate()
                prev[name] = r.copy()
                pb.rotation_quaternion = r
                pb.keyframe_insert("rotation_quaternion", frame=fr)
        bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, 60
        bpy.context.scene.frame_set(0)
        return [arm, mesh, base_ob]

    palette = {
        "Tube":   ("#ff3d9a", 0.55, 0.0, "#ff3d9a", 0.25),          # the figure's colour (the game may set its own)
        "Stripe": ("#3fe6ff", 0.55, 0.0, "#3fe6ff", 0.25),
        "Eye":    ("#ffffff", 0.5, 0.0, None, 0.0),
        "Face":   ("#16131c", 0.5, 0.0, None, 0.0),
        "Base":   ("#262d42", 0.6, 0.0, None, 0.0),
        "Metal":  ("#aeb7c6", 0.36, 0.65, None, 0.0),
    }
    return dict(geos=[g, base], palette=palette, post=rig, skin=True, anim=True, budget=(1500, 120))

# ====================================================================================================== main
ASSETS = {
    "lot0_empty": lot0_empty,
    "lot1_tent": lot1_tent,
    "lot2_pocha": lot2_pocha,
    "lot3_shop": lot3_shop,
    "lot4_tower": lot4_tower,
    "taxi": taxi,
    "xmas_tree": xmas_tree,
    "air_dancer": air_dancer,
}

def build(name):
    new_scene()
    spec = ASSETS[name]()
    LOCAL.clear()
    LOCAL.update(spec.get("palette", {}))
    obs = [finish(g) for g in spec["geos"]]
    for an, sp in spec.get("anchors", {}).items():
        obs.append(anchor(an, sp))
    if "post" in spec:
        obs = spec["post"](obs) or obs
    path = export(name, obs, skin=spec.get("skin", False), anim=spec.get("anim", False))
    report(name, spec["geos"], path, *spec["budget"])

if __name__ == "__main__":
    todo = list(ASSETS) if not names or names == ["all"] else names
    bad = [n for n in todo if n not in ASSETS]
    if bad:
        raise SystemExit("unknown asset: %s (choose from: %s, all)" % (", ".join(bad), ", ".join(ASSETS)))
    for n in todo:
        build(n)
    log("wrote", len(todo), "file(s) to", OUT_DIR)
