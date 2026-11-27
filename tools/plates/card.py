"""The gift card that plays on the replaced screen: a WISH BOARD birthday card in the
party theme (giftrules.js GIFT_THEMES.party), animated over the clip.

Static pieces (ground, text sprites, sparkle sprite) are drawn once with PIL; each
frame is assembled with numpy/OpenCV. Output: float32 RGB in [0, 1] (sRGB), size
(H, W, 3), plus nothing else; the compositor treats it as the screen's emission.

Timeline (seconds): 0-1.5 standby (dark, breathing glow, twinkles), 1.38-1.5 charge
up, 1.5 white flash, then the card: badge, To., the headline pop, the line, From.,
the WISH BOARD footer, a confetti burst on the board, falling confetti, twinkles and
sheen passes, settling down to a calm card by the end.
"""
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_B = r"C:\Windows\Fonts\malgunbd.ttf"
FONT_R = r"C:\Windows\Fonts\malgun.ttf"
FONT_EMOJI = r"C:\Windows\Fonts\seguiemj.ttf"

# giftrules.js GIFT_THEMES.party
PARTY = dict(a=(0xff, 0x4f, 0xa3), b=(0x5b, 0x21, 0xff), ink=(0xff, 0xf7, 0xfb),
             hi=(0xff, 0xe0, 0x8a), deep=(0x22, 0x06, 0x3f))

CONTENT = dict(to='지수', occ_emoji='\U0001F382', occ='생일', head=('생일', '축하해!'),
               line='태어나 줘서 고마워!', frm='친구들', brand='WISH BOARD')

T_FLASH = 1.5


def c01(rgb):
    return np.array(rgb, np.float32) / 255.0


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ease_out_back(t, s=1.70158):
    t = min(max(t, 0.0), 1.0) - 1
    return t * t * ((s + 1) * t + s) + 1


def ease_out_cubic(t):
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


# ---------------------------------------------------------------- sprites

def font(path, size):
    return ImageFont.truetype(path, max(4, int(round(size))))


def fit_size(text, path, max_w, size, min_size):
    s = int(size)
    while s > min_size:
        w = font(path, s).getlength(text)
        if w <= max_w:
            return s
        s -= max(1, int(s * 0.04))
    return int(min_size)


def to_premul(img):
    """PIL RGBA -> float32 premultiplied (h, w, 4)."""
    a = np.asarray(img, np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    return a


def text_sprite(text, size, fill, path=FONT_B, glow=None, glow_r=0.0, glow_a=0.0,
                shadow=None, shadow_r=0.0, shadow_a=0.0, shadow_dy=0.0, stroke=0, stroke_fill=None,
                tracking=0.0):
    """A text line as a premultiplied RGBA sprite, with an optional soft drop shadow
    under it and a coloured glow around it. The sprite is padded for the blur."""
    f = font(path, size)
    pad = int(max(glow_r, shadow_r) * 3 + abs(shadow_dy) + stroke + 8)
    if tracking:
        widths = [f.getlength(ch) for ch in text]
        tw = sum(widths) + tracking * size * (len(text) - 1)
    else:
        tw = f.getlength(text)
    asc, desc = f.getmetrics()
    W = int(math.ceil(tw)) + 2 * pad
    H = asc + desc + 2 * pad
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    if tracking:
        x = pad
        for ch, w in zip(text, widths):
            d.text((x, pad), ch, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
            x += w + tracking * size
    else:
        d.text((pad, pad), text, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
    body = Image.new('L', (W, H), 0)
    db = ImageDraw.Draw(body)
    if tracking:
        x = pad
        for ch, w in zip(text, widths):
            db.text((x, pad), ch, font=f, fill=255)
            x += w + tracking * size
    else:
        db.text((pad, pad), text, font=f, fill=255)
    out = np.zeros((H, W, 4), np.float32)

    def over(dst, rgb, alpha):
        a = alpha[..., None]
        dst[..., :3] = np.asarray(rgb, np.float32)[None, None, :] * a + dst[..., :3] * (1 - a)
        dst[..., 3:4] = a + dst[..., 3:4] * (1 - a)

    m = np.asarray(mask, np.float32) / 255.0
    if shadow is not None:
        sh = cv2.GaussianBlur(m, (0, 0), max(shadow_r, 0.5))
        M = np.float32([[1, 0, 0], [0, 1, shadow_dy]])
        sh = cv2.warpAffine(sh, M, (W, H))
        over(out, c01(shadow), np.clip(sh * shadow_a, 0, 1))
    if glow is not None:
        gl = cv2.GaussianBlur(m, (0, 0), max(glow_r, 0.5))
        over(out, c01(glow), np.clip(gl * glow_a, 0, 1))
    if stroke and stroke_fill is not None:
        over(out, c01(stroke_fill), m)
    b = np.asarray(body, np.float32) / 255.0
    over(out, c01(fill), b)
    return out, b  # sprite, body mask (for sheen)


def badge_sprite(size, T):
    """The occasion pill: gold, deep ink, colour cake emoji + 생일."""
    f = font(FONT_B, size)
    fe = font(FONT_EMOJI, size * 0.92)
    tw = f.getlength(CONTENT['occ'])
    ew = fe.getlength(CONTENT['occ_emoji'])
    gap = size * 0.28
    ph, pw = size * 0.62, size * 0.85
    asc, desc = f.getmetrics()
    h = int(asc + desc * 0.4 + 2 * ph * 0.55)
    w = int(ew + gap + tw + 2 * pw)
    pad = int(size * 0.6)
    img = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    # soft gold glow
    glow = Image.new('L', img.size, 0)
    ImageDraw.Draw(glow).rounded_rectangle((pad, pad, pad + w, pad + h), radius=h / 2, fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.25))
    gl = Image.new('RGBA', img.size, T['hi'] + (0,))
    gl.putalpha(glow.point(lambda v: int(v * 0.55)))
    img = Image.alpha_composite(img, gl)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((pad, pad, pad + w, pad + h), radius=h / 2, fill=T['hi'] + (255,))
    # inner highlight
    d.rounded_rectangle((pad + 3, pad + 3, pad + w - 3, pad + h * 0.5), radius=h / 2, fill=(255, 255, 255, 46))
    cy = pad + h / 2
    x = pad + pw
    try:
        d.text((x, cy), CONTENT['occ_emoji'], font=fe, embedded_color=True, anchor='lm')
    except Exception:
        pass
    x += ew + gap
    d.text((x, cy), CONTENT['occ'], font=f, fill=T['deep'] + (255,), anchor='lm')
    return to_premul(img)


def sparkle_sprite(r):
    """A 4-point twinkle: a gaussian core with two thin rays. Additive, RGB = A."""
    n = int(r * 2 + 1)
    y, x = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32) / r
    core = np.exp(-(x * x + y * y) / 0.012)
    rays = np.exp(-(y * y) / 0.0012) * np.clip(1 - np.abs(x), 0, 1) ** 2 + \
        np.exp(-(x * x) / 0.0012) * np.clip(1 - np.abs(y), 0, 1) ** 2
    halo = np.exp(-(x * x + y * y) / 0.08) * 0.35
    s = np.clip(core + rays * 0.9 + halo, 0, 1.5)
    return s.astype(np.float32)


# ---------------------------------------------------------------- layout

def layout_for(aspect, name=None):
    """Element positions as fractions of W (sizes) and H (y). Portrait layouts: 'card' for a near-frontal
    board (~0.6-0.85 w/h), 'banner' for a tall one; 'wide' for a landscape board (w/h >= 1.05, one-line
    headline); 'corner' (by name) for a board wrapped round a building corner, text in the upper part and the
    lower part left free for the pop-out gift box."""
    if name == 'corner':
        k = lambda v, cap: min(v, cap / max(aspect, 1e-3))   # sizes are fractions of W; keep them in H terms
        return dict(name='corner', inset=0.035, radius=0.05, lw=0.008,
                    badge=(0.075, k(0.075, 0.05)),
                    to=[('To. ' + CONTENT['to'], 0.165, k(0.1, 0.055))],
                    head=[(CONTENT['head'][0], 0.275), (CONTENT['head'][1], 0.395)], head_size=k(0.22, 0.12), head_fit=0.84,
                    line=[(CONTENT['line'], 0.49)], line_size=k(0.07, 0.04), line_fit=0.84,
                    frm=(0.552, k(0.052, 0.03)), brand=(0.955, k(0.032, 0.02)), burst_y=0.78)
    if name == 'wide' or (name is None and aspect >= 1.05):
        return dict(name='wide', inset=0.03, radius=0.035, lw=0.006,
                    badge=(0.115, 0.048),
                    to=[('To. ' + CONTENT['to'], 0.255, 0.062)],
                    head=[(CONTENT['head'][0] + ' ' + CONTENT['head'][1], 0.47)], head_size=0.14, head_fit=0.82,
                    line=[(CONTENT['line'], 0.675)], line_size=0.05, line_fit=0.7,
                    frm=(0.79, 0.038), brand=(0.915, 0.022))
    if name == 'card' or (name is None and aspect >= 0.55):
        return dict(name='card', inset=0.035, radius=0.05, lw=0.008,
                    badge=(0.095, 0.07),
                    to=[('To. ' + CONTENT['to'], 0.225, 0.115)],
                    head=[(CONTENT['head'][0], 0.398), (CONTENT['head'][1], 0.562)], head_size=0.25, head_fit=0.8,
                    line=[(CONTENT['line'], 0.715)], line_size=0.078, line_fit=0.8,
                    frm=(0.81, 0.06), brand=(0.925, 0.034))
    return dict(name='banner', inset=0.05, radius=0.07, lw=0.012,
                badge=(0.08, 0.095),
                to=[('To. ' + CONTENT['to'], 0.195, 0.2)],
                head=[(CONTENT['head'][0], 0.365), (CONTENT['head'][1], 0.47)], head_size=0.3, head_fit=0.84,
                line=[('태어나 줘서', 0.615), ('고마워!', 0.672)], line_size=0.13, line_fit=0.8,
                frm=(0.78, 0.09), brand=(0.925, 0.05))


class Card:
    def __init__(self, W, H, fps=24.0, seed=7, T=PARTY, layout=None):
        self.W, self.H, self.fps, self.T = W, H, fps, T
        self.L = layout_for(W / H, layout)
        self.rng = np.random.default_rng(seed)
        self._ground()
        self._standby()
        self._sprites()
        self._particles()

    # ---- static layers
    def _ground(self):
        W, H, T = self.W, self.H, self.T
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        u = (x / W * 0.45 + y / H * 0.55)  # diagonal, mostly vertical on a portrait board
        a, b = c01(T['a']), c01(T['b'])
        g = a[None, None, :] * (1 - u[..., None]) + b[None, None, :] * u[..., None]
        # soft light from the top left, darker corners
        r1 = np.sqrt(((x - W * 0.28) / W) ** 2 + ((y - H * 0.16) / W) ** 2)
        g += np.exp(-(r1 / 0.55) ** 2)[..., None] * 0.20
        r2 = np.sqrt(((x - W * 0.5) / (W * 0.62)) ** 2 + ((y - H * 0.5) / (H * 0.62)) ** 2)
        g *= (1 - 0.34 * smoothstep(0.55, 1.15, r2))[..., None]
        self.ground = np.clip(g, 0, 1).astype(np.float32)
        # frame: gold rounded rectangle line with a soft glow
        L = self.L
        m = Image.new('L', (W, H), 0)
        ins, rad, lw = L['inset'] * W, L['radius'] * W, max(2, int(L['lw'] * W))
        ImageDraw.Draw(m).rounded_rectangle((ins, ins, W - ins, H - ins), radius=rad, outline=255, width=lw)
        fm = np.asarray(m, np.float32) / 255.0
        self.frame_line = fm
        self.frame_glow = cv2.GaussianBlur(fm, (0, 0), lw * 2.2)
        self.uvx, self.uvy = x / W, y / H

    def _standby(self):
        W, H, T = self.W, self.H, self.T
        x, y = self.uvx, self.uvy
        deep = c01(T['deep'])
        base = deep[None, None, :] * (0.55 + 0.45 * (1 - y))[..., None] * 0.8
        self.standby = base.astype(np.float32)
        r = np.sqrt(((x - 0.5) / 0.55) ** 2 + ((y - 0.5) / (0.55 * W / H)) ** 2)
        self.standby_glow = np.exp(-(r ** 2) * 2.2).astype(np.float32)
        s = max(18, int(W * 0.055))
        self.wordmark, _ = text_sprite(CONTENT['brand'], s, T['hi'], tracking=0.22,
                                       glow=T['a'], glow_r=s * 0.5, glow_a=0.9)

    def _sprites(self):
        W, H, T, L = self.W, self.H, self.T, self.L
        self.badge = badge_sprite(W * L['badge'][1], T)
        self.to = []
        for text, yf, sf in L['to']:
            sz = fit_size(text, FONT_B, W * 0.84, W * sf, W * 0.05)
            sp, _ = text_sprite(text, sz, T['ink'], shadow=T['deep'], shadow_r=sz * 0.08, shadow_a=0.55, shadow_dy=sz * 0.04,
                                glow=(255, 255, 255), glow_r=sz * 0.18, glow_a=0.25)
            self.to.append((sp, yf))
        hs = min(fit_size(t, FONT_B, W * L['head_fit'], W * L['head_size'], W * 0.08) for t, _ in L['head'])
        self.head = []
        for text, yf in L['head']:
            sp, body = text_sprite(text, hs, T['hi'], stroke=max(2, int(hs * 0.035)), stroke_fill=(120, 24, 92),
                                   shadow=T['deep'], shadow_r=hs * 0.06, shadow_a=0.75, shadow_dy=hs * 0.045,
                                   glow=(255, 190, 120), glow_r=hs * 0.16, glow_a=0.55)
            self.head.append((sp, body, yf))
        ls = min(fit_size(t, FONT_B, W * L['line_fit'], W * L['line_size'], W * 0.04) for t, _ in L['line'])
        self.line = []
        for text, yf in L['line']:
            sp, _ = text_sprite(text, ls, T['ink'], shadow=T['deep'], shadow_r=ls * 0.1, shadow_a=0.6, shadow_dy=ls * 0.05)
            self.line.append((sp, yf))
        fy, fs = L['frm']
        sz = fit_size('From. ' + CONTENT['frm'], FONT_B, W * 0.8, W * fs, W * 0.03)
        self.frm, _ = text_sprite('From. ' + CONTENT['frm'], sz, T['ink'], shadow=T['deep'], shadow_r=sz * 0.1,
                                  shadow_a=0.55, shadow_dy=sz * 0.05)
        by, bs = L['brand']
        self.brand, _ = text_sprite('★  ' + CONTENT['brand'] + '  ★', W * bs, T['hi'], tracking=0.16,
                                    shadow=T['deep'], shadow_r=W * bs * 0.15, shadow_a=0.5, shadow_dy=W * bs * 0.05)
        self.spark = sparkle_sprite(max(8, int(W * 0.035)))
        self.spark_small = sparkle_sprite(max(5, int(W * 0.018)))

    def _particles(self):
        W, H, rng = self.W, self.H, self.rng
        T = self.T
        cols = [T['hi'], (255, 255, 255), T['a'], (255, 209, 234), (185, 246, 255), (255, 170, 90), (190, 150, 255)]
        self.colors = [c01(c) for c in cols]
        # burst: from just behind the headline, mostly upward and sideways
        n = 170
        cx, cy = W * 0.5, H * self.L.get('burst_y', 0.5)
        ang = rng.uniform(-math.pi, 0, n) + rng.normal(0, 0.25, n)
        sp = rng.uniform(0.5, 1.6, n) * H * 0.85
        self.burst = dict(x0=cx + rng.normal(0, W * 0.08, n), y0=cy + rng.normal(0, H * 0.05, n),
                          vx=np.cos(ang) * sp * (W / H) * 1.6, vy=np.sin(ang) * sp,
                          rot=rng.uniform(0, 6.28, n), vr=rng.uniform(-9, 9, n), flip=rng.uniform(4, 11, n),
                          size=rng.uniform(0.016, 0.03, n) * W, kind=rng.integers(0, 3, n),
                          col=rng.integers(0, len(cols), n), life=rng.uniform(2.6, 4.6, n))
        # falling confetti over the rest of the clip, thinning out toward the end
        m = 120
        t0 = np.sort(rng.uniform(2.2, 9.2, m))
        keep = rng.uniform(0, 1, m) < (1.0 - 0.75 * smoothstep(5.5, 9.2, t0))
        t0 = t0[keep]
        m = len(t0)
        self.fall = dict(t0=t0, x0=rng.uniform(0.04, 0.96, m) * W, vy=rng.uniform(0.07, 0.14, m) * H,
                         sway=rng.uniform(0.01, 0.03, m) * W, sw=rng.uniform(1.5, 3.5, m), ph=rng.uniform(0, 6.28, m),
                         rot=rng.uniform(0, 6.28, m), vr=rng.uniform(-4, 4, m), flip=rng.uniform(3, 8, m),
                         size=rng.uniform(0.014, 0.026, m) * W, kind=rng.integers(0, 3, m), col=rng.integers(0, len(cols), m))
        # twinkles
        k = 70
        self.twk = dict(x=rng.uniform(0.06, 0.94, k) * W, y=rng.uniform(0.04, 0.96, k) * H,
                        per=rng.uniform(1.2, 2.8, k), ph=rng.uniform(0, 1, k), big=rng.uniform(0, 1, k) < 0.25,
                        col=rng.integers(0, 3, k))

    # ---- drawing helpers
    def _blit(self, canvas, sp, cx, cy, scale=1.0, alpha=1.0, sheen=None, body=None):
        """Premultiplied 'over' of sprite sp centred at (cx, cy), scaled."""
        if alpha <= 0.002 or scale <= 0.01:
            return
        h, w = sp.shape[:2]
        W, H = self.W, self.H
        hw, hh = w * scale / 2, h * scale / 2
        x0, y0 = int(max(0, math.floor(cx - hw - 2))), int(max(0, math.floor(cy - hh - 2)))
        x1, y1 = int(min(W, math.ceil(cx + hw + 2))), int(min(H, math.ceil(cy + hh + 2)))
        if x1 <= x0 or y1 <= y0:
            return
        M = np.float32([[scale, 0, cx - w * scale / 2 - x0], [0, scale, cy - h * scale / 2 - y0]])
        flags = cv2.INTER_AREA if scale < 0.95 else cv2.INTER_LINEAR
        if scale < 0.95:
            # warpAffine has no area filter; pre-shrink the sprite instead
            sp2 = cv2.resize(sp, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))), interpolation=cv2.INTER_AREA)
            sx, sy = sp2.shape[1] / w, sp2.shape[0] / h
            M = np.float32([[scale / sx, 0, cx - w * scale / 2 - x0], [0, scale / sy, cy - h * scale / 2 - y0]])
            sp = sp2
            flags = cv2.INTER_LINEAR
        r = cv2.warpAffine(sp, M, (x1 - x0, y1 - y0), flags=flags, borderMode=cv2.BORDER_CONSTANT)
        r *= alpha
        roi = canvas[y0:y1, x0:x1]
        roi[:] = r[..., :3] + roi * (1 - r[..., 3:4])
        if sheen is not None and body is not None:
            b = cv2.warpAffine(body if scale >= 0.95 else cv2.resize(body, (sp.shape[1], sp.shape[0]), interpolation=cv2.INTER_AREA),
                               M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR)
            s = sheen[y0:y1, x0:x1] * b * alpha
            roi[:] = roi + s[..., None] * (1 - roi) * 0.95

    def _add_sprite(self, canvas, spr, cx, cy, gain, color):
        h, w = spr.shape
        x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
        X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(self.W, x0 + w), min(self.H, y0 + h)
        if X1 <= X0 or Y1 <= Y0:
            return
        s = spr[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0] * gain
        canvas[Y0:Y1, X0:X1] += s[..., None] * color[None, None, :]

    def _confetti(self, canvas, xs, ys, rots, flips, sizes, kinds, cols, alphas):
        for x, y, r, fl, s, k, c, a in zip(xs, ys, rots, flips, sizes, kinds, cols, alphas):
            if a <= 0.01 or x < -s or y < -s or x > self.W + s or y > self.H + s:
                continue
            col = self.colors[c]
            # shade by flip so ribbons look like they turn in 3D
            shade = 0.65 + 0.35 * abs(math.cos(fl))
            colr = np.clip(col * shade, 0, 1)
            if k == 0:  # dot
                rad = s * 0.45
                self._poly_over(canvas, None, x, y, rad, colr, a)
            else:  # ribbon / square
                lw, lh = (s * 1.3, s * 0.42) if k == 1 else (s * 0.7, s * 0.7)
                lh = lh * max(0.15, abs(math.cos(fl)))
                ca, sa = math.cos(r), math.sin(r)
                pts = np.array([[-lw, -lh], [lw, -lh], [lw, lh], [-lw, lh]]) / 2
                pts = pts @ np.array([[ca, sa], [-sa, ca]]) + [x, y]
                self._poly_over(canvas, pts, x, y, s, colr, a)

    def _poly_over(self, canvas, pts, x, y, s, colr, a):
        S = 4  # sub-pixel shift for anti-aliased cv2 drawing
        pad = int(s * 1.2 + 3)
        X0, Y0 = int(x) - pad, int(y) - pad
        X1, Y1 = X0 + 2 * pad + 1, Y0 + 2 * pad + 1
        cx0, cy0, cx1, cy1 = max(0, X0), max(0, Y0), min(self.W, X1), min(self.H, Y1)
        if cx1 <= cx0 or cy1 <= cy0:
            return
        m = np.zeros((Y1 - Y0, X1 - X0), np.uint8)
        if pts is None:
            cv2.circle(m, (int((x - X0) * 16), int((y - Y0) * 16)), int(s * 0.45 * 16), 255, -1, cv2.LINE_AA, S)
        else:
            p = np.round((pts - [X0, Y0]) * 16).astype(np.int32)
            cv2.fillPoly(m, [p], 255, cv2.LINE_AA, S)
        mm = m[cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0].astype(np.float32) / 255.0 * a
        roi = canvas[cy0:cy1, cx0:cx1]
        roi[:] = roi * (1 - mm[..., None]) + colr[None, None, :] * mm[..., None]

    # ---- one frame
    def frame(self, t):
        W, H, T, L = self.W, self.H, self.T, self.L
        x, y = self.uvx, self.uvy
        hi, pink, vio = c01(T['hi']), c01(T['a']), c01(T['b'])
        if t < T_FLASH:
            # standby: dark, a slow breathing glow in the theme colours, then a charge-up
            br = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 1.6 - 1.2)
            charge = float(smoothstep(0.95, T_FLASH, t))
            cv_ = self.standby.copy()
            glowc = pink * (0.5 + 0.5 * math.sin(t * 1.7)) + vio * (0.5 - 0.5 * math.sin(t * 1.7))
            cv_ += self.standby_glow[..., None] * glowc[None, None, :] * (0.24 + 0.12 * br + 0.55 * charge)
            cv_ += (self.frame_glow * 0.35 + self.frame_line * 0.55)[..., None] * hi[None, None, :] * (0.25 + 0.2 * br + 0.5 * charge)
            self._blit(cv_, self.wordmark, W / 2, H / 2, 1.0 + 0.04 * charge, 0.45 + 0.25 * br + 0.3 * charge)
            self._twinkles(cv_, t, 0.55 + 0.6 * charge, standby=True)
            fl = float(smoothstep(1.36, T_FLASH, t)) ** 2
            cv_ = cv_ * (1 - fl) + fl * np.float32([1.0, 0.97, 0.985])
            return np.clip(cv_, 0, 1)

        tt = t - T_FLASH
        cv_ = self.ground.copy()
        # gentle breathing of the light, smaller toward the end (ends calm)
        calm = 1 - 0.6 * float(smoothstep(6.5, 9.5, t))
        breathe = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 3.2)
        cv_ *= 0.96 + 0.05 * breathe * calm
        # slow moving soft light across the ground
        lx = 0.3 + 0.4 * math.sin(t * 0.45)
        cv_ += (np.exp(-(((x - lx) / 0.5) ** 2 + ((y - 0.35) / 0.4) ** 2)) * 0.06)[..., None]
        cv_ += (self.frame_glow * 0.45 + self.frame_line * 0.9)[..., None] * (hi * 0.9)[None, None, :] * \
            (0.8 + 0.2 * breathe)
        cv_ = np.clip(cv_, 0, 1)
        # confetti behind the words: the burst
        b = self.burst
        tb = tt - 0.02
        if tb > 0:
            drag = 1.6
            k = (1 - np.exp(-drag * tb)) / drag
            g = H * 0.55
            xs = b['x0'] + b['vx'] * k
            ys = b['y0'] + b['vy'] * k + g * (tb - k) / drag
            al = 1 - smoothstep(b['life'] - 0.8, b['life'], tb)
            self._confetti(cv_, xs, ys, b['rot'] + b['vr'] * tb, b['flip'] * tb, b['size'], b['kind'], b['col'], al)
        f = self.fall
        tf = t - f['t0']
        on = (tf > 0)
        if on.any():
            xs = f['x0'] + f['sway'] * np.sin(f['sw'] * tf + f['ph'])
            ys = -0.03 * H + f['vy'] * tf
            al = np.where(on, 0.9 * (1 - smoothstep(0.85, 1.02, ys / H)), 0)
            self._confetti(cv_, xs[on], ys[on], (f['rot'] + f['vr'] * tf)[on], (f['flip'] * tf)[on], f['size'][on],
                           f['kind'][on], f['col'][on], al[on])

        # the words, staggered in
        def appear(t0, dur=0.45):
            return (t - t0) / dur

        p = appear(1.62, 0.5)
        if p > 0:
            e = ease_out_back(p)
            self._blit(cv_, self.badge, W / 2, H * L['badge'][0] - (1 - e) * H * 0.05, 0.8 + 0.2 * e, min(1, p * 2.2))
        for i, (sp, yf) in enumerate(self.to):
            p = appear(1.72 + 0.08 * i, 0.5)
            if p > 0:
                self._blit(cv_, sp, W / 2, H * yf, 0.78 + 0.22 * ease_out_back(p), min(1, p * 2.0))
        # sheen bands across the headline
        sheen = None
        for ts, amp in ((3.0, 0.85), (6.1, 0.65), (8.6, 0.4)):
            q = (t - ts) / 0.9
            if 0 <= q <= 1:
                pos = -0.4 + 1.8 * q
                band = np.exp(-(((x * 0.8 + y * 0.6 * H / W * 0.35) - pos) / 0.07) ** 2) * amp
                sheen = band.astype(np.float32) if sheen is None else np.maximum(sheen, band)
        for i, (sp, body, yf) in enumerate(self.head):
            p = appear(1.8 + 0.1 * i, 0.45)
            if p > 0:
                e = ease_out_back(p, 2.2)
                s = 1.2 - 0.2 * e
                s *= 1 + 0.012 * math.sin(t * 2 * math.pi / 2.4 + i) * calm
                self._blit(cv_, sp, W / 2, H * yf, s, min(1, p * 3.5), sheen=sheen, body=body)
        for i, (sp, yf) in enumerate(self.line):
            p = appear(2.35 + 0.1 * i, 0.55)
            if p > 0:
                e = ease_out_cubic(p)
                self._blit(cv_, sp, W / 2, H * yf + (1 - e) * H * 0.03, 1.0, min(1, p * 1.6))
        p = appear(2.65, 0.55)
        if p > 0:
            e = ease_out_cubic(p)
            self._blit(cv_, self.frm, W / 2, H * L['frm'][0] + (1 - e) * H * 0.025, 1.0, min(1, p * 1.6))
        p = appear(2.9, 0.6)
        if p > 0:
            self._blit(cv_, self.brand, W / 2, H * L['brand'][0], 1.0, 0.9 * min(1, p * 1.5))
        # a faint global sheen too
        if sheen is not None:
            cv_ += (sheen * 0.08)[..., None]
        # twinkles (additive, over everything)
        self._twinkles(cv_, t, 1.0)
        # the flash decays over the fresh card
        fl = math.exp(-max(0.0, tt) / 0.16) if tt < 1.2 else 0.0
        if fl > 0.002:
            cv_ = cv_ * (1 - fl) + fl * np.float32([1.0, 0.97, 0.985])
        return np.clip(cv_, 0, 1)

    def _twinkles(self, canvas, t, gain, standby=False):
        k = self.twk
        cols = [c01(self.T['hi']), np.float32([1, 1, 1]), c01((255, 209, 234))]
        burst = 0.0 if standby else float(np.exp(-max(0.0, t - T_FLASH - 0.1) / 1.5))
        calm = 1.0 if standby else 1 - 0.45 * float(smoothstep(6.5, 9.5, t))
        for i in range(len(k['x'])):
            ph = ((t / k['per'][i]) + k['ph'][i]) % 1.0
            a = max(0.0, math.sin(ph * math.pi)) ** 3
            if standby and i % 2:
                continue
            a *= gain * calm * (0.7 + 0.8 * burst)
            if a < 0.02:
                continue
            spr = self.spark if k['big'][i] else self.spark_small
            self._add_sprite(canvas, spr, k['x'][i], k['y'][i], a, cols[k['col'][i]])


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for W, H, tag in ((1120, 1600, 'card'), (760, 1810, 'banner')):
        c = Card(W, H)
        for t in (0.6, 1.45, 1.6, 2.2, 3.4, 5.0, 9.9):
            f = c.frame(t)
            cv2.imwrite(f'{out}/card-{tag}-{t:.2f}.png', (f[..., ::-1] * 255 + 0.5).astype(np.uint8))
