"""Screen replacement for WISH BOARD sample videos.

Takes an AI-generated plate with one big chroma-green billboard, tracks the screen's
four corners (track.py), renders the animated gift card (card.py) in the screen's
aspect, and composites it so it reads as an LED screen lit up in the shot.

Usage (from the repo root):
    python tools/plates/composite.py video/plate-01-front-night.mp4 out/2026-11-27/plates/sample-01-front.mp4 \
        --track out/2026-11-27/plates/plate-01.track.json --stills --debug out/2026-11-27/plates/debug-01-corners.mp4 \
        --ground-spill 0.66
    python tools/plates/composite.py video/plate-02-front-night-up.mp4 out/2026-11-27/plates/sample-02-tower.mp4 \
        --track out/2026-11-27/plates/plate-02.track.json --stills
  the owner's cut: only "AI 합성", small, bottom-right (--no-caption drops the burned-in label;
  the MP4 metadata label is written either way):
    python tools/plates/composite.py video/plate-01-front-night.mp4 out/2026-11-27/plates/sample-01-front-cap.mp4 \
        --ground-spill 0.74 --fill-small --stills --caption-text "AI 합성" --caption-pos br
    python tools/plates/composite.py video/plate-02-front-night-up.mp4 out/2026-11-27/plates/sample-02-tower-cap.mp4 \
        --stills --caption-text "AI 합성" --caption-pos br

Pipeline per frame (all light maths in linear RGB):
  key       G - max(R, B); the largest component is the screen; small rectangular
            green screens (a phone in the crowd) are filled with the board too.
  geometry  sub-pixel line fits per side -> corners -> zero-phase local-quadratic
            smoothing over the clip (no lag); homography texture -> frame.
  board     card.py frame at t, LED dot grid in texture space, warped at 2x into the
            ROI and area-downsampled (anti-aliased edges, no texture shimmer); sub-frame
            warps averaged when the corners move fast (motion blur).
  matte     max(geometric coverage, high-confidence key) minus occluders found
            inside the screen (non-green blobs), so a foreground object stays on top.
  spill     green excess near the screen (lit bezel lip, halo) and on the wet ground
            is taken out and put back in the board's colour (local / average).
  look      exposure, slight softening to the plate's sharpness, light wrap at the
            edge, three-radius bloom onto the building, grain like the plate's.
  out       1080x1920 crop (4 px each side), caption, H.264 CRF 18 yuv420p 24 fps,
            plate AAC copied.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time
from multiprocessing import Pool

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import track as trk  # noqa: E402
from card import Card  # noqa: E402

CAPTION = 'AI 합성 · 가상 광장 · WISH BOARD'
# Machine-readable label in the MP4 (always written, caption or not; music.py mix keeps it).
META = dict(comment='AI-generated composite · WISH BOARD virtual plaza',
            description='AI 합성 · 가상 광장 · WISH BOARD (AI-generated composite: virtual plaza, not a real broadcast)')
META_ARGS = [x for k, v in META.items() for x in ('-metadata', f'{k}={v}')]
OUT_W = 1080

# ------------------------------------------------------------------ colour helpers
_LUT = ((np.arange(256) / 255.0) ** 2.2).astype(np.float32)  # plate decode (camera-ish gamma)


def to_lin(u8):
    return _LUT[u8]


def to_srgb(lin):
    return np.clip(lin, 0, None) ** (1 / 2.2)


def srgb_float_to_lin(x):
    return np.clip(x, 0, 1) ** 2.2


# ------------------------------------------------------------------ geometry helpers

def expand_quad(q, e):
    """Move every side of quad q outward by e pixels (q ordered TL, TR, BR, BL)."""
    q = np.asarray(q, np.float64)
    c = q.mean(0)
    lines = []
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([-t[1], t[0]])
        if np.dot(c - a, n) > 0:
            n = -n
        lines.append((a + n * e, t))
    return np.array([trk.line_intersect(lines[(i - 1) % 4], lines[i]) for i in range(4)])


def quad_at(track, f):
    """Corners at a fractional frame index (linear between frames)."""
    n = len(track)
    f = min(max(f, 0.0), n - 1.0)
    i = int(math.floor(f))
    j = min(i + 1, n - 1)
    a = f - i
    return track[i] * (1 - a) + track[j] * a


def tex_to_roi2(texW, texH, quad, x0, y0):
    """Homography from texture pixels to the 2x supersampled ROI. Pixel centres at
    integers in both; texture edges at -0.5 / W-0.5. Source pixel k -> 2x coord 2k+0.5."""
    src = np.float32([[-0.5, -0.5], [texW - 0.5, -0.5], [texW - 0.5, texH - 0.5], [-0.5, texH - 0.5]])
    dst = np.float32([[2 * (x - x0) + 0.5, 2 * (y - y0) + 0.5] for x, y in quad])
    return cv2.getPerspectiveTransform(src, dst)


def led_grid(texW, texH, cols, contrast):
    """Raised-cosine LED dots, `cols` across. Mean ~1 so it doesn't dim the board."""
    p = texW / cols
    x = np.arange(texW, dtype=np.float32) + 0.5
    y = np.arange(texH, dtype=np.float32) + 0.5
    gx = 0.5 + 0.5 * np.cos(2 * np.pi * x / p)
    gy = 0.5 + 0.5 * np.cos(2 * np.pi * y / p)
    g = (1 - contrast) + contrast * 2.2 * np.outer(gy, gx) ** 0.7
    return (g / g.mean()).astype(np.float32)


# ------------------------------------------------------------------ caption

def caption_layer(W, H, text=CAPTION, pos='center'):
    """center: the original label, 25 px font centred 78 px above the bottom, white 80 %.
    br: a small corner label, about 24 px cap height, right edge 36 px and ink bottom 48 px from the
    frame edges, white 70 % with a soft shadow."""
    if pos == 'br':
        size, alpha, blur, sha = 33, 179, 2.5, 170
        f = ImageFont.truetype(r'C:\Windows\Fonts\malgunbd.ttf', size)
        l, t, r, b = f.getbbox(text)
        x, y = W - 36 - r, H - 48 - b
    else:
        size, alpha, blur, sha = 25, 205, 3, 200
        f = ImageFont.truetype(r'C:\Windows\Fonts\malgunbd.ttf', size)
        x, y = (W - f.getlength(text)) / 2, H - 78
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).text((x, y + 2), text, font=f, fill=sha)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow.putalpha(sh)
    img = Image.alpha_composite(img, shadow)
    ImageDraw.Draw(img).text((x, y), text, font=f, fill=(255, 255, 255, alpha))
    a = np.asarray(img, np.float32) / 255.0
    rgb = a[..., :3][..., ::-1].copy()  # to BGR
    return rgb, a[..., 3:4].copy()


# ------------------------------------------------------------------ the worker
G = {}


def init_worker(cfg):
    G.update(cfg)
    G['card'] = Card(cfg['texW'], cfg['texH'], cfg['fps'])
    G['grid'] = led_grid(cfg['texW'], cfg['texH'], cfg['led_cols'], cfg['led_contrast'])
    if cfg.get('caption', True):
        G['cap_rgb'], G['cap_a'] = caption_layer(OUT_W, cfg['size'][1], cfg.get('caption_text', CAPTION),
                                                 cfg.get('caption_pos', 'center'))
    cv2.setNumThreads(1)


def board_texture(t):
    """Card frame at t -> linear RGB (BGR order) emission with the LED grid."""
    c = G['card'].frame(t)[..., ::-1]
    lin = srgb_float_to_lin(c) * G['gain']
    lin *= G['grid'][..., None]
    if G['tex_blur'] > 0.3:
        lin = cv2.GaussianBlur(lin, (0, 0), G['tex_blur'])
    return lin.astype(np.float32)


def warp_board(tex, quads, x0, y0, w, h):
    """Average of sub-frame warps (motion blur when there is more than one quad)."""
    acc_b = np.zeros((2 * h, 2 * w, 3), np.float32)
    acc_q = np.zeros((2 * h, 2 * w), np.float32)
    texH, texW = tex.shape[:2]
    ones = np.ones((texH, texW), np.float32)
    for q in quads:
        M = tex_to_roi2(texW, texH, q, x0, y0)
        acc_b += cv2.warpPerspective(tex, M, (2 * w, 2 * h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        Me = tex_to_roi2(texW, texH, expand_quad(q, G['expand']), x0, y0)
        acc_q += cv2.warpPerspective(ones, Me, (2 * w, 2 * h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                     borderValue=0)
    acc_b /= len(quads)
    acc_q /= len(quads)
    b = cv2.resize(acc_b, (w, h), interpolation=cv2.INTER_AREA)
    q = cv2.resize(acc_q, (w, h), interpolation=cv2.INTER_AREA)
    return b, np.clip(q, 0, 1)


def fill_small_screens(lin, d, level, main_zone, tex, out_small):
    """Small rectangular pure-green screens (a phone held up in the crowd): show the
    board on them, dimmer, keyed by their own soft matte."""
    strong = (d > 0.7 * level).astype(np.uint8)
    strong[main_zone] = 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(strong, connectivity=8)
    texH, texW = tex.shape[:2]
    for i in range(1, n):
        area = st[i, cv2.CC_STAT_AREA]
        if not (60 <= area <= 8000):
            continue
        cs, _ = cv2.findContours((lab == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        rect = cv2.minAreaRect(cs[0])
        rw, rh = rect[1]
        if rw * rh <= 0 or area / (rw * rh) < 0.78:
            continue
        x, y, w, h = st[i, :4]
        pad = 4
        X0, Y0 = max(0, x - pad), max(0, y - pad)
        X1, Y1 = min(lin.shape[1], x + w + pad), min(lin.shape[0], y + h + pad)
        box = trk.order_quad(cv2.boxPoints(rect))
        # phone screens are portrait like the board, so a straight mapping is fine
        src = np.float32([[0, 0], [texW, 0], [texW, texH], [0, texH]])
        dst = np.float32(box - [X0, Y0])
        M = cv2.getPerspectiveTransform(src, dst)
        small = cv2.resize(tex, (max(8, int(w * 3)), max(8, int(h * 3))), interpolation=cv2.INTER_AREA)
        S = np.float32([[small.shape[1] / texW, 0, 0], [0, small.shape[0] / texH, 0], [0, 0, 1]])
        M2 = M @ np.linalg.inv(S)
        b = cv2.warpPerspective(small, M2, (X1 - X0, Y1 - Y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        dd = d[Y0:Y1, X0:X1]
        a = np.clip((dd - 0.2 * level) / (0.5 * level), 0, 1)[..., None]
        roi = lin[Y0:Y1, X0:X1]
        # remove the green from partial pixels, then lay the (dimmer) board over
        gex = np.clip(roi[..., 1] - np.maximum(roi[..., 0], roi[..., 2]), 0, None)
        roi[..., 1] -= gex
        roi[:] = roi * (1 - a) + b * 0.75 * a
        out_small.append([float(v) for v in rect[0]])


def render_frame(args):
    i, frame = args
    fps = G['fps']
    t = i / fps
    track = G['track']
    Hh, Ww = frame.shape[:2]
    q = track[i]
    # sub-frame corners for motion blur (180 degree shutter)
    speed = max(np.linalg.norm(quad_at(track, i + 0.5) - quad_at(track, i - 0.5), axis=1))
    nsub = int(np.clip(math.ceil(speed * 0.5 / 0.4), 1, 6))
    quads = [quad_at(track, i + s) for s in (np.linspace(-0.25, 0.25, nsub) if nsub > 1 else [0.0])]

    lin = to_lin(frame)  # whole frame, linear BGR
    d = trk.green_diff(frame)

    # ROI around the screen
    allq = np.vstack(quads)
    m = 40
    x0 = int(max(0, math.floor(allq[:, 0].min()) - m))
    y0 = int(max(0, math.floor(allq[:, 1].min()) - m))
    x1 = int(min(Ww, math.ceil(allq[:, 0].max()) + m))
    y1 = int(min(Hh, math.ceil(allq[:, 1].max()) + m))
    w, h = x1 - x0, y1 - y0

    tex = board_texture(t)
    board, Q = warp_board(tex, quads, x0, y0, w, h)
    roi_lin = lin[y0:y1, x0:x1]
    droi = d[y0:y1, x0:x1]

    inner = cv2.erode((Q > 0.999).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    level = float(np.median(droi[inner])) if inner.sum() > 100 else 200.0
    # high-confidence key: only near-key-level green counts as "screen"
    K = np.clip((droi - 0.55 * level) / (0.3 * level), 0, 1)
    near = cv2.dilate((Q > 0.01).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    K[~near] = 0
    # occluders: clearly non-green blobs inside the screen stay on top
    hole = (inner & (droi < 0.4 * level)).astype(np.uint8)
    hole = cv2.morphologyEx(hole, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    occl = 1 - cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 0.8)
    A = np.maximum(Q * occl, K)[..., None]

    # local board colour (for spill), from a heavily blurred, edge-extended board
    small = cv2.resize(board, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
    local = cv2.resize(cv2.GaussianBlur(small, (0, 0), 5), (w, h), interpolation=cv2.INTER_LINEAR)
    g_screen = G['g_screen']

    # spill remap in a band around the screen: green excess -> board colour
    dist = cv2.distanceTransform((Q < 0.5).astype(np.uint8), cv2.DIST_L2, 3)
    band = np.clip(1 - dist / G['spill_band'], 0, 1)[..., None]
    gex = np.clip(roi_lin[..., 1] - np.maximum(roi_lin[..., 0], roi_lin[..., 2]), 0, None)[..., None]
    gx = gex * band
    bg = roi_lin.copy()
    bg[..., 1:2] -= gx
    bg += gx * local / g_screen

    # board look: soften to the plate's sharpness, light wrap at the inside edge
    B = cv2.GaussianBlur(board, (0, 0), G['soften'])
    wbg = cv2.GaussianBlur(bg * (1 - A), (0, 0), 5)
    wn = cv2.GaussianBlur((1 - A[..., 0]), (0, 0), 5)[..., None] + 1e-4
    wrap_col = wbg / wn
    wrap = (A[..., 0] * np.clip(1 - cv2.GaussianBlur(A[..., 0], (0, 0), 3), 0, 1) * G['wrap'])[..., None]
    B = B * (1 - wrap) + wrap_col * wrap
    comp = bg * (1 - A) + B * A
    lin[y0:y1, x0:x1] = comp

    # ground spill/tint: green reflections of the old screen on the wet ground
    if G['ground_y'] is not None:
        gy = int(G['ground_y'] * Hh)
        gl = lin[gy:]
        avg = board[Q > 0.5].mean(0) if (Q > 0.5).any() else np.zeros(3, np.float32)
        gex2 = np.clip(gl[..., 1] - np.maximum(gl[..., 0], gl[..., 2]) * 1.05, 0, None)
        ramp = np.clip((np.arange(gl.shape[0]) / 80.0), 0, 1)[:, None]  # fade in below the line
        gex2 = (gex2 * ramp)[..., None]
        gl[..., 1:2] -= gex2
        gl += gex2 * (avg / g_screen)[None, None, :]
        # and a very faint wash of the board's colour on bright wet patches
        lum = gl.mean(2, keepdims=True)
        gl += np.clip(lum * 4, 0, 1) * avg[None, None, :] * G['ground_tint'] * ramp[..., None]

    small_hits = []
    if G['fill_small']:
        zone = np.zeros(d.shape, bool)
        zone[max(0, y0 - 30):y1 + 30, max(0, x0 - 30):x1 + 30] = True
        if G['ground_y'] is not None:  # green on the wet ground is reflection, not a screen
            zone[int(G['ground_y'] * Hh):] = True
        fill_small_screens(lin, d, level, zone, tex, small_hits)

    # bloom: the screen's light spilling onto the building and veiling the lens
    E = np.zeros_like(lin[y0:y1, x0:x1])
    E[:] = B * A
    pad = G['bloom_pad']
    bx0, by0, bx1, by1 = max(0, x0 - pad), max(0, y0 - pad), min(Ww, x1 + pad), min(Hh, y1 + pad)
    canvas = np.zeros((by1 - by0, bx1 - bx0, 3), np.float32)
    canvas[y0 - by0:y1 - by0, x0 - bx0:x1 - bx0] = E
    ds = 4
    cs = cv2.resize(canvas, (max(1, canvas.shape[1] // ds), max(1, canvas.shape[0] // ds)), interpolation=cv2.INTER_AREA)
    bl = np.zeros_like(cs)
    for sig, wt in G['bloom']:
        bl += cv2.GaussianBlur(cs, (0, 0), sig / ds) * wt
    bl = cv2.resize(bl, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_LINEAR)
    lin[by0:by1, bx0:bx1] += bl

    # back to 8-bit, grain where we painted, crop, caption
    out = to_srgb(lin)
    rng = np.random.default_rng(1000 + i)
    region = out[by0:by1, bx0:bx1]
    nz = rng.normal(0, G['grain'] / 255.0, region.shape[:2]).astype(np.float32)
    nz = cv2.GaussianBlur(nz, (0, 0), 0.6) * 1.6
    mask = np.zeros(region.shape[:2], np.float32)
    mask[y0 - by0:y1 - by0, x0 - bx0:x1 - bx0] = A[..., 0]
    mask = np.clip(mask + np.clip(bl.mean(2) * 8, 0, 1), 0, 1)
    region += (nz * mask)[..., None]
    cx = (Ww - OUT_W) // 2
    out = out[:, cx:cx + OUT_W]
    if G.get('caption', True):
        out = out * (1 - G['cap_a']) + G['cap_rgb'] * G['cap_a']
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), small_hits


def ensure_plate_size(path, W=1088, H=1920):
    """Plates must be 1088x1920 (the output is the centre 1080 columns). Another size (plate 7 is
    1072x1904) is scaled up uniformly to cover W x H (Lanczos), centre-cropped and cached as a
    near-lossless copy in %TEMP%/kts-plates; the audio is copied."""
    cap = cv2.VideoCapture(path)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    if (w, h) == (W, H):
        return path
    s = max(W / w, H / h)
    sw, sh = int(math.ceil(w * s / 2) * 2), int(math.ceil(h * s / 2) * 2)
    out = os.path.join(__import__('tempfile').gettempdir(), 'kts-plates',
                       f'{os.path.splitext(os.path.basename(path))[0]}.{int(os.path.getmtime(path))}.{W}x{H}.mp4')
    if not os.path.exists(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-map', '0:v:0', '-map', '0:a:0?',
                        '-vf', f'scale={sw}:{sh}:flags=lanczos,crop={W}:{H}', '-c:v', 'libx264', '-preset', 'slow',
                        '-crf', '8', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out], check=True)
        print(f'[plate] {w}x{h} scaled x{s:.4f} to {sw}x{sh}, cropped to {W}x{H}: {out}', flush=True)
    return out


def frames_of(path):
    cap = cv2.VideoCapture(path)
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        yield i, f
        i += 1
    cap.release()


def write_debug(path, raw, smooth, out_path):
    """Low-res video: raw corners (red), smoothed quad (magenta), zoom insets of 2 corners."""
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '544x960', '-r', '24',
                          '-i', '-', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out_path], stdin=subprocess.PIPE)
    for i, f in frames_of(path):
        small = cv2.resize(f, (544, 960), interpolation=cv2.INTER_AREA)
        sq = smooth[i] / 2
        cv2.polylines(small, [np.round(sq * 16).astype(np.int32)], True, (255, 0, 255), 1, cv2.LINE_AA, 4)
        for (x, y) in raw[i] / 2:
            cv2.circle(small, (int(x * 16), int(y * 16)), 3 * 16, (0, 0, 255), 1, cv2.LINE_AA, 4)
        # 8x insets of TL and BR at full res
        for k, (ox, oy) in ((0, (8, 8)), (2, (8, 136))):
            cx, cy = smooth[i][k]
            X, Y = int(cx) - 8, int(cy) - 8
            crop = f[max(0, Y):Y + 16, max(0, X):X + 16]
            if crop.shape[0] == 16 and crop.shape[1] == 16:
                z = cv2.resize(crop, (128, 128), interpolation=cv2.INTER_NEAREST)
                rx, ry = (raw[i][k] - [X, Y]) * 8
                sx, sy = (smooth[i][k] - [X, Y]) * 8
                cv2.circle(z, (int(rx), int(ry)), 4, (0, 0, 255), 1)
                cv2.drawMarker(z, (int(sx), int(sy)), (255, 255, 255), cv2.MARKER_CROSS, 10, 1)
                small[oy:oy + 128, ox:ox + 128] = z
                cv2.putText(small, ['TL', 'TR', 'BR', 'BL'][k], (ox + 2, oy + 14), 0, 0.45, (255, 255, 255), 1)
        cv2.putText(small, f'f{i:03d}  red=raw  magenta+cross=smoothed', (150, 950), 0, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        p.stdin.write(small.tobytes())
    p.stdin.close()
    p.wait()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('plate')
    ap.add_argument('out')
    ap.add_argument('--track', help='write the smoothed corner track JSON here')
    ap.add_argument('--debug', help='write a low-res corner debug video here')
    ap.add_argument('--stills', action='store_true', help='write <out>-t2/-t5/-t8.jpg from the encoded video')
    ap.add_argument('--aspect', type=float, default=0, help='board w/h (default: measured from the track)')
    ap.add_argument('--tex-h', type=int, default=0, help='texture height (default 1600 card / 1800 banner)')
    ap.add_argument('--sigma', type=float, default=4.0, help='temporal smoothing sigma in frames')
    ap.add_argument('--gain', type=float, default=0.95, help='board exposure (linear)')
    ap.add_argument('--led-px', type=float, default=3.0, help='LED pitch in output pixels at the narrowest edge')
    ap.add_argument('--led-contrast', type=float, default=0.14)
    ap.add_argument('--ground-spill', type=float, default=None,
                    help='frame height fraction below which green reflections are recoloured (wet ground)')
    ap.add_argument('--ground-tint', type=float, default=0.03)
    ap.add_argument('--fill-small', action='store_true',
                    help='also put the board on small rectangular pure-green screens (a phone in the crowd); check the '
                         'reported frame-hits equal the frame count, or the fill flickers')
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument('--frames', type=str, default='', help='render only these frames as PNGs, e.g. 12,48,100:104 (testing), no encode')
    ap.add_argument('--crf', type=int, default=18)
    ap.add_argument('--caption', action=argparse.BooleanOptionalAction, default=True,
                    help='burn the AI-composite caption into the picture (default on); the MP4 metadata label is '
                         'written either way')
    ap.add_argument('--caption-text', default=CAPTION, help='caption words (default: the original centred label)')
    ap.add_argument('--caption-pos', choices=('center', 'br'), default='center',
                    help='center: the original bottom-centre label; br: a small bottom-right corner label')
    a = ap.parse_args()
    a.plate = ensure_plate_size(a.plate)

    t0 = time.time()
    cache = os.path.join(__import__('tempfile').gettempdir(), 'kts-plates',
                         os.path.basename(a.plate) + f'.{int(os.path.getmtime(a.plate))}.{trk.LEVEL_FRAC}.npz')
    if a.frames and os.path.exists(cache):  # test renders reuse the raw track
        z = np.load(cache, allow_pickle=True)
        fps, size, raw, info = float(z['fps']), tuple(z['size']), z['raw'], list(z['info'])
    else:
        fps, size, raw, info = trk.track_video(a.plate)
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        np.savez(cache, fps=fps, size=np.array(size), raw=raw, info=np.array(info, dtype=object))
    smooth = trk.smooth_track(raw, a.sigma)
    t_track = time.time() - t0
    Wd = np.linalg.norm(smooth[:, 1] - smooth[:, 0], axis=1) / 2 + np.linalg.norm(smooth[:, 2] - smooth[:, 3], axis=1) / 2
    Hd = np.linalg.norm(smooth[:, 3] - smooth[:, 0], axis=1) / 2 + np.linalg.norm(smooth[:, 2] - smooth[:, 1], axis=1) / 2
    aspect = a.aspect or float(np.clip(np.median(Wd / Hd), 0.3, 2.0))
    texH = a.tex_h or (1300 if aspect >= 1.05 else 1600 if aspect >= 0.55 else 1800)
    texW = int(round(texH * aspect))
    min_w = float(np.minimum(np.linalg.norm(smooth[:, 1] - smooth[:, 0], axis=1),
                             np.linalg.norm(smooth[:, 2] - smooth[:, 3], axis=1)).min())
    led_cols = max(40, int(min_w / a.led_px))
    # texture pixels per 2x output pixel at the smallest part of the screen -> prefilter
    tex_blur = 0.5 * max(0.0, texW / (2 * min_w) - 1.0)
    # the plate's screen green in linear, the reference for re-lighting spill
    levels = [inf['level'] for inf in info if inf]
    g_screen = float(_LUT[245])
    resid = np.abs(raw - smooth)
    print(f'[track] {len(raw)} frames {t_track:.1f}s  aspect {aspect:.3f}  tex {texW}x{texH}  led cols {led_cols}  '
          f'raw-vs-smooth rms {np.sqrt((resid ** 2).mean()):.3f}px max {resid.max():.2f}px  key level {np.median(levels):.0f}',
          flush=True)

    if a.track:
        os.makedirs(os.path.dirname(os.path.abspath(a.track)), exist_ok=True)
        with open(a.track, 'w', encoding='utf-8') as fh:
            json.dump({'source': os.path.basename(a.plate), 'fps': fps, 'size': list(size),
                       'corner_order': ['tl', 'tr', 'br', 'bl'], 'coords': 'source pixels, pixel centres at integers',
                       'aspect': round(aspect, 4), 'smoothing': {'kind': 'local quadratic, gaussian weights', 'sigma_frames': a.sigma},
                       'frames': [[[round(float(x), 3), round(float(y), 3)] for x, y in q] for q in smooth]}, fh)
        print('[track] wrote', a.track)
    if a.debug:
        write_debug(a.plate, raw, smooth, a.debug)
        print('[debug] wrote', a.debug)

    cfg = dict(fps=fps, size=size, track=smooth, texW=texW, texH=texH, led_cols=led_cols, led_contrast=a.led_contrast,
               gain=a.gain, tex_blur=tex_blur, g_screen=g_screen, expand=0.5, spill_band=45.0, soften=0.6, wrap=0.35,
               bloom=[(6, 0.07), (22, 0.065), (70, 0.055)], bloom_pad=240, grain=1.6,
               ground_y=a.ground_spill, ground_tint=a.ground_tint, fill_small=a.fill_small,
               caption=a.caption, caption_text=a.caption_text, caption_pos=a.caption_pos)

    if a.frames:
        want = set()
        for part in a.frames.split(','):
            lo, _, hi = part.partition(':')
            want.update(range(int(lo), int(hi)) if hi else [int(lo)])
        init_worker(cfg)
        d = os.path.splitext(a.out)[0]
        for i, f in frames_of(a.plate):
            if i in want:
                img, hits = render_frame((i, f))
                cv2.imwrite(f'{d}-f{i:03d}.png', img)
                print('frame', i, 'small screens', hits, flush=True)
        return

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y',
                            '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{OUT_W}x{size[1]}', '-r', str(int(round(fps))), '-i', '-',
                            '-i', a.plate, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'copy',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', str(a.crf), '-pix_fmt', 'yuv420p',
                            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                            *META_ARGS, '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
    t1 = time.time()
    n = 0
    small_total = 0
    with Pool(a.workers, initializer=init_worker, initargs=(cfg,)) as pool:
        for img, hits in pool.imap(render_frame, frames_of(a.plate), chunksize=2):
            enc.stdin.write(img.tobytes())
            n += 1
            small_total += len(hits)
            if n % 48 == 0:
                print(f'[render] {n} frames {time.time() - t1:.1f}s', flush=True)
    enc.stdin.close()
    enc.wait()
    t_render = time.time() - t1
    print(f'[render] {n} frames in {t_render:.1f}s ({t_render / max(n, 1):.2f}s/frame, {a.workers} workers); '
          f'small screens filled in {small_total} frame-hits', flush=True)

    if a.stills:
        base = os.path.splitext(a.out)[0]
        for ts in (2, 5, 8):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ts), '-i', a.out, '-frames:v', '1', '-q:v', '2',
                            f'{base}-t{ts}.jpg'], check=True)
        print('[stills] wrote', base + '-t{2,5,8}.jpg')
    print(f'[done] total {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
