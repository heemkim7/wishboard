"""Multi-screen compositor for the WISH BOARD sample plates that composite.py does not cover:
two screens in one shot (a billboard and a phone held up in front of it), a crowd of small phone
screens tracked over the clip, a board wrapped round a building corner with an anamorphic pop-out,
and key-based mattes so snow, fingers and rounded corners stay in front of the board.

It reuses composite.py's look (LED grid, softening, spill remap, light wrap, bloom, grain, caption,
metadata label) and card.py's animated birthday card, all screens on the same clock.

Usage (from the repo root; music: tools/plates/music.py mix ... --music-db -5):
    # plate 4: NYE crowd; big screen keyed (snow stays on top), phones in the crowd tracked and filled
    python tools/plates/scene.py video/plate-04-front-night.mp4 out/2026-11-27/plates/sample-04-nye-cap.mp4 \
        --screens 1 --matte key --small-track --respill 0.72 --stills --caption-text "AI 합성" --caption-pos br
    # plate 5: billboard + handheld phone (phone: no LED grid, brighter, glass reflection, light smoothing)
    python tools/plates/scene.py video/plate-05-front-night.mp4 out/2026-11-27/plates/sample-05-phone-cap.mp4 \
        --screens 2 --styles led,phone --sigmas 4,2 --matte key --respill 0.88 --stills \
        --caption-text "AI 합성" --caption-pos br
    # plate 6: corner screen (two faces, card wraps round the fold, gift box pops out), sign neutralised
    python tools/plates/scene.py video/plate-06-front-night.mp4 out/2026-11-27/plates/sample-06-corner-cap.mp4 \
        --corner --matte key --respill 0.7 --stills --caption-text "AI 합성" --caption-pos br
    # plate 3: rainy night, wet-ground green reflections take the board colour (ground starts at 0.6 H)
    python tools/plates/scene.py video/plate-03-front-night.mp4 out/2026-11-27/plates/sample-03-rain-cap.mp4         --matte key --respill 0.6 --ground-tint 0.03 --stills --caption-text "AI 합성" --caption-pos br
    # plate 7: blue hour, 1072x1904 (scaled to cover 1088x1920 first, cached in %TEMP%/kts-plates)
    python tools/plates/scene.py video/plate-07-front-night.mp4 out/2026-11-27/plates/sample-07-dusk-cap.mp4         --matte key --respill 0.62 --ground-tint 0.02 --stills --caption-text "AI 합성" --caption-pos br
"""
import argparse
import math
import os
import subprocess
import sys
import time
from multiprocessing import Pool

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import composite as cp  # noqa: E402
import corner as co  # noqa: E402
import track as trk  # noqa: E402
from card import Card, PARTY  # noqa: E402

G = {}


# ------------------------------------------------------------------ textures
def phone_dressing(W, H):
    """Static parts of a phone screen in texture space: a dark app margin with rounded corners
    around the card (inset), and a faint glass reflection (diagonal band + top sheen)."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = x / W, y / H
    ins = 0.045
    rad = 0.07 * W
    m = np.zeros((H, W), np.uint8)
    cv2.rectangle(m, (0, 0), (W - 1, H - 1), 0, -1)
    x0, y0, x1, y1 = int(ins * W), int(ins * W), int(W - ins * W), int(H - ins * W)
    r = int(rad)
    cv2.rectangle(m, (x0 + r, y0), (x1 - r, y1), 255, -1)
    cv2.rectangle(m, (x0, y0 + r), (x1, y1 - r), 255, -1)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x1 - r, y1 - r), (x0 + r, y1 - r)):
        cv2.circle(m, (cx, cy), r, 255, -1, cv2.LINE_AA)
    inner = cv2.GaussianBlur(m.astype(np.float32) / 255.0, (0, 0), 1.2)
    deep = cp.srgb_float_to_lin(np.array(PARTY['deep'][::-1]) / 255.0) * 0.6
    band = np.exp(-(((u * 0.75 + v * 0.45) - 0.42) / 0.10) ** 2) * 0.045 + (1 - v) ** 3 * 0.025
    return dict(inner=inner[..., None], margin=deep.astype(np.float32), glass=band[..., None].astype(np.float32),
                box=(x0, y0, x1, y1))


def screen_texture(s, t):
    """Card frame at t -> linear BGR emission for screen s."""
    c = s['card'].frame(t)[..., ::-1]
    lin = cp.srgb_float_to_lin(c) * s['gain']
    if s['style'] == 'phone':
        dr = s['dress']
        x0, y0, x1, y1 = dr['box']
        full = np.empty_like(lin)
        full[:] = dr['margin']
        full[y0:y1, x0:x1] = cv2.resize(lin, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
        lin = full * dr['inner'] + dr['margin'] * (1 - dr['inner']) + dr['glass']
        if s['tex_blur'] > 0.3:
            lin = cv2.GaussianBlur(lin, (0, 0), s['tex_blur'])
        return lin.astype(np.float32)
    if s['kind'] == 'corner':
        lin = add_popout(s, lin, t)
    lin *= s['grid'][..., None]
    if s['tex_blur'] > 0.3:
        lin = cv2.GaussianBlur(lin, (0, 0), s['tex_blur'])
    return lin.astype(np.float32)


def face_rects(s):
    """Texture sub-rectangles (x0, x1) of the corner's two faces."""
    W = s['texW']
    xs = int(round(s['geo'].split * W))
    return ((0, xs), (xs, W))


def add_popout(s, lin, t):
    """Anamorphic pop-out: render the gift in the camera view, pull it back into each face's texture."""
    geo = s['geo']
    faces = geo.face_quads()
    allq = np.vstack(faces)
    m = 30
    x0, y0 = int(allq[:, 0].min()) - m, int(allq[:, 1].min()) - m
    x1, y1 = int(allq[:, 0].max()) + m, int(allq[:, 1].max()) + m
    r = s['gift'].render(t, x0, y0, x1 - x0, y1 - y0)
    if r is None:
        return lin
    rgb, al, sh = r
    rgb = rgb * s['gain']
    H = lin.shape[0]
    for (tx0, tx1), q in zip(face_rects(s), faces):
        src = np.float32([[tx0 - 0.5, -0.5], [tx1 - 0.5, -0.5], [tx1 - 0.5, H - 0.5], [tx0 - 0.5, H - 0.5]])
        dst = np.float32(q - [x0, y0])
        M = cv2.getPerspectiveTransform(src, dst)  # texture -> ROI image
        size = (lin.shape[1], H)
        Mi = M  # warpPerspective with WARP_INVERSE_MAP samples ROI at M @ texture coords
        a_t = cv2.warpPerspective(al, Mi, size, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
        c_t = cv2.warpPerspective(rgb, Mi, size, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
        s_t = cv2.warpPerspective(sh, Mi, size, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
        sl = slice(tx0, tx1)
        lin[:, sl] = lin[:, sl] * (1 - s_t[:, sl, None]) * (1 - a_t[:, sl, None]) + c_t[:, sl]
    return lin


# ------------------------------------------------------------------ warps
def warp_tex(tex, src_rects, quad_sets, x0, y0, w, h, expand):
    """Average of sub-frame warps. src_rects: texture sub-rectangles (x0, x1) mapped to the quads of
    each sub-frame (one quad per rect). Returns board (h, w, 3) and coverage (h, w)."""
    acc_b = np.zeros((2 * h, 2 * w, 3), np.float32)
    acc_q = np.zeros((2 * h, 2 * w), np.float32)
    H = tex.shape[0]
    for quads in quad_sets:
        b_sum = np.zeros_like(acc_b)
        q_sum = np.zeros_like(acc_q)
        for (tx0, tx1), q in zip(src_rects, quads):
            sub = np.ascontiguousarray(tex[:, tx0:tx1])
            sw = tx1 - tx0
            M = cp.tex_to_roi2(sw, H, q, x0, y0)
            ones = np.ones((H, sw), np.float32)
            b = cv2.warpPerspective(sub, M, (2 * w, 2 * h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            qq = cv2.warpPerspective(ones, M, (2 * w, 2 * h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                     borderValue=0)
            b_sum += b * qq[..., None]
            q_sum += qq
        # coverage from the outline expanded by `expand` px (all faces together)
        if len(quads) == 1:
            Me = cp.tex_to_roi2(tex.shape[1], H, cp.expand_quad(quads[0], expand), x0, y0)
            cov = cv2.warpPerspective(np.ones((H, tex.shape[1]), np.float32), Me, (2 * w, 2 * h), flags=cv2.INTER_LINEAR,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        else:
            cov = np.clip(q_sum, 0, 1)
            k = max(1, int(round(expand * 2)))
            cov = cv2.dilate(cov, np.ones((2 * k + 1, 2 * k + 1), np.uint8)) if expand > 0.25 else cov
        # replicate-border colour where the coverage extends past the warped faces
        bb = b_sum / np.maximum(q_sum, 1e-6)[..., None]
        if len(quads) > 1:
            fill = q_sum < 0.5
            if fill.any():
                near = cv2.dilate(bb, np.ones((5, 5), np.uint8))
                bb[fill] = near[fill]
        acc_b += bb
        acc_q += cov
    acc_b /= len(quad_sets)
    acc_q /= len(quad_sets)
    b = cv2.resize(acc_b, (w, h), interpolation=cv2.INTER_AREA)
    q = cv2.resize(acc_q, (w, h), interpolation=cv2.INTER_AREA)
    return b, np.clip(q, 0, 1)


# ------------------------------------------------------------------ one screen
def composite_screen(lin, d, s, i, t):
    Hh, Ww = d.shape
    if s['kind'] == 'corner':
        faces = s['geo'].face_quads()
        quad_sets = [faces]
        rects = face_rects(s)
    else:
        track = s['track']
        speed = max(np.linalg.norm(cp.quad_at(track, i + 0.5) - cp.quad_at(track, i - 0.5), axis=1))
        nsub = int(np.clip(math.ceil(speed * 0.5 / 0.4), 1, 6))
        quad_sets = [[cp.quad_at(track, i + k)] for k in (np.linspace(-0.25, 0.25, nsub) if nsub > 1 else [0.0])]
        rects = ((0, s['texW']),)
    allq = np.vstack([np.vstack(qs) for qs in quad_sets])
    m = int(max(40, s.get('spill_band', G['spill_band']) * 1.2))
    x0 = int(max(0, math.floor(allq[:, 0].min()) - m))
    y0 = int(max(0, math.floor(allq[:, 1].min()) - m))
    x1 = int(min(Ww, math.ceil(allq[:, 0].max()) + m))
    y1 = int(min(Hh, math.ceil(allq[:, 1].max()) + m))
    w, h = x1 - x0, y1 - y0

    tex = screen_texture(s, t)
    board, Q = warp_tex(tex, rects, quad_sets, x0, y0, w, h, G['expand'])
    roi_lin = lin[y0:y1, x0:x1]
    droi = d[y0:y1, x0:x1]
    inner = cv2.erode((Q > 0.999).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    level = float(np.median(droi[inner])) if inner.sum() > 100 else 200.0
    if G['matte'] == 'key':
        # soft key inside the outline: anything not screen-green (snow, fingers, the rounded corners'
        # bezel) keeps the plate; the remaining green in those pixels is remapped below
        key = np.clip((droi - 0.3 * level) / (0.4 * level), 0, 1)
        A = (Q * key)[..., None]
    else:
        K = np.clip((droi - 0.55 * level) / (0.3 * level), 0, 1)
        near = cv2.dilate((Q > 0.01).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        K[~near] = 0
        hole = (inner & (droi < 0.4 * level)).astype(np.uint8)
        hole = cv2.morphologyEx(hole, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        occl = 1 - cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 0.8)
        A = np.maximum(Q * occl, K)[..., None]

    small = cv2.resize(board, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
    local = cv2.resize(cv2.GaussianBlur(small, (0, 0), 5), (w, h), interpolation=cv2.INTER_LINEAR)
    g_screen = G['g_screen']
    # spill remap: all of the green excess within a few px of the edge (the AI plates light the bezel
    # lip green) and on clearly key-green pixels near the screen, fading out over the spill band
    dist = cv2.distanceTransform((Q < 0.5).astype(np.uint8), cv2.DIST_L2, 3)
    sb = s.get('spill_band', G['spill_band'])
    band = np.clip(1 - np.maximum(dist - 8, 0) / sb, 0, 1)
    keyish = np.clip((droi - 0.1 * level) / (0.2 * level), 0, 1) * (dist < 2 * sb)
    band = np.maximum(band, keyish)[..., None]
    gex = np.clip(roi_lin[..., 1] - np.maximum(roi_lin[..., 0], roi_lin[..., 2]), 0, None)[..., None]
    gx = gex * band
    bg = roi_lin.copy()
    bg[..., 1:2] -= gx
    bg += gx * local / g_screen
    B = cv2.GaussianBlur(board, (0, 0), G['soften'])
    wbg = cv2.GaussianBlur(bg * (1 - A), (0, 0), 5)
    wn = cv2.GaussianBlur((1 - A[..., 0]), (0, 0), 5)[..., None] + 1e-4
    wrap = (A[..., 0] * np.clip(1 - cv2.GaussianBlur(A[..., 0], (0, 0), 3), 0, 1) * G['wrap'])[..., None]
    B = B * (1 - wrap) + (wbg / wn) * wrap
    lin[y0:y1, x0:x1] = bg * (1 - A) + B * A
    avg = board[Q > 0.5].mean(0) if (Q > 0.5).any() else np.zeros(3, np.float32)
    return dict(box=(x0, y0, x1, y1), A=A, B=B, avg=avg, level=level, bloom=s['bloom'])


def fill_small_tracked(lin, d, level, tex, quads, dim=0.75):
    """quads: [(corners, detected this frame)]. Where the phone was not detected (a hand in front) only the
    key decides, so the hand stays on top."""
    texH, texW = tex.shape[:2]
    n = 0
    for q, seen in quads:
        if np.isnan(q).any():
            continue
        X0, Y0 = int(max(0, q[:, 0].min() - 5)), int(max(0, q[:, 1].min() - 5))
        X1, Y1 = int(min(lin.shape[1], q[:, 0].max() + 6)), int(min(lin.shape[0], q[:, 1].max() + 6))
        if X1 - X0 < 4 or Y1 - Y0 < 4:
            continue
        w, h = X1 - X0, Y1 - Y0
        qe = cp.expand_quad(q, 1.5)
        small = cv2.resize(tex, (max(8, w * 3), max(8, h * 3)), interpolation=cv2.INTER_AREA)
        src = np.float32([[0, 0], [small.shape[1], 0], [small.shape[1], small.shape[0]], [0, small.shape[0]]])
        M = cv2.getPerspectiveTransform(src, np.float32(qe - [X0, Y0]))
        b = cv2.warpPerspective(small, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        cov = cv2.warpPerspective(np.ones(small.shape[:2], np.float32), M, (w, h), flags=cv2.INTER_LINEAR,
                                  borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        dd = d[Y0:Y1, X0:X1]
        # the tracked rectangle is the phone's screen: fill all of it (a mottled 'camera preview' too)
        key = np.clip((dd - 0.2 * level) / (0.5 * level), 0, 1)
        if seen:  # a camera preview of the green screen is mottled: any green inside the rectangle counts
            core = cv2.erode(cov, np.ones((3, 3), np.uint8)) * np.clip((dd - 0.04 * level) / (0.08 * level), 0, 1)
            key = np.maximum(key, core)
        a = (key * cov)[..., None]
        roi = lin[Y0:Y1, X0:X1]
        gex = np.clip(roi[..., 1] - np.maximum(roi[..., 0], roi[..., 2]), 0, None)
        gex *= cv2.dilate(cov, np.ones((5, 5), np.uint8))
        roi[..., 1] -= gex
        roi[:] = roi * (1 - a) + b * dim * a
        n += 1
    return n


def respill(lin, y_from, avg, screen_mask, g_screen, tint=0.0, dim=0.7):
    """Green left outside the screens (wet-ground reflections, a green sign): green excess -> the board's
    average colour (dimmed), below y_from (the screens' own surroundings are done by their spill band)."""
    gy = int(y_from * lin.shape[0])
    gl = lin[gy:]
    gex = np.clip(gl[..., 1] - np.maximum(gl[..., 0], gl[..., 2]) * 1.05, 0, None)
    ramp = np.clip((np.arange(gl.shape[0]) / 60.0), 0, 1)[:, None]
    gex = gex * ramp * (1 - screen_mask[gy:])
    gl[..., 1] -= gex
    gl += gex[..., None] * (avg / g_screen)[None, None, :] * dim
    if tint:
        lum = gl.mean(2, keepdims=True)
        gl += np.clip(lum * 4, 0, 1) * avg[None, None, :] * tint * ramp[..., None]


def render_frame(args):
    i, frame = args
    t = i / G['fps']
    Hh, Ww = frame.shape[:2]
    lin = cp.to_lin(frame)
    d = trk.green_diff(frame)
    done = [composite_screen(lin, d, s, i, t) for s in G['screens']]
    mask = np.zeros((Hh, Ww), np.float32)
    for r in done:
        x0, y0, x1, y1 = r['box']
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], r['A'][..., 0])
    avg = done[0]['avg']
    hits = 0
    if G['small_tracks'] is not None:
        tex = screen_texture(G['screens'][0], t)
        hits = fill_small_tracked(lin, d, done[0]['level'], tex, [(tr[i], seen[i]) for tr, seen in G['small_tracks'].values()])
        for tr, seen in G['small_tracks'].values():
            q = tr[i]
            if not np.isnan(q).any():
                cv2.fillConvexPoly(mask, np.int32(np.round(cp.expand_quad(q, 3))), 1.0)
    if G['respill'] is not None:
        respill(lin, G['respill'], avg, mask, G['g_screen'], G['ground_tint'])
    if G['neutralise']:
        # any clearly key-green pixel left outside the screens (a tiny far-away phone, a green sign):
        # its green excess becomes the board colour, so no plate green survives anywhere
        fr = frame.astype(np.int16)
        mx = np.maximum(fr[..., 0], fr[..., 2])
        vivid = (d > 18) & (fr[..., 1] > 70) & (fr[..., 1] > 1.6 * mx)   # bright screen-green, not a dark green coat
        strong = (((d > 40) | vivid) & (mask < 0.5)).astype(np.uint8)
        if strong.any():
            strong = cv2.GaussianBlur(cv2.dilate(strong, np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 0.8)
            gex = np.clip(lin[..., 1] - np.maximum(lin[..., 0], lin[..., 2]), 0, None) * strong
            lin[..., 1] -= gex
            lin += gex[..., None] * (avg / G['g_screen'])[None, None, :] * 0.8

    # bloom per screen, then grain where we painted
    pad = G['bloom_pad']
    grain_mask = np.zeros((Hh, Ww), np.float32)
    for r in done:
        x0, y0, x1, y1 = r['box']
        E = r['B'] * r['A']
        bx0, by0, bx1, by1 = max(0, x0 - pad), max(0, y0 - pad), min(Ww, x1 + pad), min(Hh, y1 + pad)
        canvas = np.zeros((by1 - by0, bx1 - bx0, 3), np.float32)
        canvas[y0 - by0:y1 - by0, x0 - bx0:x1 - bx0] = E
        ds = 4
        cs = cv2.resize(canvas, (max(1, canvas.shape[1] // ds), max(1, canvas.shape[0] // ds)), interpolation=cv2.INTER_AREA)
        bl = np.zeros_like(cs)
        for sig, wt in G['bloom']:
            bl += cv2.GaussianBlur(cs, (0, 0), sig / ds) * wt * r['bloom']
        bl = cv2.resize(bl, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_LINEAR)
        lin[by0:by1, bx0:bx1] += bl
        grain_mask[by0:by1, bx0:bx1] = np.maximum(grain_mask[by0:by1, bx0:bx1], np.clip(bl.mean(2) * 8, 0, 1))
        grain_mask[y0:y1, x0:x1] = np.maximum(grain_mask[y0:y1, x0:x1], r['A'][..., 0])
    out = cp.to_srgb(lin)
    rng = np.random.default_rng(1000 + i)
    nz = rng.normal(0, G['grain'] / 255.0, (Hh, Ww)).astype(np.float32)
    nz = cv2.GaussianBlur(nz, (0, 0), 0.6) * 1.6
    out += (nz * grain_mask)[..., None]
    cx = (Ww - cp.OUT_W) // 2
    out = out[:, cx:cx + cp.OUT_W]
    if G['caption']:
        out = out * (1 - G['cap_a']) + G['cap_rgb'] * G['cap_a']
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), hits


def init_worker(cfg):
    G.update(cfg)
    for s in G['screens']:
        s['card'] = Card(s['texW'], s['texH'], G['fps'], layout=s.get('layout'))
        if s['style'] == 'phone':
            s['dress'] = phone_dressing(s['texW'], s['texH'])
        else:
            s['grid'] = cp.led_grid(s['texW'], s['texH'], s['led_cols'], G['led_contrast'])
        if s['kind'] == 'corner':
            s['geo'] = co.CornerGeometry(G['plate'])
            s['gift'] = co.GiftPop(s['geo'])
    if G['caption']:
        G['cap_rgb'], G['cap_a'] = cp.caption_layer(cp.OUT_W, G['size'][1], G['caption_text'], G['caption_pos'])
    cv2.setNumThreads(1)


def quad_dims(track):
    Wd = np.linalg.norm(track[:, 1] - track[:, 0], axis=1) / 2 + np.linalg.norm(track[:, 2] - track[:, 3], axis=1) / 2
    Hd = np.linalg.norm(track[:, 3] - track[:, 0], axis=1) / 2 + np.linalg.norm(track[:, 2] - track[:, 1], axis=1) / 2
    min_w = float(np.minimum(np.linalg.norm(track[:, 1] - track[:, 0], axis=1),
                             np.linalg.norm(track[:, 2] - track[:, 3], axis=1)).min())
    return float(np.median(Wd / Hd)), min_w


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('plate')
    ap.add_argument('out')
    ap.add_argument('--screens', type=int, default=1, help='track this many green screens (largest first)')
    ap.add_argument('--styles', default='led', help='per screen: led or phone (comma separated)')
    ap.add_argument('--sigmas', default='4', help='per screen temporal smoothing sigma in frames')
    ap.add_argument('--corner', action='store_true', help='one screen wrapped round a building corner (two faces)')
    ap.add_argument('--matte', choices=('geo', 'key'), default='key')
    ap.add_argument('--small-track', action='store_true', help='fill small phone screens, tracked over the clip')
    ap.add_argument('--respill', type=float, default=None,
                    help='frame height fraction below which leftover green is recoloured to the board colour')
    ap.add_argument('--ground-tint', type=float, default=0.0)
    ap.add_argument('--neutralise', action=argparse.BooleanOptionalAction, default=True,
                    help='recolour any key-green pixel left outside the screens (default on)')
    ap.add_argument('--gain', type=float, default=0.95)
    ap.add_argument('--phone-gain', type=float, default=1.15)
    ap.add_argument('--led-px', type=float, default=3.0)
    ap.add_argument('--led-contrast', type=float, default=0.14)
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument('--frames', default='', help='render only these frames as PNGs, e.g. 12,48,100:104')
    ap.add_argument('--crf', type=int, default=18)
    ap.add_argument('--stills', action='store_true')
    ap.add_argument('--caption', action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument('--caption-text', default=cp.CAPTION)
    ap.add_argument('--caption-pos', choices=('center', 'br'), default='center')
    a = ap.parse_args()
    t0 = time.time()
    plate = cp.ensure_plate_size(a.plate)
    cap = cv2.VideoCapture(plate)
    fps = cap.get(cv2.CAP_PROP_FPS)
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    styles = (a.styles.split(',') + ['led'] * a.screens)[:a.screens]
    sigmas = [float(x) for x in a.sigmas.split(',')]
    sigmas = (sigmas + [sigmas[-1]] * a.screens)[:a.screens]
    screens = []
    if a.corner:
        geo = co.CornerGeometry(plate)
        texH = 1600
        texW = int(round(texH * geo.aspect))
        left, right = geo.face_quads()
        min_w = min(np.linalg.norm(left[1] - left[0]), np.linalg.norm(right[1] - right[0]))
        led_cols = max(40, int((np.linalg.norm(left[1] - left[0]) + np.linalg.norm(right[1] - right[0])) / a.led_px))
        screens.append(dict(kind='corner', style='led', layout='corner', texW=texW, texH=texH, led_cols=led_cols,
                            tex_blur=0.5 * max(0.0, texH / (2 * np.linalg.norm(left[1] - left[2])) - 1.0),
                            gain=a.gain, bloom=1.0))
        print(f'[corner] faces wL {geo.wL:.3f} wR {geo.wR:.3f} (fold heights), split {geo.split:.3f}, camera fit '
              f'max reprojection {geo.reproj:.2f}px, camera at {np.round(geo.C, 3).tolist()}, tex {texW}x{texH}, '
              f'fold samples {geo.info["fold_samples"]}', flush=True)
        level = geo.info['level']
    else:
        for k in range(a.screens):
            fps_, size_, raw, info = trk.track_video_rank(plate, k)
            smooth = trk.smooth_track(raw, sigmas[k])
            aspect, min_w = quad_dims(smooth)
            st = styles[k]
            if st == 'phone':
                texH = 1400
            else:
                texH = 1300 if aspect >= 1.05 else (1600 if aspect >= 0.55 else 1800)
            texW = int(round(texH * aspect))
            resid = np.abs(raw - smooth)
            levels = [inf['level'] for inf in info if inf]
            print(f'[track] screen {k} ({st}): aspect {aspect:.3f} tex {texW}x{texH} sigma {sigmas[k]} '
                  f'raw-vs-smooth rms {np.sqrt((resid ** 2).mean()):.3f}px max {resid.max():.2f}px key level '
                  f'{np.median(levels):.0f}', flush=True)
            screens.append(dict(kind='quad', style=st, track=smooth, texW=texW, texH=texH,
                                led_cols=max(40, int(min_w / a.led_px)),
                                tex_blur=0.5 * max(0.0, texW / (2 * min_w) - 1.0),
                                gain=a.phone_gain if st == 'phone' else a.gain, bloom=0.35 if st == 'phone' else 1.0,
                                spill_band=110.0 if st == 'phone' else 45.0))
            if k == 0:
                level = float(np.median(levels))
    small_tracks = None
    if a.small_track:
        main = screens[0]

        def exclude(i):
            m = np.zeros((size[1], size[0]), bool)
            q = main['track'][min(i, len(main['track']) - 1)]
            x0, y0 = int(q[:, 0].min()) - 30, int(q[:, 1].min()) - 30
            x1, y1 = int(q[:, 0].max()) + 30, int(q[:, 1].max()) + 30
            m[max(0, y0):y1, max(0, x0):x1] = True
            if a.respill is not None:
                m[int(a.respill * size[1]):] = True
            return m

        small_tracks, nf = trk.track_small(plate, exclude, level, n_frames)
        print(f'[small] {len(small_tracks)} phone screens tracked', flush=True)
    cfg = dict(plate=plate, fps=fps, size=size, screens=screens, matte=a.matte, small_tracks=small_tracks,
               respill=a.respill, ground_tint=a.ground_tint, neutralise=a.neutralise, led_contrast=a.led_contrast, g_screen=float(cp._LUT[245]),
               expand=0.5, spill_band=45.0, soften=0.6, wrap=0.35, bloom=[(6, 0.07), (22, 0.065), (70, 0.055)],
               bloom_pad=240, grain=1.6, caption=a.caption, caption_text=a.caption_text, caption_pos=a.caption_pos)
    if a.frames:
        want = set()
        for part in a.frames.split(','):
            lo, _, hi = part.partition(':')
            want.update(range(int(lo), int(hi)) if hi else [int(lo)])
        init_worker(cfg)
        base = os.path.splitext(a.out)[0]
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        for i, f in cp.frames_of(plate):
            if i in want:
                img, hits = render_frame((i, f))
                cv2.imwrite(f'{base}-f{i:03d}.png', img)
                print('frame', i, 'small screens', hits, flush=True)
        return
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s',
                            f'{cp.OUT_W}x{size[1]}', '-r', str(int(round(fps))), '-i', '-', '-i', plate,
                            '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'slow',
                            '-crf', str(a.crf), '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709',
                            '-color_trc', 'bt709', *cp.META_ARGS, '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
    t1 = time.time()
    n = 0
    hits = []
    with Pool(a.workers, initializer=init_worker, initargs=(cfg,)) as pool:
        for img, h in pool.imap(render_frame, cp.frames_of(plate), chunksize=2):
            enc.stdin.write(img.tobytes())
            n += 1
            hits.append(h)
            if n % 48 == 0:
                print(f'[render] {n} frames {time.time() - t1:.1f}s', flush=True)
    enc.stdin.close()
    enc.wait()
    print(f'[render] {n} frames in {time.time() - t1:.1f}s; small screens per frame min {min(hits)} max {max(hits)}',
          flush=True)
    if a.stills:
        base = os.path.splitext(a.out)[0]
        for ts in (2, 5, 8):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ts), '-i', a.out, '-frames:v', '1', '-q:v', '2',
                            f'{base}-t{ts}.jpg'], check=True)
        print('[stills] wrote', base + '-t{2,5,8}.jpg')
    print(f'[done] total {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
