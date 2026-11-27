"""A board wrapped round a building corner (plate 6): the two-face geometry, a camera for the
anamorphic pop-out, and the pop-out itself (a gift box that comes out of the corner, opens, and
throws confetti toward the viewer).

World units: the fold (the vertical corner edge) is the Y axis, its bottom is the origin and its
height is 1. The right face is the plane Z = 0 (X from 0 to wR), the left face is X = 0 (Z from 0
to wL); the building is X > 0, Z > 0 and the viewer is in front (X < 0, Z < 0). The camera is a
3x4 DLT fit to the six face corners, so the box lines up with the faces in this shot.

The pop-out is drawn in the camera's view (that is what makes it anamorphic) and then pulled back
into each face's texture, so it goes through the same LED grid and warp as the card.
"""
import math

import cv2
import numpy as np

import track as trk

PINK = np.array([0xff, 0x4f, 0xa3]) / 255.0
PINK_D = np.array([0xd9, 0x2f, 0x85]) / 255.0
GOLD = np.array([0xff, 0xe0, 0x8a]) / 255.0
CONF = [np.array(c) / 255.0 for c in ((0xff, 0xe0, 0x8a), (255, 255, 255), (0xff, 0x4f, 0xa3), (255, 209, 234),
                                      (185, 246, 255), (255, 170, 90), (190, 150, 255))]


def smooth01(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def ease_out_back(t, s=1.70158):
    t = min(max(t, 0.0), 1.0) - 1
    return t * t * ((s + 1) * t + s) + 1


def median_frame(path, step=20):
    cap = cv2.VideoCapture(path)
    fs, i = [], 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % step == 0:
            fs.append(f)
        i += 1
    cap.release()
    return np.median(np.stack(fs), 0).astype(np.uint8), i


class CornerGeometry:
    """Faces, real widths and the camera, from the clip's median frame (the shot is locked off)."""

    def __init__(self, path):
        med, self.n = median_frame(path)
        d = trk.green_diff(med)
        self.left, self.right, self.info = trk.detect_corner(d)
        L, R = self.left, self.right
        # widths in fold heights: the camera fit below needs them; measure them from vanishing points
        # where possible (both faces' top edges meet the shared bottom line), else image proportions
        self.wL, self.wR = self._widths(L, R, med.shape)
        W = np.array([[0, 1, 0], [self.wR, 1, 0], [self.wR, 0, 0], [0, 0, 0], [0, 1, self.wL], [0, 0, self.wL]], float)
        I = np.array([L[1], R[1], R[2], L[2], L[0], L[3]])
        A = []
        for (X, Y, Z), (u, v) in zip(W, I):
            A.append([X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z, -u])
            A.append([0, 0, 0, 0, X, Y, Z, 1, -v * X, -v * Y, -v * Z, -v])
        P = np.linalg.svd(np.array(A))[2][-1].reshape(3, 4)
        if (P @ np.r_[0.0, 0.5, 0.0, 1.0])[2] < 0:
            P = -P
        self.P = P
        c = np.linalg.svd(P)[2][-1]
        self.C = c[:3] / c[3]
        self.reproj = float(max(np.linalg.norm(self.project(w)[0] - i) for w, i in zip(W, I)))
        self.split = self.wL / (self.wL + self.wR)   # texture fraction on the left face
        self.aspect = self.wL + self.wR              # texture w/h (fold height = 1)

    def _widths(self, L, R, shape):
        li = self.info['lines']
        ln = lambda k: (np.array(li[k][0]), np.array(li[k][1]))
        try:
            vX = trk.line_intersect(ln('top_r'), ln('bottom'))
            vZ = trk.line_intersect(ln('top_l'), ln('bottom'))
            c = np.array([shape[1] / 2, shape[0] / 2])
            f2 = -np.dot(vX - c, vZ - c)
            if f2 <= 0:
                raise ValueError
            f = math.sqrt(f2)
            K = np.array([[f, 0, c[0]], [0, f, c[1]], [0, 0, 1]])
            Ki = np.linalg.inv(K)
            dX = Ki @ np.r_[vX, 1]
            dX /= np.linalg.norm(dX)
            dZ = Ki @ np.r_[vZ, 1]
            dZ /= np.linalg.norm(dZ)
            dY = np.cross(dX, dZ)
            dY /= np.linalg.norm(dY)
            if dY[1] > 0:
                dY = -dY
            T = Ki @ np.r_[L[2], 1]

            def solve(img, cols):
                A, b = [], []
                for row in (0, 1):
                    uu, cc = img[row], c[row]
                    A.append([(uu - cc) * col[2] - f * col[row] for col in cols])
                    b.append(f * T[row] - (uu - cc) * T[2])
                return np.linalg.lstsq(np.array(A), np.array(b), rcond=None)[0]

            h = solve(L[1], [dY])[0]
            T = T / h
            wR = np.mean([solve(R[1], [dX, dY])[0], solve(R[2], [dX, dY])[0]])
            wL = np.mean([solve(L[0], [dZ, dY])[0], solve(L[3], [dZ, dY])[0]])
            if not (0.1 < wR < 3 and 0.1 < wL < 3):
                raise ValueError
            return float(wL), float(wR)
        except (ValueError, np.linalg.LinAlgError):
            hgt = np.linalg.norm(L[1] - L[2])
            return float(np.linalg.norm(L[1] - L[0]) / hgt), float(np.linalg.norm(R[1] - R[0]) / hgt)

    def project(self, w):
        w = np.atleast_2d(np.asarray(w, float))
        q = (self.P @ np.c_[w, np.ones(len(w))].T).T
        return q[:, :2] / q[:, 2:3], q[:, 2]

    def face_quads(self):
        return self.left, self.right


# ------------------------------------------------------------------ the pop-out
def _rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _rot_axis(axis, a):
    axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


class GiftPop:
    """Timeline (s): 1.55 the box pushes out of the corner (from inside the building to in front of it),
    2.6 the lid flips open, 2.7-4.6 confetti streams out toward the viewer, then a slow bob and sway."""

    def __init__(self, geo, seed=3, size=0.11, y0=0.07):
        self.g = geo
        self.size = size
        self.y0 = y0
        rng = np.random.default_rng(seed)
        n = 150
        t0 = 2.68 + np.concatenate([rng.exponential(0.12, 100), rng.uniform(0.4, 2.0, n - 100)])
        out = np.array([-1.0, 0.0, -1.0]) / math.sqrt(2)
        v = (out[None, :] * rng.uniform(0.25, 0.75, (n, 1)) + np.array([0, 1, 0])[None, :] * rng.uniform(0.55, 1.05, (n, 1))
             + rng.normal(0, 0.18, (n, 3)))
        self.conf = dict(t0=t0, v=v, size=rng.uniform(0.008, 0.015, n), col=rng.integers(0, len(CONF), n),
                         rot=rng.uniform(0, 6.28, n), vr=rng.uniform(-8, 8, n), axis=rng.normal(0, 1, (n, 3)),
                         life=rng.uniform(1.6, 2.6, n), kind=rng.integers(0, 2, n))
        self.light = np.array([-0.45, 0.75, -0.85]) / np.linalg.norm([-0.45, 0.75, -0.85])  # toward the light

    def state(self, t):
        p = (t - 1.58) / 0.75
        if p <= 0:
            return None
        e = ease_out_back(p, 1.4)
        dist = -0.22 + 0.27 * e                      # along the outward diagonal, in fold heights
        scale = 0.55 + 0.45 * min(1.0, p * 1.3)
        yaw = 0.9 * (1 - smooth01(p)) + 0.16 * math.sin(2 * math.pi * (t - 1.6) / 5.0) * smooth01((t - 2.2) / 1.0)
        bob = 0.012 * math.sin(2 * math.pi * (t - 2.3) / 2.4) * smooth01((t - 2.3) / 0.8)
        lid = math.radians(118) * ease_out_back((t - 2.55) / 0.42, 2.0)
        out = np.array([-1.0, 0.0, -1.0]) / math.sqrt(2)
        s = self.size * scale
        c = np.array([0.0, self.y0 + s / 2 + bob, 0.0]) + out * dist
        return dict(c=c, s=s, yaw=yaw + math.pi / 4, lid=lid)

    def _box_faces(self, st):
        """World polygons (list of (pts (k,3), rgb, normal)) of the box, the ribbon and the lid."""
        c, s, R = st['c'], st['s'], _rot_y(st['yaw'])
        h = s / 2
        polys = []

        def P(x, y, z):
            return c + R @ np.array([x, y, z])

        def quad(a, b, cc, d, col, ribbon=True):
            pts = np.array([a, b, cc, d])
            n = np.cross(pts[3] - pts[0], pts[1] - pts[0])  # outward for the corner order used below
            n /= np.linalg.norm(n) + 1e-12
            polys.append((pts, col, n, 0))
            if ribbon:  # a band down the middle of the face, a hair in front of it
                u0, u1 = 0.42, 0.58
                lerp = lambda p, q, k: p + (q - p) * k
                r = np.array([lerp(a, b, u0), lerp(a, b, u1), lerp(d, cc, u1), lerp(d, cc, u0)]) + n * s * 0.004
                polys.append((r, GOLD, n, 1))

        bh = h * 0.86  # body height (the lid sits on top)
        top_y = -h + 2 * bh
        # body: 4 sides + bottom (outward normals)
        quad(P(-h, -h, -h), P(h, -h, -h), P(h, top_y, -h), P(-h, top_y, -h), PINK)
        quad(P(h, -h, -h), P(h, -h, h), P(h, top_y, h), P(h, top_y, -h), PINK)
        quad(P(h, -h, h), P(-h, -h, h), P(-h, top_y, h), P(h, top_y, h), PINK)
        quad(P(-h, -h, h), P(-h, -h, -h), P(-h, top_y, -h), P(-h, top_y, h), PINK)
        quad(P(-h, -h, h), P(h, -h, h), P(h, -h, -h), P(-h, -h, -h), PINK_D)
        # the inside of the box shows once the lid is open
        quad(P(-h, top_y, -h), P(h, top_y, -h), P(h, top_y, h), P(-h, top_y, h), PINK_D * 0.45, ribbon=False)
        # lid: hinged on the back edge (+z in box space, away from the viewer)
        lr = h * 1.06
        lt = h * 0.28
        hinge = P(0, top_y, lr)
        ax = R @ np.array([1.0, 0, 0])
        Rl = _rot_axis(ax, st['lid'])

        def L(x, y, z):
            p = P(x, top_y + y, z)
            return hinge + Rl @ (p - hinge)

        quad(L(-lr, 0, -lr), L(lr, 0, -lr), L(lr, lt, -lr), L(-lr, lt, -lr), PINK)
        quad(L(lr, 0, -lr), L(lr, 0, lr), L(lr, lt, lr), L(lr, lt, -lr), PINK)
        quad(L(lr, 0, lr), L(-lr, 0, lr), L(-lr, lt, lr), L(lr, lt, lr), PINK)
        quad(L(-lr, 0, lr), L(-lr, 0, -lr), L(-lr, lt, -lr), L(-lr, lt, lr), PINK)
        quad(L(-lr, lt, -lr), L(lr, lt, -lr), L(lr, lt, lr), L(-lr, lt, lr), PINK)
        quad(L(-lr, 0, lr), L(lr, 0, lr), L(lr, 0, -lr), L(-lr, 0, -lr), PINK_D, ribbon=False)
        # a cross ribbon on the lid top
        k0, k1 = 0.16, 0.16
        n_top = Rl @ (R @ np.array([0, 1.0, 0]))
        off = n_top * s * 0.005
        polys.append((np.array([L(-lr, lt, -lr * k0), L(lr, lt, -lr * k0), L(lr, lt, lr * k0), L(-lr, lt, lr * k0)]) + off,
                      GOLD, n_top, 2))
        polys.append((np.array([L(-lr * k1, lt, -lr), L(lr * k1, lt, -lr), L(lr * k1, lt, lr), L(-lr * k1, lt, lr)]) + off,
                      GOLD, n_top, 2))
        return polys

    def render(self, t, x0, y0, w, h, ss=2):
        """Image-space layers for the ROI (x0, y0, w, h): premultiplied linear RGB, alpha, and a shadow
        multiplier for the faces behind. Returns None when there is nothing to draw."""
        st = self.state(t)
        if st is None:
            return None
        g = self.g
        W2, H2 = w * ss, h * ss
        rgb = np.zeros((H2, W2, 3), np.float32)
        al = np.zeros((H2, W2), np.float32)
        shadow = np.zeros((H2, W2), np.float32)

        def to_px(pts2):
            return np.round(((pts2 - [x0, y0]) * ss + (ss - 1) / 2) * (1 << 4)).astype(np.int32)

        lin = lambda c: np.clip(c, 0, 1) ** 2.2

        # soft shadow of the box on the two faces (projected along the light onto Z=0 and X=0)
        if st['c'][0] < 0:
            corners = []
            c, s, R = st['c'], st['s'], _rot_y(st['yaw'])
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        corners.append(c + R @ (np.array([sx, sy, sz]) * s / 2))
            corners = np.array(corners)
            for coord in (2, 0):                   # plane Z=0 (right face), then X=0 (left face)
                kk = -corners[:, coord] / self.light[coord]
                proj = corners + kk[:, None] * self.light[None, :]
                keep = proj[:, 0 if coord == 2 else 2] >= -1e-6
                if keep.sum() < 3:
                    continue
                img, _ = g.project(proj[keep])
                hull = cv2.convexHull(np.float32(img))
                cv2.fillConvexPoly(shadow, to_px(hull.reshape(-1, 2)), 1.0, cv2.LINE_AA, 4)
            shadow = cv2.GaussianBlur(shadow, (0, 0), 10 * ss) * 0.45 * min(1.0, (t - 1.7) / 0.5)

        # gather drawables: box polygons and confetti, painter-sorted by distance to the camera
        items = []
        for pts, col, n, layer in self._box_faces(st):
            fc = pts.mean(0)
            if np.dot(n, g.C - fc) <= 0:
                continue
            shade = 0.55 + 0.45 * max(0.0, float(np.dot(n, self.light)))
            items.append((np.linalg.norm(fc - g.C) - layer * 1e-4, pts, col * shade))
        cf = self.conf
        tc = t - cf['t0']
        for k in np.nonzero((tc > 0) & (tc < cf['life']))[0]:
            tt = tc[k]
            drag = 1.4
            kk = (1 - math.exp(-drag * tt)) / drag
            pos = st['c'] + np.array([0, st['s'] * 0.4, 0]) + cf['v'][k] * kk + np.array([0, -0.55, 0]) * (tt - kk) / drag
            ax = cf['axis'][k]
            Rk = _rot_axis(ax, cf['rot'][k] + cf['vr'][k] * tt)
            sz = cf['size'][k]
            if cf['kind'][k]:
                corners = np.array([[-1.3, -0.45, 0], [1.3, -0.45, 0], [1.3, 0.45, 0], [-1.3, 0.45, 0]]) * sz
            else:
                corners = np.array([[-0.7, -0.7, 0], [0.7, -0.7, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0]]) * sz
            pts = pos + (Rk @ corners.T).T
            n = Rk @ np.array([0, 0, 1.0])
            shade = 0.6 + 0.4 * abs(float(np.dot(n, self.light)))
            fade = 1 - smooth01((tt - cf['life'][k] + 0.4) / 0.4)
            items.append((np.linalg.norm(pos - g.C), pts, CONF[cf['col'][k]] * shade * (0.3 + 0.7 * fade)))
        items.sort(key=lambda it: -it[0])
        for _, pts, col in items:
            img, z = g.project(pts)
            if (z <= 0).any():
                continue
            poly = to_px(img)
            bx0, by0 = np.maximum(poly.min(0) >> 4, 0) - 1
            bx1, by1 = (poly.max(0) >> 4) + 2
            bx0, by0, bx1, by1 = max(0, bx0), max(0, by0), min(W2, bx1), min(H2, by1)
            if bx1 <= bx0 or by1 <= by0:
                continue
            m = np.zeros((by1 - by0, bx1 - bx0), np.uint8)
            cv2.fillConvexPoly(m, poly - np.int32([bx0 << 4, by0 << 4]), 255, cv2.LINE_AA, 4)
            a = (m.astype(np.float32) / 255.0)[..., None]
            cl = lin(col).astype(np.float32)[::-1]  # BGR order
            rgb[by0:by1, bx0:bx1] = rgb[by0:by1, bx0:bx1] * (1 - a) + cl * a
            al[by0:by1, bx0:bx1] = al[by0:by1, bx0:bx1] * (1 - a[..., 0]) + a[..., 0]
        if ss > 1:
            rgb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA)
            al = cv2.resize(al, (w, h), interpolation=cv2.INTER_AREA)
            shadow = cv2.resize(shadow, (w, h), interpolation=cv2.INTER_AREA)
        return rgb, al, shadow
