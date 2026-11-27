"""In-app assets for 실사 축하 영상 (docs/superpowers/specs/2026-11-27-real-video-design.md section 2).

For each plate video/plate-0N-*.mp4 it writes into assets/plates/:
  plate-0N.mp4   1080x1920 (the centre of the 1088-wide plate; plate 7 is scaled up to cover first),
                 24 fps, 241 frames, H.264 High yuv420p, faststart, the plate's audio as AAC mono 64 kb/s,
                 at most 8,000,000 bytes (the lowest CRF that fits, checked for key quality)
  plate-0N.jpg   360x640 preview of the plate alone at 5 s, at most 40 KB
  plate-0N.json  per-frame screen corners in the 1080x1920 output frame (format below)
and assets/plates/index.json. Music: assets/plates/music-<occ>.m4a (music.py export).

JSON (v1):
  { "v":1, "id":"01", "name":"정면 밤", "w":1080, "h":1920, "fps":24, "frames":241, "flash":1.5,
    "ground": {"y":0.74, "tint":0.03} | null,
    "screens": [ { "kind":"led"|"phone"|"small", "layout":"card"|"banner"|"wide"|"corner", "aspect":0.70,
                   "corners": [[[x,y]x4] per frame]            (not for layout "corner")
                   "faces": [{"corners":[...]}, {"corners":[...]}], "split":0.48   (layout "corner"; face 0 = left)
                   "vis": [1,0,...]                            (small screens: 1 = tracked in that frame)
                 } ] }
  Corners are TL, TR, BR, BL in output pixels (pixel centres at integers), rounded to 0.1 px (small
  screens: whole pixels). Plate 6 also carries "camera": a 3x4 matrix from world (fold-height units:
  fold = Y axis, right face Z=0 / X in [0, wR], left face X=0 / Z in [0, wL]) to output pixels.

Usage (from the repo root):
    python tools/plates/export.py --all            # plates, previews, JSON, music, index, then --check
    python tools/plates/export.py --plates 05 06   # just these plates (video, preview, JSON) + index
    python tools/plates/export.py --json --plates 04   # only the JSON
    python tools/plates/export.py --music          # the six music files
    python tools/plates/export.py --check          # validate sizes, frame counts, JSON shape, key quality
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import composite as cp  # noqa: E402
import corner as co  # noqa: E402
import track as trk  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'plates')
W, H, FPS, FRAMES, FLASH = 1080, 1920, 24, 241, 1.5
MAX_MP4 = 8_000_000
MAX_JPG = 40_000
MAX_JSON = 120_000
CROP_X = 4  # the 1088-wide plate's left crop

# id: (source, name, ground {y, tint} or None, screens spec)
PLATES = {
    '01': ('plate-01-front-night.mp4', '정면 밤', dict(y=0.74, tint=0.03), dict(kind='quad', n=1, small=True)),
    '02': ('plate-02-front-night-up.mp4', '타워', None, dict(kind='quad', n=1)),
    '03': ('plate-03-front-night.mp4', '비 오는 밤', dict(y=0.6, tint=0.03), dict(kind='quad', n=1)),
    '04': ('plate-04-front-night.mp4', '연말 군중', dict(y=0.72, tint=0.0), dict(kind='quad', n=1, small=True)),
    '05': ('plate-05-front-night.mp4', '내 손 휴대폰', dict(y=0.88, tint=0.0), dict(kind='quad', n=2, styles=('led', 'phone'),
                                                                               sigmas=(4.0, 2.0))),
    '06': ('plate-06-front-night.mp4', '코너 입체', dict(y=0.7, tint=0.0), dict(kind='corner')),
    '07': ('plate-07-front-night.mp4', '블루아워', dict(y=0.62, tint=0.02), dict(kind='quad', n=1)),
}
SMALL_MIN_W = 12.0  # small phones narrower than this (px) are left to the compositor's green clean-up


def src_path(pid):
    return cp.ensure_plate_size(os.path.join(ROOT, 'video', PLATES[pid][0]))


def layout_for(aspect, kind):
    if aspect >= 1.05:
        return 'wide'
    return 'card' if aspect >= 0.55 else 'banner'


# ------------------------------------------------------------------ video
def encode(src, dst, crf, maxrate=None):
    vf = f'crop={W}:{H}:{CROP_X}:0'
    args = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-r', str(FPS),
            '-frames:v', str(FRAMES), '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', str(crf),
            '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    if maxrate:
        args += ['-maxrate', maxrate, '-bufsize', maxrate]
    args += ['-c:a', 'aac', '-ac', '1', '-b:a', '64k', '-ar', '48000', *cp.META_ARGS, '-movflags', '+faststart', dst]
    subprocess.run(args, check=True)
    return os.path.getsize(dst)


def gray_frames(path, every=20, crop=False):
    vf = f'select=not(mod(n\\,{every}))' + (f',crop={W}:{H}:{CROP_X}:0' if crop else '')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:v:0', '-vf', vf, '-vsync', '0', '-f', 'rawvideo',
                          '-pix_fmt', 'bgr24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def key_quality(src, enc):
    """How well the encoded file still keys like the source: on every 20th frame, the green mask
    (G - max(R,B) > half the screen level) IoU, the mean |key difference| in a 3 px band round the mask
    edge, and pixels that flip between clearly green and clearly not."""
    a = gray_frames(src, crop=True)
    b = gray_frames(enc)
    n = min(len(a), len(b))
    ious, band_err, flips = [], [], 0
    for i in range(n):
        da, db = trk.green_diff(a[i]), trk.green_diff(b[i])
        lv = float(np.percentile(da[da > 60], 50)) if (da > 60).any() else 200.0
        ma, mb = da > 0.5 * lv, db > 0.5 * lv
        ious.append((ma & mb).sum() / max(1, (ma | mb).sum()))
        edge = cv2.dilate(ma.astype(np.uint8), np.ones((7, 7), np.uint8)) - cv2.erode(ma.astype(np.uint8), np.ones((7, 7), np.uint8))
        band_err.append(float(np.abs(da - db)[edge > 0].mean()) / lv)
        flips += int(((da > 0.6 * lv) & (db < 0.3 * lv)).sum() + ((da < 0.15 * lv) & (db > 0.45 * lv)).sum())
    return dict(iou=float(np.mean(ious)), iou_min=float(np.min(ious)), edge_err=float(np.mean(band_err)),
                flips_per_frame=flips / max(1, n))


def export_video(pid, crfs=(20, 22, 24, 26, 28, 30, 32)):
    src = src_path(pid)
    dst = os.path.join(OUT, f'plate-{pid}.mp4')
    for crf in crfs:
        size = encode(src, dst, crf)
        if size <= MAX_MP4 * 0.97:
            break
    else:
        size = encode(src, dst, crfs[-1], maxrate='5800k')
    kq = key_quality(src, dst)
    print(f'[video] plate-{pid}.mp4 crf {crf} {size:,} B  key IoU {kq["iou"]:.4f} (min {kq["iou_min"]:.4f}) '
          f'edge err {kq["edge_err"]:.3f} of level, flips/frame {kq["flips_per_frame"]:.1f}', flush=True)
    return dict(crf=crf, size=size, key=kq)


def export_preview(pid):
    src = os.path.join(OUT, f'plate-{pid}.mp4')
    dst = os.path.join(OUT, f'plate-{pid}.jpg')
    for q in (4, 6, 8, 10, 12, 15):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '5', '-i', src, '-frames:v', '1', '-vf', 'scale=360:640:flags=lanczos',
                        '-q:v', str(q), dst], check=True)
        if os.path.getsize(dst) <= MAX_JPG * 0.95:
            break
    print(f'[jpg] plate-{pid}.jpg q {q} {os.path.getsize(dst):,} B', flush=True)


# ------------------------------------------------------------------ tracks
def to_out(q, nd=1):
    q = np.asarray(q, float) - [CROP_X, 0]
    return [[round(float(x), nd) if nd else int(round(x)), round(float(y), nd) if nd else int(round(y))] for x, y in q]


def quad_aspect(track):
    Wd = np.linalg.norm(track[:, 1] - track[:, 0], axis=1) / 2 + np.linalg.norm(track[:, 2] - track[:, 3], axis=1) / 2
    Hd = np.linalg.norm(track[:, 3] - track[:, 0], axis=1) / 2 + np.linalg.norm(track[:, 2] - track[:, 1], axis=1) / 2
    return float(np.median(Wd / Hd))


def export_json(pid):
    srcname, name, ground, spec = PLATES[pid]
    src = src_path(pid)
    screens = []
    extra = {}
    if spec['kind'] == 'corner':
        geo = co.CornerGeometry(src)
        left, right = geo.face_quads()
        n = FRAMES
        screens.append(dict(kind='led', layout='corner', aspect=round(geo.aspect, 4),
                            faces=[dict(corners=[to_out(left)] * n), dict(corners=[to_out(right)] * n)],
                            split=round(geo.split, 4)))
        # world -> output pixels: shift x by the crop
        T = np.array([[1, 0, -CROP_X], [0, 1, 0], [0, 0, 1]], float)
        P = T @ geo.P
        P = P / np.abs(P).max()
        extra['camera'] = dict(P=[[round(float(v), 7) for v in row] for row in P], wL=round(geo.wL, 4), wR=round(geo.wR, 4),
                               units='fold height')
        print(f'[json] {pid} corner: wL {geo.wL:.3f} wR {geo.wR:.3f} split {geo.split:.3f} reproj {geo.reproj:.2f}px', flush=True)
    else:
        main = None
        styles = spec.get('styles', ('led',) * spec['n'])
        sigmas = spec.get('sigmas', (4.0,) * spec['n'])
        for k in range(spec['n']):
            _, _, raw, info = trk.track_video_rank(src, k)
            sm = trk.smooth_track(raw, sigmas[k])
            asp = quad_aspect(sm)
            kind = 'phone' if styles[k] == 'phone' else 'led'
            screens.append(dict(kind=kind, layout=layout_for(asp, kind), aspect=round(asp, 4),
                                corners=[to_out(q) for q in sm]))
            if k == 0:
                main = sm
                level = float(np.median([inf['level'] for inf in info if inf]))
            res = np.abs(raw - sm)
            print(f'[json] {pid} screen {k} {kind}: aspect {asp:.3f} raw-vs-smooth rms {np.sqrt((res ** 2).mean()):.3f}px',
                  flush=True)
        if spec.get('small'):
            gy = ground['y'] if ground else None

            def exclude(i):
                m = np.zeros((1920, 1088), bool)
                q = main[min(i, len(main) - 1)]
                m[max(0, int(q[:, 1].min()) - 30):int(q[:, 1].max()) + 30, max(0, int(q[:, 0].min()) - 30):int(q[:, 0].max()) + 30] = True
                if gy is not None:
                    m[int(gy * 1920):] = True
                return m

            tracks, nf = trk.track_small(src, exclude, level, FRAMES)
            kept = 0
            for tid, (arr, seen) in tracks.items():
                ok = ~np.isnan(arr[:, 0, 0])
                wmed = float(np.nanmedian(np.linalg.norm(arr[:, 1] - arr[:, 0], axis=1)))
                if wmed < SMALL_MIN_W:
                    continue
                idx = np.nonzero(ok)[0]
                filled = arr.copy()
                for i in range(len(arr)):
                    if not ok[i]:
                        filled[i] = arr[idx[np.argmin(np.abs(idx - i))]]
                asp = quad_aspect(filled)
                screens.append(dict(kind='small', layout=layout_for(asp, 'small'), aspect=round(asp, 4),
                                    corners=[to_out(q, 0) for q in filled], vis=[int(v) for v in ok]))
                kept += 1
            print(f'[json] {pid} small screens: {kept} kept of {len(tracks)} tracked (narrower than {SMALL_MIN_W:g}px dropped)',
                  flush=True)
    doc = dict(v=1, id=pid, name=name, w=W, h=H, fps=FPS, frames=FRAMES, flash=FLASH, ground=ground, screens=screens, **extra)
    path = os.path.join(OUT, f'plate-{pid}.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'[json] plate-{pid}.json {os.path.getsize(path):,} B, {len(screens)} screens', flush=True)


# ------------------------------------------------------------------ music, index, checks
def export_music():
    import music
    for occ in music.OCC_KEYS:
        music.export_m4a(occ, os.path.join(OUT, f'music-{occ}.m4a'))


def write_index():
    import music
    plates = []
    for pid, (srcname, name, ground, spec) in PLATES.items():
        e = dict(id=pid, name=name)
        for ext in ('mp4', 'jpg', 'json'):
            f = f'plate-{pid}.{ext}'
            p = os.path.join(OUT, f)
            e[ext] = f
            e[ext + 'Bytes'] = os.path.getsize(p) if os.path.exists(p) else None
        plates.append(e)
    mus = []
    for occ in music.OCC_KEYS:
        f = f'music-{occ}.m4a'
        p = os.path.join(OUT, f)
        mus.append(dict(occ=occ, file=f, bytes=os.path.getsize(p) if os.path.exists(p) else None))
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(dict(v=1, w=W, h=H, fps=FPS, frames=FRAMES, flash=FLASH, plates=plates, music=mus), fh,
                  ensure_ascii=False, indent=1)
    print('[index] index.json written', flush=True)


def validate_json(doc):
    errs = []
    req = dict(v=int, id=str, name=str, w=int, h=int, fps=int, frames=int, flash=(int, float), screens=list)
    for k, t in req.items():
        if not isinstance(doc.get(k), t):
            errs.append(f'{k} missing or not {t}')
    if doc.get('v') != 1 or doc.get('w') != W or doc.get('h') != H or doc.get('fps') != FPS or doc.get('frames') != FRAMES:
        errs.append('v/w/h/fps/frames mismatch')
    g = doc.get('ground', 'missing')
    if g == 'missing' or not (g is None or (isinstance(g, dict) and 0 < g.get('y', -1) < 1 and isinstance(g.get('tint'), (int, float)))):
        errs.append('ground must be null or {y in (0,1), tint}')
    n = doc.get('frames', 0)

    def quads_ok(cs, what):
        if not isinstance(cs, list) or len(cs) != n:
            errs.append(f'{what}: {len(cs) if isinstance(cs, list) else "no"} quads, want {n}')
            return
        for q in cs:
            if not (isinstance(q, list) and len(q) == 4 and all(isinstance(p, list) and len(p) == 2 and
                                                               all(isinstance(v, (int, float)) for v in p) for p in q)):
                errs.append(f'{what}: bad quad {q}')
                return

    for i, s in enumerate(doc.get('screens', [])):
        what = f'screen {i}'
        if s.get('kind') not in ('led', 'phone', 'small'):
            errs.append(f'{what}: kind')
        if s.get('layout') not in ('card', 'banner', 'wide', 'corner'):
            errs.append(f'{what}: layout')
        if not isinstance(s.get('aspect'), (int, float)):
            errs.append(f'{what}: aspect')
        if s.get('layout') == 'corner':
            if 'corners' in s or not (isinstance(s.get('faces'), list) and len(s['faces']) == 2) or not isinstance(s.get('split'), float):
                errs.append(f'{what}: corner needs faces[2] + split and no corners')
            else:
                for j, f in enumerate(s['faces']):
                    quads_ok(f.get('corners'), f'{what} face {j}')
        else:
            quads_ok(s.get('corners'), what)
        if 'vis' in s and (len(s['vis']) != n or any(v not in (0, 1) for v in s['vis'])):
            errs.append(f'{what}: vis')
    return errs


def check():
    import music
    ok = True
    for pid in PLATES:
        mp4, jpg, js = (os.path.join(OUT, f'plate-{pid}.{e}') for e in ('mp4', 'jpg', 'json'))
        pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-count_packets', '-show_entries',
                                        'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_packets,channels,bit_rate',
                                        '-of', 'json', mp4], capture_output=True, text=True).stdout)['streams']
        v = [s for s in pr if s['codec_type'] == 'video'][0]
        a = [s for s in pr if s['codec_type'] == 'audio']
        with open(mp4, 'rb') as fh:
            head = fh.read(200)
        faststart = head.find(b'moov') != -1 and (head.find(b'mdat') == -1 or head.find(b'moov') < head.find(b'mdat'))
        doc = json.load(open(js, encoding='utf-8'))
        errs = validate_json(doc)
        sizes = (os.path.getsize(mp4), os.path.getsize(jpg), os.path.getsize(js))
        good = (sizes[0] <= MAX_MP4 and sizes[1] <= MAX_JPG and sizes[2] <= MAX_JSON and v['width'] == W and v['height'] == H
                and int(v['nb_read_packets']) == FRAMES and v['pix_fmt'] == 'yuv420p' and v['profile'] == 'High'
                and v['r_frame_rate'] == '24/1' and a and a[0]['channels'] == 1 and faststart and not errs)
        ok &= good
        jim = cv2.imread(jpg)
        print(f'[check] {pid} {"OK " if good else "BAD"} mp4 {sizes[0]:,} B {v["profile"]} {v["width"]}x{v["height"]} '
              f'{v["nb_read_packets"]} frames, audio {a[0]["codec_name"] if a else "-"} {a[0]["channels"] if a else 0}ch '
              f'{int(a[0]["bit_rate"]) // 1000 if a else 0} kb/s, faststart {faststart}; jpg {sizes[1]:,} B {jim.shape[1]}x{jim.shape[0]}; '
              f'json {sizes[2]:,} B {len(doc["screens"])} screens {errs or ""}')
    for occ in music.OCC_KEYS:
        p = os.path.join(OUT, f'music-{occ}.m4a')
        x = music.read_audio(p)
        lu, pk = music.lufs(x), 20 * np.log10(np.abs(x).max())
        size = os.path.getsize(p)
        good = size <= 200_000 and abs(lu + 19) <= 0.6 and pk <= -3 and abs(len(x) / music.SR - FRAMES / FPS) < 0.03
        ok &= good
        print(f'[check] music-{occ}.m4a {"OK " if good else "BAD"} {size:,} B {len(x) / music.SR:.3f} s {lu:.2f} LUFS peak {pk:.2f} dBFS')
    print('[check]', 'all OK' if ok else 'PROBLEMS above')
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--plates', nargs='*', help='plate ids (default all)')
    ap.add_argument('--json', action='store_true', help='only the JSON for the given plates')
    ap.add_argument('--music', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ids = a.plates or list(PLATES)
    if a.all or a.plates is not None:
        for pid in ids:
            if not a.json:
                export_video(pid)
                export_preview(pid)
            export_json(pid)
    if a.all or a.music:
        export_music()
    if a.all or a.plates is not None or a.music:
        write_index()
    if a.all or a.check:
        sys.exit(0 if check() else 1)


if __name__ == '__main__':
    main()
