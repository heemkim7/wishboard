"""Corner tracking for a chroma-green screen in a plate video.

Per frame: green-difference key -> largest connected component -> rough quad
(convex hull + approxPolyDP) -> sub-pixel edge samples along each side (the
50% crossing of the key across the edge normal) -> robust line fit per side ->
corners from line intersections. Then a zero-phase temporal smoother over the
whole clip (offline, so no lag).

Corner order everywhere: top-left, top-right, bottom-right, bottom-left (x, y)
in source-frame pixels.
"""
import cv2
import numpy as np

# Where the edge is taken across the key ramp (0 = outside, 1 = inside). High on
# purpose: AI plates light the bezel lip green, and a 50% cut drifts onto that lip.
LEVEL_FRAC = 0.8


def green_diff(bgr):
    """G - max(R, B) as float32 (the key signal)."""
    f = bgr.astype(np.float32)
    return f[..., 1] - np.maximum(f[..., 0], f[..., 2])


def largest_green(d, thr):
    m = (d > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n < 2:
        return None
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    return (lab == i).astype(np.uint8)


def order_quad(pts):
    pts = np.asarray(pts, np.float64).reshape(4, 2)
    c = pts.mean(0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]  # clockwise in image coords, starting near -pi (left)
    # rotate so the first is top-left (min x+y)
    k = int(np.argmin(pts.sum(1)))
    return np.roll(pts, -k, axis=0)


def rough_quad(mask):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.005, 0.1, 60):
        ap = cv2.approxPolyDP(hull, eps * peri, True)
        if len(ap) == 4:
            return order_quad(ap.reshape(4, 2))
    # fallback: min-area rectangle
    return order_quad(cv2.boxPoints(cv2.minAreaRect(c)))


def line_intersect(l1, l2):
    # lines as (point, direction)
    p, r = l1
    q, s = l2
    m = np.array([[r[0], -s[0]], [r[1], -s[1]]])
    t = np.linalg.solve(m, q - p)
    return p + t[0] * r


def edge_line(d, a, b, c, inner_level, n_samples=80, reach=7.0, trim=0.08):
    """Sub-pixel line along the key edge near segment a-b (c: a point inside the screen).
    Returns ((point, direction), median residual) or (None, nan) when the edge has no key step
    (for example the fold between two faces of one green blob)."""
    tvec = b - a
    L = np.linalg.norm(tvec)
    tdir = tvec / L
    nrm = np.array([-tdir[1], tdir[0]])
    if np.dot(c - (a + b) / 2, nrm) > 0:  # make normal point outward
        nrm = -nrm
    ts = np.linspace(trim, 1 - trim, n_samples)
    offs = np.linspace(-reach, reach, int(reach * 8) + 1)
    base = a[None, :] + ts[:, None] * tvec[None, :]
    P = base[:, None, :] + offs[None, :, None] * nrm[None, None, :]
    mx = P[..., 0].astype(np.float32)
    my = P[..., 1].astype(np.float32)
    prof = cv2.remap(d, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    pts = []
    for j in range(n_samples):
        pr = prof[j]
        lo = np.median(pr[-6:])  # outside
        hi = max(np.median(pr[:6]), inner_level * 0.8)
        lvl = lo + LEVEL_FRAC * (hi - lo)
        if hi - lo < 40:
            continue
        # first crossing from inside going outward
        above = pr >= lvl
        k = np.where(above[:-1] & ~above[1:])[0]
        if len(k) == 0:
            continue
        k = k[0]
        f = (pr[k] - lvl) / max(pr[k] - pr[k + 1], 1e-6)
        off = offs[k] + f * (offs[k + 1] - offs[k])
        pts.append(base[j] + off * nrm)
    pts = np.array(pts, np.float32)
    if len(pts) < 10:
        return None, np.nan
    vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    dist = np.abs((pts[:, 0] - x0) * vy - (pts[:, 1] - y0) * vx)
    return (np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)), float(np.median(dist))


def refine_quad(d, quad, inner_level, n_samples=80, reach=7.0, trim=0.08):
    """Sub-pixel refinement: sample the key across each side's normal and fit lines
    through the 50% crossings."""
    lines = []
    resid = []
    c = quad.mean(0)
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        line, r = edge_line(d, a, b, c, inner_level, n_samples, reach, trim)
        if line is None:
            line = (a, (b - a) / np.linalg.norm(b - a))
        lines.append(line)
        resid.append(r)
    out = np.array([line_intersect(lines[(i - 1) % 4], lines[i]) for i in range(4)])
    return out, resid


def green_components(d, thr):
    """Masks of the green blobs above thr, largest first."""
    m = (d > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    order = 1 + np.argsort(-st[1:, cv2.CC_STAT_AREA])
    return [(lab == i).astype(np.uint8) for i in order]


def detect_rank(bgr, rank=0):
    """Like detect(), for the rank-th largest green screen (0 = the biggest). For plates with two
    screens (a billboard and a phone held up in front of it)."""
    d = green_diff(bgr)
    comps = green_components(d, 60)
    if len(comps) <= rank:
        return None, None
    m0 = comps[rank]
    inner = cv2.erode(m0, np.ones((9, 9), np.uint8)) > 0
    level = float(np.median(d[inner])) if inner.any() else 200.0
    cy, cx = np.argwhere(m0).mean(0)
    m = None
    for c in green_components(d, 0.75 * level):
        if c[int(cy), int(cx)] or (m is None and (c & m0).sum() > 0.5 * m0.sum()):
            m = c
            break
    if m is None:
        m = m0
    q = rough_quad(m)
    for _ in range(2):
        q, res = refine_quad(d, q, level)
    return q, {'level': level, 'resid': res, 'area': int(m.sum())}


def track_video_rank(path, rank):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    raw, info = [], []
    prev = None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        q, inf = detect_rank(f, rank)
        if q is None:
            q = prev
        raw.append(q)
        info.append(inf)
        prev = q
    cap.release()
    return fps, (W, H), np.array(raw, np.float64), info


def detect_corner(d):
    """A screen wrapped round a building corner: one green blob, two faces meeting at a vertical fold
    that is the top apex of the blob. Returns (left face quad, right face quad, info); each quad is
    TL, TR, BR, BL and the two share the fold corners (left TR/BR = right TL/BL)."""
    m0 = largest_green(d, 60)
    inner = cv2.erode(m0, np.ones((9, 9), np.uint8)) > 0
    level = float(np.median(d[inner]))
    m = largest_green(d, 0.75 * level)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(max(cs, key=cv2.contourArea)).reshape(-1, 2).astype(np.float64)
    apex = hull[np.argmin(hull[:, 1])]
    tl = hull[np.argmin(hull[:, 0] + 0.15 * hull[:, 1])]       # outer top of the left face
    tr = hull[np.argmax(hull[:, 0] - 0.15 * hull[:, 1])]       # outer top of the right face
    bl = hull[np.argmin(hull[:, 0] - hull[:, 1])]              # bottom left
    br = hull[np.argmax(hull[:, 0] + hull[:, 1])]              # bottom right
    c = hull.mean(0)
    lines = {}
    for k, (a, b) in dict(top_l=(tl, apex), top_r=(apex, tr), right=(tr, br), bottom=(br, bl), left=(bl, tl)).items():
        line, r = edge_line(d, a, b, c, level, n_samples=120, trim=0.1)
        if line is None:
            line = (a, (b - a) / np.linalg.norm(b - a))
        lines[k] = line
    apex = line_intersect(lines['top_l'], lines['top_r'])
    TL = line_intersect(lines['left'], lines['top_l'])
    TR = line_intersect(lines['top_r'], lines['right'])
    BR = line_intersect(lines['right'], lines['bottom'])
    BL = line_intersect(lines['bottom'], lines['left'])
    # the fold: the vertical shading step between the faces (they face the light differently)
    G = cv2.GaussianBlur(d, (0, 0), 2)
    xs, ys = [], []
    for y in np.linspace(apex[1] + 40, BL[1] - 40, 60):
        yi = int(y)
        row = G[yi]
        x0 = int(apex[0]) - 60
        seg = np.abs(np.diff(row[x0:x0 + 120]))
        if seg.max() > 1.5:
            xs.append(x0 + int(np.argmax(seg)) + 0.5)
            ys.append(y)
    fold_dir = np.array([0.0, 1.0])
    if len(xs) >= 8:
        vx, vy, x0, y0 = cv2.fitLine(np.float32(np.c_[xs, ys]), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        fold_dir = np.array([vx, vy]) if vy > 0 else -np.array([vx, vy])
    fold_bottom = line_intersect((apex, fold_dir), lines['bottom'])
    left = np.array([TL, apex, fold_bottom, BL])
    right = np.array([apex, TR, BR, fold_bottom])
    return left, right, {'level': level, 'fold_samples': len(xs), 'fold_dir': fold_dir.tolist(),
                         'lines': {k: (v[0].tolist(), v[1].tolist()) for k, v in lines.items()}}


def track_small(path, exclude, level, n_frames, min_area=14, max_area=8000, link=14.0, min_life=0.25, sigma=2.0):
    """Small green screens (phones held up in a crowd), tracked over the clip so every frame fills the
    same set: per-frame blobs -> nearest-neighbour links -> gaps interpolated -> corners smoothed.
    exclude(i) -> bool mask of areas that are not small screens (the big screen, the ground).
    Returns {track id: ((n, 4, 2) corners, NaN where the phone is not in the shot; (n,) bool, detected in
    that frame (False: interpolated across a gap, e.g. a hand in front))}."""
    cap = cv2.VideoCapture(path)
    dets = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        d = green_diff(f)
        strong = (d > 0.4 * level).astype(np.uint8)
        # phones filming the screen show a mottled green picture: close it into one blob
        strong = cv2.morphologyEx(strong, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        strong[exclude(i)] = 0
        n, lab, st, cen = cv2.connectedComponentsWithStats(strong, connectivity=8)
        cur = []
        for k in range(1, n):
            area = st[k, cv2.CC_STAT_AREA]
            if not (min_area <= area <= max_area):
                continue
            cs, _ = cv2.findContours((lab == k).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            rect = cv2.minAreaRect(cs[0])
            rw, rh = rect[1]
            if rw * rh <= 0 or area / (rw * rh) < 0.5:
                continue
            cur.append((cen[k], order_quad(cv2.boxPoints(rect))))
        dets.append(cur)
        i += 1
    cap.release()
    tracks = []  # each: dict frame -> quad
    for fi, cur in enumerate(dets):
        used = set()
        for tr in tracks:
            last_f = max(tr)
            gap = fi - last_f
            if gap > 60:  # a hand waved in front of the phone for up to 2.5 s
                continue
            lc = tr[last_f].mean(0)
            best, bd = None, link + 0.6 * (gap - 1)
            for k, (c, q) in enumerate(cur):
                if k in used:
                    continue
                dd = np.linalg.norm(c - lc)
                if dd < bd:
                    best, bd = k, dd
            if best is not None:
                tr[fi] = cur[best][1]
                used.add(best)
        for k, (c, q) in enumerate(cur):
            if k not in used:
                tracks.append({fi: q})
    out = {}
    nf = len(dets)
    for tid, tr in enumerate(tracks):
        if len(tr) < min_life * nf:
            continue
        fr = np.array(sorted(tr))
        Q = np.array([tr[f] for f in fr])
        arr = np.full((nf, 4, 2), np.nan)
        lo, hi = fr[0], fr[-1]
        span = np.arange(lo, hi + 1)
        for c in range(4):
            for xy in range(2):
                arr[lo:hi + 1, c, xy] = np.interp(span, fr, Q[:, c, xy])
        # hold the first/last seen corners to the clip ends when the phone is seen most of the time
        if len(tr) > 0.6 * nf:
            arr[:lo] = arr[lo]
            arr[hi + 1:] = arr[hi]
        ok = ~np.isnan(arr[:, 0, 0])
        sm = arr.copy()
        sm[ok] = smooth_track(arr[ok], sigma)
        seen = np.zeros(nf, bool)
        seen[fr] = True
        out[len(out)] = (sm, seen)
    return out, nf


def detect(bgr, prev=None):
    d = green_diff(bgr)
    m0 = largest_green(d, 60)
    if m0 is None:
        return None, None
    inner = cv2.erode(m0, np.ones((9, 9), np.uint8)) > 0
    level = float(np.median(d[inner])) if inner.any() else 200.0
    m = largest_green(d, 0.75 * level)
    q = rough_quad(m)
    for _ in range(2):
        q, res = refine_quad(d, q, level)
    return q, {'level': level, 'resid': res, 'area': int(m.sum())}


def track_video(path, log_every=0):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    raw, info = [], []
    prev = None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        q, inf = detect(f, prev)
        if q is None:
            q = prev
        raw.append(q)
        info.append(inf)
        prev = q
    cap.release()
    return fps, (W, H), np.array(raw, np.float64), info


def gauss_kernel(sigma):
    r = int(np.ceil(3 * sigma))
    x = np.arange(-r, r + 1)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / k.sum()


def smooth_track(raw, sigma=4.0, poly_order=2):
    """Zero-phase smoothing per coordinate: a local polynomial (order 2) fit with
    Gaussian weights. Unlike a plain Gaussian blur it follows a steady drift or a
    gentle acceleration without lag or end-of-clip bias. A first pass finds
    outliers (bad keys), which get zero weight in the second pass."""
    n = raw.shape[0]
    flat = raw.reshape(n, -1)
    t = np.arange(n, dtype=np.float64)
    r = int(np.ceil(3 * sigma))
    w_out = np.ones(n)
    for it in range(2):
        out = np.empty_like(flat)
        for i in range(n):
            lo, hi = max(0, i - r), min(n, i + r + 1)
            # keep the window full-size at the clip ends (shift it) so the fit stays stable
            if hi - lo < 2 * r + 1:
                if lo == 0:
                    hi = min(n, 2 * r + 1)
                else:
                    lo = max(0, n - 2 * r - 1)
            tt = t[lo:hi] - i
            ww = np.exp(-0.5 * (tt / sigma) ** 2) * w_out[lo:hi]
            A = np.vander(tt, poly_order + 1, increasing=True)
            Aw = A * ww[:, None]
            coef = np.linalg.lstsq(Aw.T @ A, Aw.T @ flat[lo:hi], rcond=None)[0]
            out[i] = coef[0]
        err = np.abs(flat - out).max(1)
        mad = np.median(err) + 1e-6
        w_out = np.where(err > max(6 * mad, 1.5), 0.0, 1.0)
    return out.reshape(raw.shape)
