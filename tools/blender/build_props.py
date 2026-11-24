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
#   - the taxi drives toward +z like the kit in vehicleKits (headlights at +z); its left wheels are at +x.
#   - materials are flat colours. `Accent` is what the game tints with the owner's colour: it is exported neutral
#     light grey with a mild glow of the same grey, so set both color and emissive to the theme colour.
#     Neon materials (NeonPink, NeonCyan, NeonGold, Glass, Lantern, Lights, ...) carry an emissive strength above 1
#     (KHR_materials_emissive_strength, which three.js reads as emissiveIntensity).
#   - shading: every hard edge has a small chamfer and the normals are weighted by face area, so the big faces stay
#     flat and the chamfers catch the light. No texture coordinates are written.
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

def material(name):
    if name in MATS:
        return MATS[name]
    base, rough, metal, glow, strength = PALETTE[name]
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
        export_optimize_animation_size=False,
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
    with g.at(1.2, top, -2.55, ry=-8):                                              # planks and blocks waiting for the builder
        for k, (dx, ry) in enumerate(((0.0, 0), (0.05, 3), (-0.04, -2), (0.03, 5))):
            g.box("Wood", 2.3, 0.09, 0.34, dx, 0.05 + k * 0.095, (k % 2) * 0.12 - 0.06, b=0.02, ry=ry)
        g.box("Stone", 0.5, 0.22, 0.26, -0.5, 0.11, 0.62, b=0.03, ry=12)
        g.box("Stone", 0.5, 0.22, 0.26, 0.12, 0.11, 0.66, b=0.03, ry=-6)
        g.box("Stone", 0.5, 0.22, 0.26, -0.2, 0.33, 0.64, b=0.03, ry=4)
    with g.at(-1.9, top, -2.2):                                                     # gravel and a shovel stuck in it
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
    board = dict(x=0.0, y=6.4, z=2.05, w=6.4, h=3.6)
    sign = dict(x=2.2, y=2.2, z=2.05, w=2.4, h=0.5)
    g = Geo("Lot")
    pad(g, skip=(-3.5, 3.5, -1.4, 1.0))
    top = PAD_TOP + 0.03
    zf = board["z"] - BOARD_BACK
    MX, MZ = 3.15, zf - 0.22                    # the two masts: the stall's front corner posts carry the board
    # ---- the billboard on the masts, braced, with a string of bulbs under it
    board_mount(g, board, neon="NeonPink", lamps=2)
    for s in (-1, 1):
        g.box("Metal", 0.2, 8.25, 0.2, s * MX, top, MZ, b=0.035, base=True)
        g.box("Stone", 0.5, 0.2, 0.5, s * MX, top, MZ, b=0.05, base=True)
        g.beam("Metal", (s * MX, 6.2, MZ - 0.08), (s * MX, 2.8, -1.38), 0.11, 0.11)
        g.beam("Metal", (s * MX, 2.95, MZ), (-s * MX, 4.2, MZ), 0.06, 0.06, soft=True)
    g.box("Metal", 6.5, 0.12, 0.12, 0.0, 4.27, MZ, b=0.02)
    for y in (5.2, 7.6):
        g.box("Metal", 6.2, 0.1, 0.1, 0.0, y, zf - 0.17, soft=True)
    bulbs(g, "Glass", (-MX, 4.15, MZ + 0.16), (MX, 4.15, MZ + 0.16), 8, sag=0.55, r=0.08)
    # ---- the cart: stainless cabinet on wheels, serving counter on brackets, a neon line round it
    g.box("Body", 6.8, 0.2, 2.2, 0.0, top, -0.15, soft=True, base=True)
    g.box("Metal", 7.0, 0.82, 2.4, 0.0, top + 0.2, -0.15, b=0.04, base=True)
    for px in (-2.61, -0.87, 0.87, 2.61):
        g.box("Metal", 1.56, 0.56, 0.05, px, 0.74, 1.055, b=0.03)
    for s in (-1, 1):
        for wz in (-1.0, 0.7):
            g.lathe(["Body", "Body", "Body", "Metal", "Metal"], [(0.0, -0.09), (0.19, -0.09), (0.24, -0.04), (0.24, 0.07), (0.12, 0.1), (0.0, 0.1)],
                    x=s * 3.46, y=0.37, z=wz, seg=10, rz=-90.0 * s)
    g.tube("NeonPink", [(-3.56, 0.5, -1.2), (-3.56, 0.5, 1.11), (3.56, 0.5, 1.11), (3.56, 0.5, -1.2)], 0.035, seg=4)
    g.box("Metal", 7.3, 0.07, 0.78, 0.0, 1.2, 1.37, b=0.025)
    for bx in (-2.9, -1.45, 0.0, 1.45, 2.9):
        g.prism("Body", [(0.0, 0.0), (0.6, 0.0), (0.0, -0.42)], 0.07, x=bx, y=1.165, z=1.06, ry=-90, soft=True)
    # ---- the frame: back posts, header with the name plate, low side panels, a lit menu on the back wall
    for s in (-1, 1):
        g.box("Body", 0.14, 1.42, 0.14, s * 3.42, 1.15, -1.27, b=0.025, base=True)
        g.beam("Body", (s * 3.42, 2.48, -1.27), (s * 3.42, 2.48, 1.5), 0.14, 0.14, soft=True)
        g.box("Metal", 0.07, 0.5, 2.25, s * 3.46, 1.15, -0.13, b=0.02, base=True)
    g.box("Body", 7.5, 0.6, 0.3, 0.0, 2.25, 1.65, b=0.04)
    sign_mount(g, sign, rim="Metal")
    g.box("Body", 7.0, 1.42, 0.1, 0.0, 1.15, -1.3, b=0.02, base=True)
    g.pane("Glass", 4.8, 0.46, -0.2, 2.14, -1.25, proud=0.04, c=0.03)
    for k in range(4):
        g.box("Body", 0.05, 0.5, 0.07, -2.0 + k * 1.2, 2.14, -1.21, soft=True)
    g.box("Metal", 6.4, 0.05, 0.3, 0.0, 1.74, -1.1, soft=True)
    for k, mat in enumerate(("Accent", "Lantern", "Cloth", "Accent", "Cloth", "Lantern", "Accent")):
        g.cyl(mat, 0.06, 0.2 + 0.05 * (k % 2), -2.4 + k * 0.72, 1.765, -1.1, seg=5, r2=0.04, b=0.0, soft=True)
    # ---- the vaulted tarp roof in the owner's colour, cream ribs, steel edge, a neon line along the front
    arch = [(-1.6, 2.55), (2.0, 2.55), (2.0, 2.63)] + [(2.0 - 3.6 * k / 8, 2.63 + 0.44 * math.sin(PI * k / 8)) for k in range(1, 8)] + [(-1.6, 2.63)]
    g.prism("Accent", arch, 7.8, ry=-90, b=0.05)
    rib = [(-1.62, 2.57), (2.02, 2.57), (2.02, 2.64)] + [(2.02 - 3.64 * k / 8, 2.645 + 0.455 * math.sin(PI * k / 8)) for k in range(1, 8)] + [(-1.62, 2.64)]
    for rx_ in (-2.6, -0.87, 0.87, 2.6):
        g.prism("Cloth", rib, 0.22, x=rx_, ry=-90)
    for rz in (2.0, -1.6):
        g.box("Metal", 7.9, 0.1, 0.1, 0.0, 2.59, rz, b=0.02)
    g.tube("NeonPink", [(-3.92, 2.69, 2.0), (3.92, 2.69, 2.0)], 0.035, seg=4)
    # ---- the red lantern on a bracket
    lx, lz = -2.75, 2.22
    g.beam("Body", (lx, 2.42, 1.8), (lx, 2.42, lz + 0.06), 0.06, 0.06, soft=True)
    g.tube("Body", [(lx, 2.42, lz), (lx, 2.27, lz)], 0.015, seg=3)
    g.lathe(["Body", "Body", "Lantern", "Lantern", "Lantern", "Lantern", "Lantern", "Body", "Body"],
            [(0.0, 1.53), (0.15, 1.53), (0.18, 1.6), (0.28, 1.68), (0.345, 1.84), (0.345, 1.98), (0.28, 2.14), (0.18, 2.22), (0.15, 2.28), (0.0, 2.28)],
            x=lx, z=lz, seg=12)
    g.cyl("Glass", 0.03, 0.24, lx, 1.28, lz, seg=4, b=0.0, soft=True)
    # ---- the cooking: stock pot, fish-cake pot with skewers, red rice-cake pan, steamer, kettle, steam
    y0 = 1.15
    g.box("Body", 5.0, 0.06, 0.62, -0.7, y0 + 0.03, 0.62, soft=True)
    g.lathe("Metal", [(0.0, 0.0), (0.28, 0.0), (0.3, 0.02), (0.3, 0.36), (0.31, 0.38), (0.16, 0.45), (0.05, 0.47), (0.05, 0.51), (0.0, 0.52)],
            x=-2.75, y=y0 + 0.06, z=0.62, seg=10)
    g.box("Metal", 0.86, 0.2, 0.5, -1.75, y0 + 0.16, 0.62, b=0.03)
    g.plate("Cloth", 0.74, 0.4, -1.75, y0 + 0.265, 0.62 + 0.2, 0)
    for k in range(5):
        sx = -2.05 + k * 0.15
        g.beam("Cloth", (sx, y0 + 0.24, 0.62), (sx + 0.05, y0 + 0.62, 0.5 + (k % 2) * 0.16), 0.026, 0.026, soft=True)
        g.box("Glass", 0.07, 0.12, 0.05, sx + 0.014, y0 + 0.36, 0.585 + (k % 2) * 0.05, soft=True)
    g.lathe(["Body", "Body", "Body", "Lantern", "Lantern"], [(0.0, 0.0), (0.36, 0.0), (0.38, 0.02), (0.38, 0.1), (0.33, 0.1), (0.0, 0.12)],
            x=-0.75, y=y0 + 0.06, z=0.62, seg=10)
    g.lathe(["Cloth", "Cloth", "Body", "Cloth", "Body", "Cloth", "Cloth", "Cloth"],
            [(0.0, 0.0), (0.3, 0.0), (0.3, 0.13), (0.31, 0.16), (0.3, 0.29), (0.31, 0.32), (0.24, 0.39), (0.06, 0.44), (0.0, 0.445)],
            x=0.3, y=y0 + 0.06, z=0.62, seg=10)
    g.lathe("Metal", [(0.0, 0.0), (0.16, 0.0), (0.2, 0.08), (0.2, 0.2), (0.12, 0.3), (0.05, 0.32), (0.05, 0.36), (0.0, 0.37)], x=1.25, y=y0 + 0.06, z=0.62, seg=8)
    g.beam("Metal", (1.4, y0 + 0.2, 0.62), (1.62, y0 + 0.34, 0.62), 0.045, 0.045, soft=True)
    for px, py, pr in ((-2.75, 1.86, 0.15), (-2.68, 2.1, 0.19), (-2.82, 2.32, 0.13), (0.3, 1.82, 0.14), (0.38, 2.04, 0.18), (0.26, 2.26, 0.12)):
        g.ball("Cloth", pr, px, py, 0.6, seg=6, rings=3)
    # ---- on the counter: plates of skewers, cups, a napkin box, bottles
    yc = 1.235
    for px in (-2.3, -0.5, 0.9):
        g.cyl("Cloth", 0.18, 0.03, px, yc, 1.42, seg=8, b=0.0, soft=True)
        for k in range(3):
            g.box("Glass", 0.04, 0.03, 0.26, px - 0.1 + k * 0.1, yc + 0.045, 1.43, soft=True)
    for k in range(3):
        g.cyl("Accent", 0.05, 0.11, -1.35 + k * 0.13, yc, 1.5, seg=5, r2=0.06, b=0.0, soft=True)
    g.box("Cloth", 0.26, 0.12, 0.16, 0.2, yc + 0.06, 1.5, soft=True)
    for k in range(3):
        g.lathe(["Accent", "Accent", "Metal", "Metal"], [(0.0, 0.0), (0.045, 0.0), (0.045, 0.16), (0.02, 0.19), (0.0, 0.26)],
                x=1.75 + k * 0.12, y=yc, z=1.45 + (k % 2) * 0.1, seg=5, soft=True)
    # ---- stools, the gas bottle, the flue, a folding menu
    for sx in (-2.3, -0.7, 0.9):
        g.lathe(["Metal", "Metal", "Metal", "Metal", "Accent", "Accent", "Accent"],
                [(0.0, 0.0), (0.17, 0.0), (0.17, 0.035), (0.035, 0.05), (0.035, 0.38), (0.2, 0.39), (0.21, 0.47), (0.0, 0.49)],
                x=sx, y=top, z=2.75, seg=8)
    g.lathe(["Metal", "Metal", "Metal", "Body", "Metal", "Metal", "Metal", "Lantern", "Lantern"],
            [(0.0, 0.0), (0.15, 0.0), (0.18, 0.04), (0.18, 0.28), (0.18, 0.33), (0.18, 0.62), (0.13, 0.74), (0.06, 0.78), (0.05, 0.9), (0.0, 0.91)],
            x=3.93, y=top, z=-0.95, seg=8)
    g.cyl("Metal", 0.11, 2.6, -2.95, y0, -0.95, seg=8, b=0.0)
    g.lathe("Metal", [(0.0, 0.0), (0.24, 0.0), (0.24, 0.03), (0.0, 0.2)], x=-2.95, y=3.82, z=-0.95, seg=8)
    for px, py, pr in ((-2.92, 4.2, 0.15), (-2.82, 4.48, 0.2)):
        g.ball("Cloth", pr, px, py, -0.95, seg=6, rings=3)
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
                [(0.0, 0.78), (0.86, 0.78), (0.86, 0.86), (0.76, 0.86), (0.76, 1.04), (0.775, 1.09), (0.76, 1.4), (0.775, 1.45), (0.76, 1.74), (0.775, 1.79),
                 (0.76, 1.96), (0.86, 1.96), (0.86, 2.0), (0.08, 2.46), (0.0, 2.48)], seg=12)
        g.ball("NeonGold", 0.07, 0.0, 2.54, 0.0, seg=5, rings=3)
    g.box("Trim", 1.7, 0.14, 1.2, 0.2, Y2, -0.45, b=0.03, base=True)                 # skylight
    g.lid("Glass", -0.55, 0.95, -0.95, 0.05, Y2 + 0.14, Y2 + 0.21, 0.05)
    g.box("Trim", 1.0, 0.6, 0.7, 0.3, Y2, -2.5, b=0.04, base=True)                   # air conditioner
    g.cyl("Body", 0.24, 0.04, 0.3, Y2 + 0.6, -2.5, seg=8, b=0.0, soft=True)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(6000, 150))

# ====================================================================================================== lot 4: the tower
def lot4_tower():
    board = dict(x=0.0, y=12.6, z=3.55, w=12.6, h=7.1)
    sign = dict(x=0.0, y=16.3, z=1.2, w=6.2, h=0.9)
    g = Geo("Lot")
    pad(g, pavers=False)
    top = PAD_TOP
    zf = board["z"] - BOARD_BACK
    HX, ZB, ZF = 3.6, -2.85, zf - 0.12 - 0.12   # shaft: half width, back face, front face (rails carry the plate off it)
    Y1, Y2 = 2.9, 15.8                          # top of the podium, roof of the shaft
    # ---- podium: two lit storeys, the entrance under a canopy in the owner's colour
    g.box("Body", 7.9, Y1 - top, 6.3, 0.0, top, -0.05, b=0.06, base=True)
    g.box("Trim", 8.02, 0.36, 6.42, 0.0, top, -0.05, b=0.05, base=True)
    g.box("Trim", 8.1, 0.24, 6.5, 0.0, Y1 - 0.12, -0.05, b=0.05)
    pz = 3.1
    g.pane("Glass", 2.7, 2.0, 0.0, top + 1.36, pz, proud=0.04, c=0.02)
    for mx in (-1.39, -0.46, 0.46, 1.39):
        g.box("Trim", 0.08, 2.0, 0.12, mx, top + 0.36, pz + 0.03, soft=True, base=True)
    g.box("Trim", 2.9, 0.1, 0.14, 0.0, top + 2.4, pz + 0.03, b=0.02)
    g.box("Trim", 2.78, 0.06, 0.11, 0.0, top + 1.75, pz + 0.03, soft=True)
    g.box("Accent", 3.7, 0.16, 1.15, 0.0, 2.52, pz + 0.55, b=0.05)
    g.tube("NeonGold", [(-1.9, 2.42, pz + 0.02), (-1.9, 2.42, pz + 1.16), (1.9, 2.42, pz + 1.16), (1.9, 2.42, pz + 0.02)], 0.035, seg=4)
    for s in (-1, 1):
        g.beam("Trim", (s * 1.6, 2.6, pz + 1.0), (s * 1.6, 2.86, pz + 0.04), 0.05, 0.05, soft=True)
        window(g, s * 2.75, 1.5, pz, 1.5, 1.5, 0, sill=False)
        g.box("Trim", 0.42, Y1 - top - 0.2, 0.2, s * 3.72, top, pz + 0.04, b=0.04, base=True)
        g.box("Trim", 0.3, Y1 - top - 0.2, 0.16, s * 1.72, top, pz + 0.03, b=0.03, base=True)
        for wz in (-1.95, 0.0, 1.95):
            window(g, s * 3.95, 1.5, wz - 0.05, 1.3, 1.5, s * 90, sill=False)
        g.lathe(["Body", "Body", "Body", "NeonCyan", "NeonCyan"], [(0.0, 0.0), (0.11, 0.0), (0.1, 0.58), (0.11, 0.6), (0.09, 0.73), (0.0, 0.77)],
                x=s * 2.4, y=top, z=3.55, seg=6)
    for wx in (-2.4, 0.0, 2.4):
        window(g, wx, 1.5, -3.2, 1.3, 1.5, 180, sill=False)
    g.box("Trim", 3.4, 0.1, 0.7, 0.0, top, 3.45, b=0.03, base=True)
    g.tube("NeonPink", [(-4.09, Y1 + 0.05, -3.34), (-4.09, Y1 + 0.05, 3.24), (4.09, Y1 + 0.05, 3.24), (4.09, Y1 + 0.05, -3.34)], 0.04, seg=4, closed=True)
    # ---- the shaft: dark walls, corner piers and fins, a grid of windows (most lit warm, some dark, a few in colour)
    ZC = (ZF + ZB) / 2
    g.box("Body", 2 * HX, Y2 - Y1, ZF - ZB, 0.0, Y1, ZC, b=0.05, base=True)
    for sx in (-1, 1):
        for z in (ZB + 0.1, ZF - 0.1):
            g.box("Trim", 0.36, Y2 - Y1, 0.36, sx * (HX - 0.1), Y1, z, b=0.05, base=True)
    g.box("Trim", 2 * HX + 0.16, 0.18, ZF - ZB + 0.16, 0.0, 8.68, ZC, b=0.03)
    g.box("Trim", 2 * HX + 0.3, 0.24, ZF - ZB + 0.3, 0.0, Y2, ZC, b=0.04)
    rng = random.Random(7)
    def pane():
        r = rng.random()
        return "Glass" if r < 0.52 else "GlassDark" if r < 0.82 else "NeonCyan" if r < 0.91 else "NeonPink"
    rows_low = [3.78 + 1.22 * k for k in range(4)]
    rows_all = [3.78 + 1.22 * k for k in range(10)]
    for x in (-2.4, -0.8, 0.8, 2.4):
        for y in rows_low:
            g.pane(pane(), 1.2, 0.84, x, y, ZF, 0, proud=0.03, c=0.03)
        for y in rows_all:
            g.pane(pane(), 1.2, 0.84, x, y, ZB, 180, proud=0.03, c=0.03)
    side_z = [ZC - 1.83, ZC, ZC + 1.83]
    for sx in (-1, 1):
        for z in side_z:
            for y in rows_all:
                g.pane(pane(), 1.34, 0.84, sx * HX, y, z, sx * 90, proud=0.03, c=0.03)
        for z in (ZC - 0.915, ZC + 0.915):
            g.box("Trim", 0.12, Y2 - Y1, 0.16, sx * (HX + 0.03), Y1, z, b=0.025, base=True)
    for x in (-1.6, 0.0, 1.6):
        g.box("Trim", 0.14, 8.6 - Y1, 0.12, x, Y1, ZF + 0.03, b=0.025, base=True)
        g.box("Trim", 0.14, Y2 - Y1, 0.12, x, Y1, ZB - 0.03, b=0.025, base=True)
    for sx in (-1, 1):                                                              # cyan lines up the corners
        g.tube("NeonCyan", [(sx * (HX + 0.12), Y1 + 0.2, ZB - 0.12), (sx * (HX + 0.12), Y2 - 0.2, ZB - 0.12)], 0.04, seg=4)
        g.tube("NeonCyan", [(sx * (HX + 0.12), Y1 + 0.2, ZF + 0.12), (sx * (HX + 0.12), 8.5, ZF + 0.12)], 0.04, seg=4)
    # ---- the big board: wider than the shaft, on rails, its wings carried by outriggers
    board_mount(g, board, neon="NeonGold", rim="Trim")
    for rx_ in (-3.0, -1.0, 1.0, 3.0):
        g.box("Trim", 0.22, 7.3, 0.12, rx_, board["y"], zf - 0.18, soft=True)
    for sx in (-1, 1):
        g.box("Trim", 0.2, 7.3, 0.2, sx * 6.3, board["y"], zf - 0.22, b=0.03)
        for y in (9.4, 12.6, 15.75):
            g.beam("Trim", (sx * 3.5, y, zf - 0.22), (sx * 6.4, y, zf - 0.22), 0.2, 0.2)
            g.beam("Trim", (sx * 6.25, y, zf - 0.3), (sx * (HX + 0.02), y, ZC + 0.6), 0.12, 0.12)
    # ---- the top: a terrace behind the board, the crown with the name plate on its face, tiers, a spire
    CZ = -0.75
    g.box("Body", 6.6, 1.25, 3.7, 0.0, Y2 + 0.1, CZ, b=0.05, base=True)
    sign_mount(g, sign, rim="Trim")
    g.box("Accent", 6.9, 0.2, 4.0, 0.0, Y2 + 1.35, CZ, b=0.05, base=True)
    g.box("Body", 5.2, 0.6, 2.8, 0.0, Y2 + 1.55, CZ, b=0.05, base=True)
    g.tube("NeonGold", [(-2.68, Y2 + 2.17, CZ - 1.48), (-2.68, Y2 + 2.17, CZ + 1.48), (2.68, Y2 + 2.17, CZ + 1.48), (2.68, Y2 + 2.17, CZ - 1.48)], 0.04, seg=4, closed=True)
    g.box("Trim", 3.2, 0.4, 1.7, 0.0, Y2 + 2.15, CZ, b=0.05, base=True)
    g.lathe("Trim", [(0.0, 0.0), (0.24, 0.0), (0.2, 0.08), (0.09, 0.26), (0.05, 0.5), (0.0, 0.52)], y=Y2 + 2.55, z=CZ, seg=8)
    g.ball("NeonPink", 0.09, 0.0, Y2 + 3.11, CZ, seg=6, rings=3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box("Trim", 0.3, 0.75, 0.3, sx * 3.1, Y2 + 1.55, CZ + sz * 1.65, b=0.04, base=True)
            g.ball("NeonGold", 0.1, sx * 3.1, Y2 + 2.4, CZ + sz * 1.65, seg=6, rings=3)
        g.box("Trim", 1.0, 0.5, 0.8, sx * 2.3, Y2 + 0.1, 2.1, b=0.04, base=True)
    return dict(geos=[g], anchors=dict(BoardAnchor=board, SignAnchor=sign), budget=(8000, 150))

# ====================================================================================================== main
ASSETS = {
    "lot0_empty": lot0_empty,
    "lot1_tent": lot1_tent,
    "lot2_pocha": lot2_pocha,
    "lot3_shop": lot3_shop,
    "lot4_tower": lot4_tower,
}

def build(name):
    new_scene()
    spec = ASSETS[name]()
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
