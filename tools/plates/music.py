"""Original soundtrack for the WISH BOARD sample videos, synthesized in code.

Every sound here is made from sines, additive partials and seeded noise: no samples, no
soundfonts, no downloaded audio, so nothing in the result can match a Content ID
reference when someone posts the clip. "Happy Birthday to You" (Hill sisters, 1893;
public domain) is the only borrowed material: its first two lines, re-harmonised and
arranged here (Em7 / D / Cmaj9-D9 / Gmaj9 under the tune instead of I-V-V-I).

A clip's score follows the board on the screen (card.py), 24 fps, 241 frames:
  0.00-1.50  standby and charge-up: a D-chord pad opening, a shimmer whose tremolo
             speeds up, a rising noise band, a heartbeat, a reversed bell swell.
  1.50       the white flash (card.T_FLASH, frame 36): the hit. Sub thump, bell chord,
             glitter and a sparkle burst, a whoosh, a small synthesized cheer and claps.
  1.50-8.17  the tune on an FM electric piano with a waltz groove (3/4, 108 bpm):
             kick on 1, soft claps on 2 and 3, shaker eighths, a falling bass line, pad
             chords and piano stabs, glockenspiel sparkles for the confetti and sheens.
  8.17-end   the final Gmaj9, a glockenspiel arpeggio, ring-out, a 0.3 s fade.

Usage (from the repo root):
    python tools/plates/music.py render bday out/2026-11-27/plates/bgm-bday.wav --png
    python tools/plates/music.py mix out/2026-11-27/plates/sample-01-front.mp4 \
        out/2026-11-27/plates/sample-01-front-bgm.mp4 --music out/2026-11-27/plates/bgm-bday.wav
    python tools/plates/music.py check out/2026-11-27/plates/sample-01-front-bgm.mp4
  the owner's cut (corner "AI 합성" label from composite.py, music 5 dB down, street at the same absolute level):
    python tools/plates/music.py mix out/2026-11-27/plates/sample-01-front-cap.mp4         out/2026-11-27/plates/sample-01-front-final.mp4 --music out/2026-11-27/plates/bgm-bday.wav --music-db -5

New occasions: write a score function like `bday` (key, tempo, tune, chords, bass,
drums, sparkles) and register it in OCCASIONS; `perform` plays any score with the same
instruments, intro and hit.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d, uniform_filter1d

SR = 48000
FPS = 24
FRAMES = 241                 # the sample clips: 241 frames = 10.0417 s
T_FLASH = 36 / FPS           # card.T_FLASH: the flash peaks on frame 36
TARGET_LUFS = -14.0
CEILING_DB = -1.5            # sample peak; leaves room for AAC inter-sample overs (<= -1 dBTP)
FADE_OUT = 0.3


# ------------------------------------------------------------------ small helpers
def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def _t(m):
    return np.arange(m) / SR


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, dtype=float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def env(m, a=0.004, tau=1.0, sus=0.0, hold=None, rel=0.1):
    """Raised-cosine attack, exponential decay toward `sus`, raised-cosine release at `hold`.
    Starts at 0 and (with hold + rel <= m / SR) ends at 0, so notes never click."""
    t = _t(m)
    e = sus + (1 - sus) * np.exp(-np.maximum(t - a, 0) / tau)
    e = e * np.where(t < a, 0.5 - 0.5 * np.cos(np.pi * t / max(a, 1e-6)), 1.0)
    if hold is not None:
        e = e * (0.5 + 0.5 * np.cos(np.pi * np.clip((t - hold) / rel, 0, 1)))
    return e


def tail(y, sec=0.01):
    """Fade the last `sec` of a note to zero (belt and braces against clicks)."""
    k = min(len(y), int(sec * SR))
    if k > 1:
        w = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k))
        y = y.copy()
        y[-k:] *= w if y.ndim == 1 else w[:, None]
    return y


def phase(freq, m):
    """Running phase (radians) of a possibly time-varying frequency, starting at 0."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (m,))
    p = np.cumsum(f) / SR
    return 2 * np.pi * (p - f[0] / SR)


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def pan_gains(p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.cos(a) * math.sqrt(2), np.sin(a) * math.sqrt(2)


def stft_shape(x, mask_fn, nper=1024):
    """Time-varying filter: multiply the STFT by mask_fn(freq[:, None], time[None, :])."""
    f, tt, Z = signal.stft(x, SR, nperseg=nper, noverlap=nper * 3 // 4)
    _, y = signal.istft(Z * mask_fn(f[:, None], tt[None, :]), SR, nperseg=nper, noverlap=nper * 3 // 4)
    y = y[:len(x)]
    return np.pad(y, (0, len(x) - len(y)))


# ------------------------------------------------------------------ mixer
class Mixer:
    """Dry bus, reverb send bus, and per-stem copies for the level report."""

    def __init__(self, n):
        self.n = n
        self.dry = np.zeros((n, 2))
        self.send = np.zeros((n, 2))
        self.stems = {}

    def add(self, t0, sig, gain=1.0, pan=0.0, send=0.0, stem='misc'):
        sig = np.asarray(sig, dtype=float)
        if sig.ndim == 1:
            gl, gr = pan_gains(pan)
            sig = np.stack([sig * gl, sig * gr], 1)
        i0 = int(round(t0 * SR))
        j0 = 0
        if i0 < 0:
            j0, i0 = -i0, 0
        m = min(len(sig) - j0, self.n - i0)
        if m <= 0:
            return
        seg = sig[j0:j0 + m] * gain
        self.dry[i0:i0 + m] += seg
        if send:
            self.send[i0:i0 + m] += seg * send
        st = self.stems.get(stem)
        if st is None:
            st = self.stems[stem] = np.zeros((self.n, 2))
        st[i0:i0 + m] += seg


# ------------------------------------------------------------------ reverb (Freeverb-style Schroeder)
_COMBS = (1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
_APS = (556, 441, 341, 225)
_SPREAD = 23


def _comb(x, D, fb, damp):
    """w[n] = x[n] + fb * lp(w)[n - D], y[n] = w[n - D]; vectorised a delay-length block at a time."""
    n = len(x)
    w = np.empty(n)
    prev = np.zeros(D)
    last = 0.0
    for s in range(0, n, D):
        xb = x[s:s + D]
        wb = xb + fb * prev[:len(xb)]
        lpb, _ = signal.lfilter([1 - damp], [1, -damp], wb, zi=[damp * last])
        last = lpb[-1]
        prev = lpb
        w[s:s + len(xb)] = wb
    y = np.zeros(n)
    y[D:] = w[:n - D]
    return y


def _allpass(x, D, g=0.5):
    n = len(x)
    u = np.empty(n)
    prev = np.zeros(D)
    for s in range(0, n, D):
        xb = x[s:s + D]
        ub = xb + g * prev[:len(xb)]
        u[s:s + len(xb)] = ub
        prev = ub
    ud = np.zeros(n)
    ud[D:] = u[:n - D]
    return ud - x


def reverb(x, room=0.8, damp=0.45, width=0.9, pre=0.016, lo=180.0, hi=7000.0):
    """Stereo in, stereo wet out (8 lowpass-feedback combs + 4 allpasses per side)."""
    k = SR / 44100.0
    inp = signal.sosfilt(sos('highpass', lo), (x[:, 0] + x[:, 1]) * 0.5)
    p = int(pre * SR)
    inp = np.concatenate([np.zeros(p), inp[:len(inp) - p]])
    fb = room * 0.28 + 0.7
    d = damp * 0.4
    outs = []
    for sp in (0, _SPREAD):
        acc = np.zeros(len(inp))
        for c in _COMBS:
            acc += _comb(inp, int((c + sp) * k), fb, d)
        for a in _APS:
            acc = _allpass(acc, int((a + sp) * k))
        outs.append(acc)
    w1, w2 = width / 2 + 0.5, (1 - width) / 2
    out = np.stack([outs[0] * w1 + outs[1] * w2, outs[1] * w1 + outs[0] * w2], 1) * 0.04
    return signal.sosfilt(sos('lowpass', hi), out, axis=0)


# ------------------------------------------------------------------ loudness (ITU-R BS.1770-4) and the limiter
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def _kblocks(x, blk=0.4, hop=0.1):
    y = signal.lfilter(*_K1, x, axis=0)
    y = signal.lfilter(*_K2, y, axis=0)
    b, h = int(blk * SR), int(hop * SR)
    c = np.cumsum(np.concatenate([np.zeros((1, y.shape[1])), y ** 2]), 0)
    idx = np.arange(0, len(y) - b + 1, h)
    return ((c[idx + b] - c[idx]) / b).sum(1)


def lufs(x):
    ms = _kblocks(x)
    lk = -0.691 + 10 * np.log10(np.maximum(ms, 1e-20))
    g = ms[lk > -70]
    if not len(g):
        return -100.0
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = ms[lk > rel]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def limit(x, ceiling_db=CEILING_DB, look=0.003, release=0.12):
    """Peak limiter: 3 ms look-ahead attack, exponential release; the gain is never above what
    each sample's peak needs, so the output stays under the ceiling. A soft knee rounds the top."""
    c = 10 ** (ceiling_db / 20)
    v = np.maximum(0.0, 1.0 - c / np.maximum(np.abs(x).max(1), 1e-12))   # gain reduction each sample needs
    L = max(3, int(look * SR)) | 1
    b = uniform_filter1d(maximum_filter1d(v, 2 * L + 1), L)                # >= v at every sample
    h = b.copy()
    coef = math.exp(-1.0 / (release * SR))
    nz = np.flatnonzero(b > 0)
    if len(nz):
        prev = 0.0
        for i in range(nz[0], len(h)):
            prev = max(h[i], prev * coef)
            h[i] = prev
            if prev < 1e-7 and b[i] == 0 and i > nz[-1]:
                break
    y = x * (1 - h)[:, None]
    knee = 0.9 * c
    a = np.abs(y)
    over = a > knee
    y[over] = np.sign(y[over]) * (knee + (c - knee) * np.tanh((a[over] - knee) / (c - knee)))
    return y


def master(x, target=TARGET_LUFS, ceiling_db=CEILING_DB, fade=FADE_OUT):
    x = signal.sosfiltfilt(sos('highpass', 28.0), x, axis=0)
    x = signal.sosfiltfilt(sos('lowpass', 17500.0), x, axis=0)
    x = x - x.mean(0)
    for _ in range(3):
        x = x * 10 ** ((target - lufs(limit(x, ceiling_db))) / 20)
    y = limit(x, ceiling_db)
    k = int(fade * SR)
    y[-k:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k)))[:, None]
    y[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))[:, None]
    return y


# ------------------------------------------------------------------ instruments
def ep(f, dur, vel=0.8, rng=None, rel=0.28, tau=None, vib=0.0026, bright=1.0):
    """FM electric piano: a ratio-1 modulator (warm body) and a short high 'tine' modulator,
    two chorus voices +-5 cents to the sides, gentle delayed vibrato. Returns stereo."""
    m = int((dur + rel) * SR)
    t = _t(m)
    r = rng if rng is not None else np.random.default_rng(0)
    tau = tau or float(np.clip(1.5 * (440 / f) ** 0.5, 0.6, 2.4))
    r2 = float(np.clip(round(9000 / f), 3, 13))
    vibenv = smoothstep(0.2, 0.7, t)
    vrate = 5.1 + r.uniform(-0.3, 0.3)
    vph = r.uniform(0, 2 * np.pi)
    i1 = bright * vel * (1.5 * np.exp(-t / 0.28) + 0.38)
    i2 = bright * vel * 0.6 * np.exp(-t / 0.015)
    amp = env(m, a=0.002, tau=tau, hold=dur, rel=rel) * (0.78 + 0.22 * np.exp(-t / 0.07))

    def voice(cents, k1=1.0):
        fv = f * 2 ** (cents / 1200) * (1 + vib * np.sin(2 * np.pi * vrate * t + vph) * vibenv)
        pc = phase(fv, m)
        return np.sin(pc + k1 * i1 * np.sin(pc) + i2 * np.sin(r2 * pc))

    main = voice(0.0)
    cl, cr = voice(-5.0, 0.7), voice(5.0, 0.7)
    out = np.stack([main + 0.32 * cl, main + 0.32 * cr], 1) * (amp * vel / 1.32)[:, None]
    return tail(out)


def pluck(f, dur, vel=0.8, rng=None, rel=0.12, tau=0.32, sus=0.22):
    """Bright pop pluck: additive saw (band-limited at 9 kHz) whose upper harmonics die faster,
    two voices +-6 cents to the sides. Returns stereo."""
    m = int((dur + rel) * SR)
    t = _t(m)
    out = np.zeros((m, 2))
    for ch, cents in ((0, -6.0), (1, 6.0)):
        fd = f * 2 ** (cents / 1200)
        ph = 2 * np.pi * fd * t
        y = np.zeros(m)
        for k in range(1, int(9000 // fd) + 1):
            y += np.sin(k * ph) / k * np.exp(-t * (2.0 + 9.0 * k * fd / 2000))
        out[:, ch] = y
    e = env(m, a=0.002, tau=tau, sus=sus, hold=dur, rel=rel)
    return tail(out * (e * vel * 0.6)[:, None])


def brass(f, dur, vel=0.8, rng=None, rel=0.14):
    """Synth brass: additive saw through a moving low-pass (opens on the attack, settles), slow attack,
    delayed vibrato, two voices +-5 cents. Returns stereo."""
    m = int((dur + rel) * SR)
    t = _t(m)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.4 * t) * smoothstep(0.25, 0.6, t)
    fc = f * (1.6 + 4.5 * vel * (1 - np.exp(-t / 0.045)) * (0.55 + 0.45 * np.exp(-t / 0.25)))
    out = np.zeros((m, 2))
    for ch, cents in ((0, -5.0), (1, 5.0)):
        fd = f * 2 ** (cents / 1200)
        ph = phase(fd * vib, m)
        y = np.zeros(m)
        for k in range(1, int(8000 // fd) + 1):
            y += np.sin(k * ph) / k / np.sqrt(1 + (k * fd / fc) ** 4)
        out[:, ch] = y
    e = env(m, a=0.028, tau=0.5, sus=0.75, hold=dur, rel=rel)
    return tail(out * (e * vel * 0.5)[:, None])


def mallet(f, dur, vel=0.8, rng=None, rel=0.1):
    """Marimba-like mallet: fundamental, a tuned 4th partial that dies fast, a soft knock."""
    m = int((dur + rel + 0.3) * SR)
    t = _t(m)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.55) + 0.35 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.06)
    if 10 * f < 15000:
        y += 0.08 * np.sin(2 * np.pi * 10 * f * t) * np.exp(-t / 0.015)
    e = env(m, a=0.0015, tau=1e9, sus=1.0, hold=dur + 0.3, rel=rel)
    return tail(np.stack([y, y], 1) * (e * vel * 0.8)[:, None])


def sine_bell(f, dur, vel=0.5, tau=0.6):
    m = int((dur + 0.2) * SR)
    t = _t(m)
    y = np.sin(2 * np.pi * f * t) * env(m, a=0.003, tau=tau, hold=dur, rel=0.2)
    return tail(y * vel)


def glock(f, vel=0.5, length=1.8):
    """Free bar partials (1, 2.756, 5.404, 8.933), higher ones dying first; nothing above 15 kHz."""
    m = int(length * SR)
    t = _t(m)
    y = np.zeros(m)
    for ratio, a, tau in ((1.0, 1.0, 1.1), (2.756, 0.30, 0.28), (5.404, 0.12, 0.09), (8.933, 0.05, 0.035)):
        if f * ratio > 15000:
            continue
        y += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    y *= np.where(t < 0.0012, 0.5 - 0.5 * np.cos(np.pi * t / 0.0012), 1.0)
    return tail(y * vel, 0.05)


def bell(f, vel=0.6, length=2.8):
    """Bright struck bell for the hit: a hum partial, near-harmonic partials and two stretched ones."""
    m = int(length * SR)
    t = _t(m)
    y = np.zeros(m)
    for ratio, a, tau in ((0.5, 0.10, 1.8), (1.0, 1.0, 1.5), (2.0, 0.45, 0.8), (3.0, 0.25, 0.45),
                          (4.2, 0.16, 0.26), (5.4, 0.10, 0.16), (6.8, 0.05, 0.09)):
        if f * ratio > 14000:
            continue
        y += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    y *= np.where(t < 0.0015, 0.5 - 0.5 * np.cos(np.pi * t / 0.0015), 1.0)
    return tail(y * vel, 0.08)


def bass(f, dur, vel=0.8, rel=0.09):
    m = int((dur + rel) * SR)
    t = _t(m)
    ph = 2 * np.pi * f * t
    y = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.10 * np.sin(3 * ph) + 0.14 * np.exp(-t / 0.05) * np.sin(4 * ph)
    return tail(y * env(m, a=0.005, tau=0.9, sus=0.45, hold=dur, rel=rel) * vel)


def pad(notes, dur, rng, a=0.14, rel=0.45, hmax=4200.0, rolloff=1.2):
    """Additive band-limited saw (harmonics stop at hmax), three detuned voices per note, spread."""
    m = int((dur + rel) * SR)
    t = _t(m)
    out = np.zeros((m, 2))
    for i, n in enumerate(notes):
        f = float(midi_hz(n))
        for det, p in ((-7, -0.6), (0, 0.0), (7, 0.6)):
            fd = f * 2 ** (det / 1200)
            ph = 2 * np.pi * fd * t + rng.uniform(0, 2 * np.pi)
            y = np.zeros(m)
            for k in range(1, int(hmax // fd) + 1):
                y += np.sin(k * ph + rng.uniform(0, 2 * np.pi)) / k ** rolloff
            gl, gr = pan_gains(p * (1 if i % 2 else -1))
            out[:, 0] += y * gl
            out[:, 1] += y * gr
    e = env(m, a=a, tau=1e9, sus=1.0, hold=dur, rel=rel)
    return tail(out * (e / (3 * len(notes)))[:, None])


def kick(rng, vel=1.0):
    m = int(0.42 * SR)
    t = _t(m)
    f = 47 + 90 * np.exp(-t / 0.03)
    body = np.sin(phase(f, m)) * env(m, a=0.0012, tau=0.17)
    click = signal.sosfilt(sos('bandpass', [1500, 5000]), rng.standard_normal(m)) * np.exp(-t / 0.004) * 0.25
    return tail((body + click) * vel)


def clap(rng, vel=1.0):
    m = int(0.35 * SR)
    t = _t(m)
    nz = signal.sosfilt(sos('bandpass', [900, 2800], 4), rng.standard_normal((m, 2)), axis=0)
    e = np.zeros(m)
    for d in (0.0, 0.009, 0.018):
        td = np.maximum(t - d, 0)
        e += np.where(t >= d, np.exp(-td / 0.004), 0)
    e += 0.5 * np.where(t >= 0.025, np.exp(-np.maximum(t - 0.025, 0) / 0.055), 0)
    e *= np.where(t < 0.0008, t / 0.0008, 1.0)
    return tail(nz * (e * vel * 0.5)[:, None])


def shaker(rng, vel=1.0):
    m = int(0.16 * SR)
    t = _t(m)
    nz = signal.sosfilt(sos('bandpass', [5000, 11000], 4), rng.standard_normal(m))
    e = smoothstep(0, 0.012, t) * np.exp(-np.maximum(t - 0.012, 0) / 0.03)
    return tail(nz * e * vel)


def noise_burst(rng, m, band, tau, att=0.002):
    t = _t(m)
    nz = signal.sosfilt(sos('bandpass', band, 4), rng.standard_normal((m, 2)), axis=0)
    e = smoothstep(0, att, t) * np.exp(-t / tau)
    return tail(nz * e[:, None])


# ------------------------------------------------------------------ the shared intro, hit and cheer
def intro(mx, t_hit, rng, chord=(50, 57, 62, 66), shimmer=(86, 90, 93, 98), beat=0.5556):
    """0 .. t_hit: dominant pad opening up, accelerating shimmer, rising noise, heartbeat."""
    m = int(t_hit * SR)
    t = _t(m)
    rise = smoothstep(0.0, t_hit, t)
    # pad: fades in, the lowpass opens from 500 Hz to 3.5 kHz with the charge-up
    p = pad(chord, t_hit + 0.2, rng, a=0.4, rel=0.05)[:m]
    lvl = (0.35 + 0.65 * rise ** 1.6) * (1 - smoothstep(t_hit - 0.03, t_hit, t))
    cut = lambda f, tt: 1 / np.sqrt(1 + (f / (500 * 7 ** np.clip(tt / t_hit, 0, 1) ** 1.5)) ** 4)
    p = np.stack([stft_shape(p[:, c], cut) for c in (0, 1)], 1) * lvl[:, None]
    mx.add(0.0, p, gain=0.5, send=0.3, stem='intro-pad')
    # shimmer: high D-chord sines, tremolo from 3 to 16 Hz
    rate = 3 + 13 * rise ** 2
    trem = 0.55 + 0.45 * np.sin(phase(rate, m))
    sh = np.zeros((m, 2))
    for i, n in enumerate(shimmer):
        y = np.sin(2 * np.pi * float(midi_hz(n)) * t + rng.uniform(0, 6.28)) * trem
        gl, gr = pan_gains(0.5 if i % 2 else -0.5)
        sh[:, 0] += y * gl
        sh[:, 1] += y * gr
    sh *= (smoothstep(0.25, t_hit, t) ** 2 * (1 - smoothstep(t_hit - 0.025, t_hit, t)) * 0.07)[:, None]
    mx.add(0.0, sh, send=0.5, stem='intro-shimmer')
    # rising noise band, 400 Hz -> 7 kHz, cut 20 ms before the hit (the "inhale")
    nz = rng.standard_normal((m, 2))
    band = lambda f, tt: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / (400 * 17.5 ** np.clip(tt / t_hit, 0, 1) ** 1.4)) / 0.8) ** 2)
    nz = np.stack([stft_shape(nz[:, c], band) for c in (0, 1)], 1)
    ne = smoothstep(0.1, t_hit - 0.02, t) ** 2.4 * (1 - smoothstep(t_hit - 0.035, t_hit - 0.012, t))
    mx.add(0.0, nz * ne[:, None], gain=0.08, send=0.25, stem='intro-riser')
    # heartbeat on the tempo grid: lub-dub, lub-dub, then two quickening thumps
    def thump(v, f0=58, tau=0.11):
        k = int(0.4 * SR)
        tk = _t(k)
        y = np.sin(phase(f0 * (1 + 0.6 * np.exp(-tk / 0.02)), k)) * env(k, a=0.004, tau=tau)
        return tail(signal.sosfilt(sos('lowpass', 220), y) * v)
    beat = min(beat, 0.56)
    for tb, v in ((t_hit - 2 * beat, 0.55), (t_hit - beat, 0.7), (t_hit - beat / 2, 0.6), (t_hit - beat / 4, 0.62)):
        mx.add(tb, thump(v), gain=0.6, stem='intro-heart')
        if v in (0.55, 0.7):
            mx.add(tb + 0.17, thump(v * 0.6, 52, 0.09), gain=0.6, stem='intro-heart')


def hit(mx, t, rng, chord=(67, 71, 74, 79, 81), sparkle=(86, 88, 91, 93, 95, 98, 100, 103), step=0.0694,
        cheer_on=True):
    """The flash: sub thump, bell chord, glock cascade, glitter, sparkle noise, reversed swell,
    whoosh and (optionally) a small crowd cheer with claps."""
    # sub thump + click
    m = int(0.9 * SR)
    tt = _t(m)
    sub = np.sin(phase(41 + 75 * np.exp(-tt / 0.045), m)) * env(m, a=0.0012, tau=0.3)
    mx.add(t, tail(sub), gain=0.7, stem='hit-sub')
    mx.add(t, noise_burst(rng, int(0.05 * SR), [1800, 6000], 0.006, 0.0005), gain=0.12, stem='hit-sub')
    # bell chord, spread
    bc = np.zeros((int(2.8 * SR), 2))
    for i, n in enumerate(chord):
        y = bell(float(midi_hz(n)), 0.5 if i else 0.6)
        gl, gr = pan_gains((i - (len(chord) - 1) / 2) / len(chord) * 0.9)
        bc[:, 0] += y * gl
        bc[:, 1] += y * gr
    mx.add(t, bc, gain=0.3, send=0.35, stem='hit-bell')
    # reversed reverb swell of the same chord, ending just before the hit
    wet = reverb(np.concatenate([bc, np.zeros((int(0.5 * SR), 2))]), room=0.85)
    on = int(np.argmax(np.abs(wet).max(1) > 1e-3 * np.abs(wet).max()))
    sw = wet[on:on + int(1.0 * SR)][::-1].copy()
    sw *= (smoothstep(0, len(sw), np.arange(len(sw))) ** 2)[:, None]
    sw = tail(sw, 0.004)
    mx.add(t - len(sw) / SR - 0.004, sw / (np.abs(sw).max() + 1e-12), gain=0.22, stem='intro-swell')
    # glock cascade with the confetti burst
    for i, n in enumerate(sparkle):
        mx.add(t + i * step, glock(float(midi_hz(n)), 0.5 - 0.03 * i), gain=0.2, pan=((i * 0.37) % 1.2) - 0.6,
               send=0.4, stem='glock')
    # sparkle noise (air) and glitter pings
    mx.add(t, noise_burst(rng, int(1.2 * SR), [6000, 14000], 0.22), gain=0.08, send=0.3, stem='hit-sparkle')
    tg = 0.0
    while True:
        tg += rng.exponential(1 / 70.0) * math.exp(tg / 0.45)
        if tg > 1.4:
            break
        k = int(0.06 * SR)
        tk = _t(k)
        f = rng.uniform(4000, 9500)
        y = np.sin(2 * np.pi * f * tk) * np.exp(-tk / rng.uniform(0.008, 0.02)) * np.minimum(1, tk / 0.0006)
        mx.add(t + tg, tail(y), gain=0.05 * math.exp(-tg / 0.6) * rng.uniform(0.4, 1), pan=rng.uniform(-0.85, 0.85),
               send=0.3, stem='hit-sparkle')
    # whoosh: a noise band sweeping up and across, left to right
    m = int(1.1 * SR)
    tt = _t(m)
    nz = rng.standard_normal(m)
    band = lambda f, ts: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / (300 * 9 ** np.clip(ts / 0.35, 0, 1))) / 0.7) ** 2)
    w = stft_shape(nz, band) * (smoothstep(0, 0.12, tt) * np.exp(-np.maximum(tt - 0.12, 0) / 0.28))
    pl = np.clip(-0.7 + 1.4 * tt / 0.8, -0.7, 0.7)
    gl, gr = pan_gains(pl)
    mx.add(t - 0.03, tail(np.stack([w * gl, w * gr], 1)), gain=0.12, send=0.4, stem='hit-whoosh')
    if cheer_on:
        mx.add(t + 0.02, cheer(rng), gain=1.4, send=0.55, stem='hit-cheer')
        mx.add(t + 0.06, applause(rng), gain=1.3, send=0.45, stem='hit-cheer')


_VOWELS = {'u': ((320, 1.0), (800, 0.35), (2300, 0.12)),
           'a': ((760, 1.0), (1150, 0.55), (2600, 0.22)),
           'e': ((520, 1.0), (1850, 0.4), (2600, 0.2))}


def _formant(x, vowel, shift=1.0):
    y = np.zeros_like(x)
    for f, a in _VOWELS[vowel]:
        b, aa = signal.iirpeak(f * shift, 4.5, fs=SR)
        y += a * signal.lfilter(b, aa, x)
    return y


def cheer(rng, voices=24, length=1.9):
    """A small distant 'whoo-ah': breathy formant voices with a rising-then-falling pitch."""
    m = int(length * SR)
    out = np.zeros((m, 2))
    for _ in range(voices):
        on = rng.exponential(0.09)
        L = rng.uniform(0.55, 1.25)
        k = int(L * SR)
        i0 = int(on * SR)
        if i0 + k > m:
            k = m - i0
        if k < SR // 10:
            continue
        t = _t(k)
        f0 = rng.uniform(190, 400) if rng.uniform() < 0.65 else rng.uniform(120, 180)
        semis = rng.uniform(2, 5) * smoothstep(0, 0.13, t) - rng.uniform(3, 7) * smoothstep(0.13, L, t) ** 1.3
        semis += 0.25 * np.sin(2 * np.pi * rng.uniform(3, 6) * t + rng.uniform(0, 6.28))
        f = f0 * 2 ** (semis / 12)
        ph = phase(f, k)
        voiced = np.zeros(k)
        for h in range(1, int(4500 // (f0 * 1.5)) + 1):
            voiced += np.sin(h * ph + rng.uniform(0, 6.28)) / h ** 1.4
        voiced /= np.sqrt(np.mean(voiced ** 2)) + 1e-9
        breath = rng.standard_normal(k)
        src = 0.4 * voiced + 0.6 * breath
        sh = rng.uniform(0.92, 1.12) * (1.12 if f0 > 185 else 1.0)
        x = smoothstep(0.04, 0.3, t)
        y = (1 - x) * _formant(src, 'u', sh) + x * _formant(src, 'a' if rng.uniform() < 0.7 else 'e', sh)
        e = smoothstep(0, rng.uniform(0.07, 0.18), t) * (1 - smoothstep(L * 0.45, L, t))
        y = y * e * rng.uniform(0.5, 1.0)
        gl, gr = pan_gains(rng.uniform(-0.85, 0.85))
        out[i0:i0 + k, 0] += y * gl
        out[i0:i0 + k, 1] += y * gr
    out = signal.sosfiltfilt(sos('bandpass', [220, 6500]), out, axis=0)
    return tail(out / (np.abs(out).max() + 1e-12) * 0.09, 0.05)


def applause(rng, length=2.0):
    """Claps from the crowd: short band-passed noise bursts at Poisson times, quickly thinning."""
    m = int(length * SR)
    out = np.zeros((m, 2))
    banks = [signal.sosfilt(sos('bandpass', [c * 0.6, c * 1.6]), rng.standard_normal(SR)) for c in
             (900, 1200, 1500, 1900, 2400)]
    tc = 0.0
    while True:
        tc += rng.exponential(1 / 55.0) * math.exp(tc / 0.55)
        if tc > length - 0.1:
            break
        k = int(0.04 * SR)
        tk = _t(k)
        b = banks[rng.integers(len(banks))]
        s0 = rng.integers(0, SR - k)
        y = b[s0:s0 + k] * np.exp(-tk / rng.uniform(0.004, 0.011)) * np.minimum(1, tk / 0.0004)
        g = rng.uniform(0.3, 1.0) * math.exp(-tc / 0.8) * smoothstep(0, 0.12, tc)
        gl, gr = pan_gains(rng.uniform(-0.9, 0.9))
        i0 = int(tc * SR)
        out[i0:i0 + k, 0] += tail(y) * g * gl
        out[i0:i0 + k, 1] += tail(y) * g * gr
    return tail(out / (np.abs(out).max() + 1e-12) * 0.07, 0.05)


# ------------------------------------------------------------------ scores
def bday(t_hit=T_FLASH, dur=FRAMES / FPS):
    """Happy Birthday, lines 1-2, G major, 3/4, 108 bpm; beat 0 is the hit (bar 0 = the hit bar)."""
    G2, A2, B2, C2, D2, E2, Fs2 = 43, 45, 47, 36, 38, 40, 42
    chords = [  # (beat, voicing, name)
        (0, (55, 59, 62, 69), 'Gadd9'),
        (3, (52, 55, 59, 62), 'Em7'),
        (6, (54, 57, 62, 64), 'Dadd9'),
        (8, (54, 57, 60, 64), 'D9'),
        (9, (52, 55, 59, 62), 'Cmaj9'),      # C bass under the Em7 shape
        (11, (54, 57, 60, 64), 'D9'),
        (12, (55, 59, 62, 66, 69), 'Gmaj9'),
    ]
    return dict(
        name='bday', key='G major', meter=3, bpm=108.0, t_hit=t_hit, dur=dur,
        intro=dict(chord=(50, 57, 62, 66), shimmer=(86, 90, 93, 98)),
        hit=dict(chord=(67, 71, 74, 79, 81), sparkle=(86, 88, 91, 93, 95, 98, 100, 103)),
        # (beat, length in beats, midi, velocity): "Hap-py birth-day to you, hap-py birth-day to you"
        melody=[(2.0, 0.75, 74, 0.80), (2.75, 0.25, 74, 0.62), (3, 1, 76, 0.92), (4, 1, 74, 0.80), (5, 1, 79, 0.92),
                (6, 2, 78, 0.88), (8.0, 0.75, 74, 0.80), (8.75, 0.25, 74, 0.62), (9, 1, 76, 0.92), (10, 1, 74, 0.80),
                (11, 1, 81, 0.98), (12, 3.0, 79, 0.95)],
        lyrics='Hap-py birth-day to you, hap-py birth-day to you',
        chords=chords,
        stabs=[4, 5, 7, 8, 10, 11],                       # piano "pah-pah" on 2 and 3
        bass=[(0, 1.9, G2), (2, 0.9, Fs2), (3, 1.9, E2), (5, 0.9, B2), (6, 1.9, D2), (8, 0.9, A2),
              (9, 1.9, C2), (11, 0.9, D2), (12, 3.2, G2)],
        kick=[(3, 1.0), (5.5, 0.45), (6, 1.0), (8.5, 0.45), (9, 1.0), (12, 0.9)],
        clap=[(4, 0.8), (5, 0.62), (7, 0.8), (8, 0.62), (10, 0.8), (11, 0.66)],
        shaker=[(b / 2, 1.0 if b % 2 else 0.55) for b in range(2, 22)] +
               [(11.25, 0.7), (11.75, 0.85)],
        sparkle_density=0.4,
        sheens=(3.0, 6.1),                                 # card.py sheen passes (8.6 is in the ending arpeggio)
        pings=[(1.5, 98), (2.5, 95)],                      # glock answers between the pickup notes
        ending=dict(beat=12, arp=(91, 95, 98, 102, 105), last=(13.5, 103)),
        final_ep=(55, 59, 62, 66),
    )


def _common(t_hit, dur):
    return dict(t_hit=t_hit, dur=dur, sparkle_density=0.4, sheens=(3.0, 6.1), shaker=[], kick=[], clap=[], stabs=[])


def anniv_score(t_hit=T_FLASH, dur=FRAMES / FPS):
    """기념일: warm and romantic. F major, 3/4, 84 bpm; piano with soft bells, no beat but a soft pulse.
    Fadd9 | Dm7 | Bbmaj7 C7 | Fmaj9. Original tune."""
    sc = _common(t_hit, dur)
    sc.update(
        name='anniv', key='F major', meter=3, bpm=84.0,
        intro=dict(chord=(48, 55, 58, 64), shimmer=(84, 88, 91, 94)),
        hit=dict(chord=(65, 69, 72, 77, 79), sparkle=(84, 86, 89, 91, 93, 96, 98, 101)),
        melody=[(2.0, 1, 72, 0.70), (3, 1.5, 77, 0.85), (4.5, 0.5, 76, 0.62), (5, 1, 74, 0.72),
                (6, 1, 74, 0.80), (7, 0.5, 72, 0.62), (7.5, 0.5, 70, 0.62), (8, 0.5, 70, 0.66), (8.5, 0.5, 67, 0.6),
                (9, 3.0, 69, 0.85)],
        chords=[(0, (53, 57, 60, 67), 'Fadd9'), (3, (50, 53, 57, 60), 'Dm7'), (6, (46, 50, 53, 57), 'Bbmaj7'),
                (8, (48, 52, 55, 58), 'C7'), (9, (53, 57, 60, 64, 67), 'Fmaj9')],
        stabs=[4, 5, 7], stab_len=0.6,
        bass=[(0, 2.8, 41), (3, 2.8, 38), (6, 1.9, 34), (8, 0.9, 36), (9, 3.0, 41)],
        kick=[(3, 0.45), (6, 0.45), (9, 0.5)], kick_gain=0.7,
        shaker=[(b + 0.5, 0.45) for b in range(2, 9)],
        lead='ep', lead_gain=0.4, bell_layer=0.22, pad_gain=0.36, pad_cut=2000,
        pings=[(1.0, 96), (2.5, 93)],
        ending=dict(beat=9, arp=(89, 93, 96, 100, 101), last=(10.5, 101)),
        final_ep=(53, 57, 60, 64),
    )
    return sc


def pass_score(t_hit=T_FLASH, dur=FRAMES / FPS):
    """합격: triumphant and upbeat. C major, 4/4, 112 bpm; synth brass fanfare, kick 1 and 3, claps on 2
    and 4, a snare-roll lift into the last chord. C | F | G G7 | C. Original tune."""
    sc = _common(t_hit, dur)
    sc.update(
        name='pass', key='C major', meter=4, bpm=112.0,
        intro=dict(chord=(43, 50, 53, 59), shimmer=(86, 89, 91, 95)),
        hit=dict(chord=(60, 64, 67, 72, 76), sparkle=(84, 86, 88, 91, 93, 96, 98, 100)),
        melody=[(2.0, 0.5, 67, 0.75), (2.5, 0.5, 72, 0.78), (3.0, 0.5, 76, 0.82), (3.5, 0.5, 79, 0.86),
                (4, 1.5, 81, 0.95), (5.5, 0.5, 79, 0.75), (6, 0.5, 77, 0.78), (6.5, 0.5, 76, 0.75), (7, 1, 77, 0.85),
                (8, 1, 79, 0.92), (9, 0.5, 74, 0.75), (9.5, 0.5, 79, 0.8), (10, 1, 83, 0.92), (11, 0.5, 86, 0.9),
                (11.5, 0.5, 83, 0.82), (12, 3.0, 84, 1.0)],
        chords=[(0, (60, 64, 67, 72), 'C'), (4, (53, 57, 60, 65), 'F'), (8, (55, 59, 62, 67), 'G'),
                (10, (55, 59, 62, 65), 'G7'), (12, (52, 55, 60, 62, 67), 'Cadd9')],
        stabs=[1, 1.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5], stab_len=0.25,
        bass=[(0, 1.9, 36), (2, 0.9, 36), (3, 0.9, 43), (4, 1.9, 41), (6, 0.9, 41), (7, 0.9, 45), (8, 1.9, 43),
              (10, 0.9, 43), (11, 0.9, 47), (12, 3.0, 36)],
        kick=[(4, 1.0), (6, 0.9), (8, 1.0), (10, 0.9), (11.5, 0.6), (12, 1.0)],
        clap=[(5, 0.8), (7, 0.8), (9, 0.8), (11, 0.75), (11.25, 0.45), (11.5, 0.55), (11.75, 0.7)],
        hats=[(b / 2, 0.8 if b % 2 else 0.5) for b in range(5, 24)],
        lead='brass', lead_gain=0.38, bell_layer=0.12, pad_gain=0.3,
        pings=[(1.0, 96), (1.5, 100)],
        ending=dict(beat=12, arp=(84, 88, 91, 96, 100), last=(13.5, 100)),
        final_ep=(52, 55, 60, 64),
    )
    return sc


def cheer_score(t_hit=T_FLASH, dur=FRAMES / FPS):
    """응원: energetic and driving. D major, 4/4, 136 bpm; four on the floor, claps on 2 and 4, an
    octave-pumping eighth bass, a sixteenth arpeggio, bright pluck lead. D | Bm | G | A | D. Original tune."""
    sc = _common(t_hit, dur)
    roots = {0: 38, 4: 35, 8: 31, 12: 33}
    bassl = [(0, 1.9, 38)]
    for b in range(4, 32):
        bb = b / 2
        if bb >= 16:
            break
        r = roots[int(bb // 4) * 4]
        bassl.append((bb, 0.45, r + (12 if b % 2 else 0)))
    bassl.append((16, 2.0, 38))
    sc.update(
        name='cheer', key='D major', meter=4, bpm=136.0,
        intro=dict(chord=(45, 52, 55, 61), shimmer=(85, 88, 91, 93)),
        hit=dict(chord=(62, 66, 69, 74, 76), sparkle=(86, 88, 90, 93, 95, 98, 100, 102)),
        melody=[(2.0, 0.5, 69, 0.75), (2.5, 0.5, 74, 0.78), (3.0, 0.5, 78, 0.82), (3.5, 0.5, 81, 0.86),
                (4, 0.75, 83, 0.95), (4.75, 0.75, 81, 0.8), (5.5, 1, 78, 0.85), (6.5, 0.5, 74, 0.75), (7, 0.5, 78, 0.8),
                (7.5, 0.5, 76, 0.75),
                (8, 0.75, 74, 0.9), (8.75, 0.75, 71, 0.78), (9.5, 1, 74, 0.82), (10.5, 0.5, 79, 0.8), (11, 0.5, 78, 0.78),
                (11.5, 0.5, 79, 0.8),
                (12, 0.75, 81, 0.95), (12.75, 0.75, 83, 0.85), (13.5, 1, 85, 0.9), (14.5, 0.5, 81, 0.78), (15, 0.5, 83, 0.82),
                (15.5, 0.5, 85, 0.88), (16, 2.0, 86, 1.0)],
        chords=[(0, (62, 66, 69, 74), 'D'), (4, (59, 62, 66, 69), 'Bm'), (8, (55, 59, 62, 67), 'G'),
                (12, (57, 61, 64, 69), 'A'), (16, (62, 66, 69, 74, 76), 'Dadd9')],
        stabs=[], arp=dict(start=4, end=16, step=0.25, oct=12, vel=0.5, gain=0.25),
        bass=bassl,
        kick=[(b, 1.0) for b in range(4, 16)] + [(16, 1.0)],
        clap=[(b, 0.85) for b in (5, 7, 9, 11, 13)] + [(15, 0.8), (15.25, 0.5), (15.5, 0.6), (15.75, 0.75)],
        hats=[(b / 2 + 0.25, 0.7) for b in range(8, 32)] + [(b / 2, 0.45) for b in range(9, 32, 2)],
        lead='pluck', lead_gain=0.65, bell_layer=0.08, pad_gain=0.24, pad_cut=2600, kick_gain=0.85,
        pings=[(1.0, 98), (1.5, 102)],
        ending=dict(beat=16, arp=(86, 90, 93, 98, 102), last=(17.5, 98)),
        final_ep=(62, 66, 69, 74),
    )
    return sc


def just_score(t_hit=T_FLASH, dur=FRAMES / FPS):
    """그냥: light pop. Bb major, 4/4, 104 bpm; mallet lead, kick on 1 and 3, soft claps on 2 and 4,
    shaker eighths. Bb | Gm7 | Ebmaj7 F | Bb. Original tune."""
    sc = _common(t_hit, dur)
    sc.update(
        name='just', key='Bb major', meter=4, bpm=104.0,
        intro=dict(chord=(41, 48, 51, 57), shimmer=(84, 87, 89, 93)),
        hit=dict(chord=(70, 74, 77, 82, 84), sparkle=(84, 86, 89, 91, 94, 96, 98, 101)),
        melody=[(2.5, 0.5, 77, 0.75), (3, 0.5, 74, 0.7), (3.5, 0.5, 77, 0.78),
                (4, 1, 79, 0.9), (5, 0.5, 77, 0.75), (5.5, 0.5, 74, 0.72), (6, 0.5, 70, 0.72), (6.5, 1, 74, 0.8),
                (7.5, 0.5, 72, 0.7),
                (8, 0.75, 74, 0.85), (8.75, 0.75, 75, 0.78), (9.5, 0.5, 79, 0.8), (10, 0.5, 81, 0.88), (10.5, 0.5, 79, 0.75),
                (11, 0.5, 77, 0.78), (11.5, 0.5, 72, 0.72), (12, 3.0, 74, 0.9)],
        chords=[(0, (58, 62, 65, 72), 'Bbadd9'), (4, (55, 58, 62, 65), 'Gm7'), (8, (55, 58, 62, 63), 'Ebmaj7'),
                (10, (53, 57, 60, 65), 'F'), (12, (58, 62, 65, 69, 72), 'Bbmaj9')],
        stabs=[4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5], stab_len=0.3,
        bass=[(0, 1.9, 34), (2, 0.9, 41), (4, 1.4, 43), (5.5, 0.5, 43), (6, 0.9, 38), (7, 0.9, 41), (8, 1.4, 39),
              (9.5, 0.5, 39), (10, 0.9, 41), (11, 0.9, 45), (12, 3.0, 34)],
        kick=[(4, 0.85), (6, 0.8), (8, 0.85), (10, 0.8), (12, 0.85)], kick_gain=0.85,
        clap=[(5, 0.6), (7, 0.6), (9, 0.6), (11, 0.6)], clap_gain=0.8,
        shaker=[(b / 2, 1.0 if b % 2 else 0.55) for b in range(4, 24)],
        lead='mallet', lead_gain=0.38, bell_layer=0.12, pad_gain=0.28,
        pings=[(1.0, 98), (2.0, 94)],
        ending=dict(beat=12, arp=(82, 86, 89, 94, 98), last=(13.5, 101)),
        final_ep=(58, 62, 65, 69),
    )
    return sc


def thanks_score(t_hit=T_FLASH, dur=FRAMES / FPS):
    """고마움: gentle and warm. Eb major, 4/4, 76 bpm; soft piano with a bell layer, a slow pulse,
    shaker. Eb Cm7 | Abmaj7 Bb7sus Bb7 | Eb. Original tune."""
    sc = _common(t_hit, dur)
    sc.update(
        name='thanks', key='Eb major', meter=4, bpm=76.0,
        intro=dict(chord=(46, 53, 56, 62), shimmer=(86, 89, 92, 94)),
        hit=dict(chord=(63, 67, 70, 75, 77), sparkle=(84, 87, 89, 91, 94, 96, 99, 101)),
        melody=[(1.0, 0.5, 70, 0.65), (1.5, 0.5, 75, 0.72),
                (2, 1, 79, 0.82), (3, 0.5, 77, 0.68), (3.5, 0.5, 75, 0.66),
                (4, 1, 75, 0.78), (5, 0.5, 72, 0.64), (5.5, 0.5, 75, 0.68),
                (6, 1.5, 77, 0.8), (7.5, 0.5, 74, 0.66), (8, 3.0, 75, 0.85)],
        chords=[(0, (55, 58, 63, 65), 'Ebadd9'), (2, (51, 55, 58, 63), 'Cm7'), (4, (51, 55, 60, 63), 'Abmaj7'),
                (6, (51, 53, 56, 58), 'Bb7sus'), (7, (50, 53, 56, 58), 'Bb7'), (8, (55, 58, 62, 63, 65), 'Ebmaj9')],
        stabs=[3, 5, 7], stab_len=0.7,
        bass=[(0, 1.9, 39), (2, 1.9, 36), (4, 1.9, 32), (6, 1.9, 34), (8, 3.0, 39)],
        kick=[(2, 0.4), (4, 0.45), (6, 0.4), (8, 0.5)], kick_gain=0.6,
        shaker=[(b / 2, 0.75 if b % 2 else 0.4) for b in range(3, 16)],
        lead='ep', lead_gain=0.38, bell_layer=0.2, pad_gain=0.36, pad_cut=1900,
        pings=[(0.5, 99), (2.5, 94)],
        ending=dict(beat=8, arp=(87, 91, 94, 98, 101), last=(9.5, 99)),
        final_ep=(55, 58, 62, 65),
    )
    return sc


OCCASIONS = {
    'bday': bday, 'anniv': anniv_score, 'pass': pass_score, 'cheer': cheer_score, 'just': just_score,
    'thanks': thanks_score,
}
OCC_KEYS = ('bday', 'anniv', 'pass', 'cheer', 'just', 'thanks')   # giftrules.js OCCASIONS, same order


def chord_at(score, beat):
    cur = score['chords'][0]
    for c in score['chords']:
        if c[0] <= beat + 1e-9:
            cur = c
    return cur


def perform(score, seed=11):
    """Play a score: returns (stereo float array, the Mixer with stems)."""
    rng = np.random.default_rng(seed)
    n = int(round(score['dur'] * SR))
    mx = Mixer(n)
    th, beat = score['t_hit'], 60.0 / score['bpm']
    T = lambda b: th + b * beat
    end_t = score['dur']

    intro(mx, th, rng, beat=beat, **score['intro'])
    hit(mx, th, rng, **score['hit'])

    # tune: FM piano (or the score's lead) plus a quiet sine an octave up (celesta-like air on top)
    lead = score.get('lead', 'ep')
    lgain = score.get('lead_gain', 0.36)
    bell_v = score.get('bell_layer', 0.10)
    meter = score['meter']
    for b, L, n_, v in score['melody']:
        f = float(midi_hz(n_))
        last = b == score['melody'][-1][0]
        d = (end_t - FADE_OUT - T(b)) if last else L * beat * 0.92
        jitter = 0.0 if b % meter == 0 else rng.uniform(-0.004, 0.004)
        if lead == 'ep':
            y = ep(f, d, v, rng, rel=0.6 if last else 0.25, tau=1.6 if last else None)
        elif lead == 'brass':
            y = brass(f, d, v, rng, rel=0.5 if last else 0.14)
        elif lead == 'pluck':
            y = pluck(f, d, v, rng, rel=0.5 if last else 0.12, sus=0.35 if last else 0.22)
        else:
            y = mallet(f, d, v, rng, rel=0.4 if last else 0.1)
        mx.add(T(b) + jitter, y, gain=lgain, send=0.28, stem='melody')
        mx.add(T(b) + jitter, sine_bell(2 * f, min(d, 0.5), bell_v * v, tau=0.35), pan=0.15, send=0.4, stem='melody')
    # an arpeggio of the current chord (driving or sparkling, per score)
    arp = score.get('arp')
    if arp:
        b = arp['start']
        k = 0
        while b < arp['end'] - 1e-9:
            notes = sorted(chord_at(score, b)[1])
            n_ = notes[k % len(notes)] + arp.get('oct', 12)
            y = pluck(float(midi_hz(n_)), arp['step'] * beat * 0.8, arp.get('vel', 0.5), rng, rel=0.08, tau=0.12, sus=0.0)
            mx.add(T(b), y, gain=arp.get('gain', 0.12), pan=0.35 * (1 if k % 2 else -1), send=0.25, stem='arp')
            b += arp['step']
            k += 1

    # pad chords, one block per change, overlapping releases
    pads = np.zeros((n, 2))
    ch = score['chords']
    for i, (b, notes, _name) in enumerate(ch):
        t0 = T(b)
        t1 = T(ch[i + 1][0]) if i + 1 < len(ch) else end_t - FADE_OUT
        p = pad(notes, t1 - t0 + 0.05, rng, a=0.18 if i == 0 else 0.06, rel=0.35 if i + 1 < len(ch) else 0.3)
        i0 = int(round(t0 * SR))
        k = min(len(p), n - i0)
        pads[i0:i0 + k] += p[:k]
    pads = signal.sosfiltfilt(sos('lowpass', score.get('pad_cut', 2300)), pads, axis=0)
    mx.add(0.0, pads, gain=score.get('pad_gain', 0.32), send=0.3, stem='pad')

    # piano stabs on 2 and 3, and a soft held chord on the hit and the ending
    for b in score['stabs']:
        notes = chord_at(score, b)[1]
        sl = score.get('stab_len', 0.3)
        st = np.zeros((int((sl * beat + 0.2) * SR), 2))
        for n_ in notes:
            y = ep(float(midi_hz(n_)), sl * beat, 0.45, rng, rel=0.18, vib=0.0, bright=0.7)
            st[:len(y)] += y
        mx.add(T(b) + rng.uniform(0, 0.006), st / len(notes), gain=1.0, send=0.22, stem='stabs')
    for b, notes, d in ((0, score['chords'][0][1], 1.7 * beat), (score['ending']['beat'], score['final_ep'], None)):
        dd = d if d else end_t - FADE_OUT - T(b)
        st = np.zeros((int((dd + 0.5) * SR) + 1, 2))
        for j, n_ in enumerate(notes):
            y = ep(float(midi_hz(n_)), dd, 0.5, rng, rel=0.5, vib=0.0, bright=0.8, tau=1.4)
            st[:len(y)] += y
        mx.add(T(b), st / len(notes), gain=0.42, send=0.3, stem='stabs')

    # bass
    for b, L, n_ in score['bass']:
        d = (end_t - FADE_OUT - T(b)) if b == score['bass'][-1][0] else L * beat
        mx.add(T(b), bass(float(midi_hz(n_)), d, 0.8, rel=0.25 if b == score['bass'][-1][0] else 0.09), gain=0.3,
               stem='bass')

    # drums
    for b, v in score['kick']:
        mx.add(T(b), kick(rng, v), gain=0.5 * score.get('kick_gain', 1.0), send=0.04, stem='drums')
    for b, v in score['clap']:
        mx.add(T(b) + rng.uniform(-0.003, 0.003), clap(rng, v), gain=0.2 * score.get('clap_gain', 1.0), send=0.3, stem='drums')
    for b, v in score['shaker']:
        mx.add(T(b) + rng.uniform(0, 0.008), shaker(rng, v), gain=0.05, pan=0.35, send=0.12, stem='drums')
    for b, v in score.get('hats', ()):
        mx.add(T(b), tail(shaker(rng, v)[:int(0.06 * SR)], 0.012), gain=0.045, pan=-0.3, send=0.08, stem='drums')
    eb = score['ending']['beat']
    mx.add(T(eb), noise_burst(rng, int(2.0 * SR), [5000, 13000], 0.55, 0.004), gain=0.03, send=0.35, stem='drums')

    # glockenspiel: answers, confetti twinkles on the off-beats, sheen glisses, the ending arpeggio
    for b, n_ in score['pings']:
        mx.add(T(b), glock(float(midi_hz(n_)), 0.42), gain=0.17, pan=rng.uniform(-0.5, 0.5), send=0.4, stem='glock')
    b = 3.5
    while b < eb - 0.4:
        t = T(b)
        p = score['sparkle_density'] * (1 - 0.6 * float(smoothstep(6.5, 9.5, t)))
        if rng.uniform() < p:
            tones = [x + 36 for x in chord_at(score, b)[1]]
            tones = [x for x in tones if 88 <= x <= 105] or [98]
            mx.add(t, glock(float(midi_hz(tones[rng.integers(len(tones))])), rng.uniform(0.25, 0.42)), gain=0.17,
                   pan=rng.uniform(-0.7, 0.7), send=0.45, stem='glock')
        b += 1.0
    for ts in score['sheens']:
        bb = (ts - th) / beat
        tones = sorted({x + o for x in chord_at(score, bb)[1] for o in (24, 36) if 84 <= x + o <= 104})[:7]
        for i, n_ in enumerate(tones):
            mx.add(ts + i * 0.045, glock(float(midi_hz(n_)), 0.16 + 0.02 * i), gain=0.17, pan=-0.6 + 1.2 * i / 6,
                   send=0.5, stem='glock')
    for i, n_ in enumerate(score['ending']['arp']):
        mx.add(T(eb) + i * beat / 4, glock(float(midi_hz(n_)), 0.42 - 0.04 * i, 2.2), gain=0.17, pan=-0.5 + 0.25 * i,
               send=0.5, stem='glock')
    lb, ln = score['ending']['last']
    mx.add(T(lb), glock(float(midi_hz(ln)), 0.25, 1.6), gain=0.17, pan=0.3, send=0.6, stem='glock')

    wet = reverb(mx.send)
    mx.stems['reverb'] = wet
    return mx.dry + wet, mx


def render(occasion='bday', frames=FRAMES, fps=FPS, t_hit=T_FLASH, seed=11):
    fn = OCCASIONS.get(occasion)
    if fn is None:
        raise SystemExit(f'occasion {occasion!r} has no score yet (have: {[k for k, v in OCCASIONS.items() if v]})')
    score = fn(t_hit=t_hit, dur=frames / fps)
    raw, mx = perform(score, seed)
    return master(raw), score, mx


APP_LUFS = -19.0   # the in-app files: the app lays the plate's street sound under them


def export_m4a(occasion, path, frames=FRAMES, fps=FPS, kbps=112):
    """Render an occasion at -19 LUFS (the mastered -14 track turned down 5 dB) to AAC stereo .m4a."""
    y, score, _ = render(occasion, frames, fps)
    y = y * 10 ** ((APP_LUFS - TARGET_LUFS) / 20)
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        write_wav(tmp, y)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'aac', '-b:a', f'{kbps}k', '-ar', str(SR),
                        '-ac', '2', '-movflags', '+faststart', path], check=True)
    finally:
        os.remove(tmp)
    x = read_audio(path)
    print(f'[m4a] {path}: {score["name"]} {score["key"]} {score["bpm"]:g} bpm {score["meter"]}/4, '
          f'{os.path.getsize(path):,} B, {len(x) / SR:.3f} s, {lufs(x):.2f} LUFS, peak {20 * np.log10(np.abs(x).max()):.2f} dBFS',
          flush=True)


# ------------------------------------------------------------------ files, the ambience mix and checks
def write_wav(path, x):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def read_audio(path, n=None):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', '-ac', '2',
                          '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, '<f4').reshape(-1, 2).astype(float)
    if n is not None:
        x = np.pad(x[:n], ((0, max(0, n - len(x))), (0, 0)))
    return x


def video_frames(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
                          'stream=nb_read_packets,r_frame_rate', '-of', 'json', path],
                         capture_output=True, check=True, text=True).stdout
    s = json.loads(out)['streams'][0]
    a, b = s['r_frame_rate'].split('/')
    return int(s['nb_read_packets']), float(a) / float(b)


def flash_frame(path):
    """The frame where the mean luma peaks in the first three seconds (the white flash)."""
    frames, fps = video_frames(path)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', '3', '-vf', 'scale=54:96,format=gray', '-f',
                          'rawvideo', '-'], capture_output=True, check=True).stdout
    lum = np.frombuffer(raw, np.uint8).reshape(-1, 96 * 54).mean(1)
    return int(np.argmax(lum)), fps


def ambience_gain(n, t_flash, base_db, flash_db):
    t = _t(n)
    w = smoothstep(t_flash - 0.45, t_flash - 0.15, t) * (1 - smoothstep(t_flash + 0.6, t_flash + 1.05, t))
    return 10 ** ((base_db + (flash_db - base_db) * w) / 20)


def mix(video, out, music=None, occasion='bday', amb_db=-20.0, amb_flash_db=-10.0, hp=110.0, keep_wav=None,
        music_db=0.0):
    """amb_db / amb_flash_db place the ambience against the music at its full -14 LUFS level; music_db then
    turns only the music (and the mix target) down, so the street keeps its absolute level and the
    music sits that much lower. The video stream and the source's metadata (the AI-composite label) are kept."""
    frames, fps = video_frames(video)
    n = int(round(frames / fps * SR))
    fl, _ = flash_frame(video)
    t_flash = fl / fps
    if music:
        mus = read_audio(music, n)
    else:
        mus, _, _ = render(occasion, frames, fps, t_flash)
    amb = read_audio(video, n)
    amb = signal.sosfiltfilt(sos('highpass', hp, 4), amb, axis=0)
    amb = amb - amb.mean(0)
    lm, la = lufs(mus), lufs(amb)
    # levels relative to the music's integrated loudness: -20 LU under it, -10 LU around the flash
    g = ambience_gain(n, t_flash, lm + amb_db - la, lm + amb_flash_db - la)
    amb = amb * g[:, None]
    amb[:int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))[:, None]
    final = master(mus * 10 ** (music_db / 20) + amb, target=TARGET_LUFS + music_db)
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        write_wav(tmp, final)
        if keep_wav:
            write_wav(keep_wav, final)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-i', tmp, '-map', '0:v:0', '-map', '1:a:0',
                        '-map_metadata', '0',
                        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-ac', '2',
                        '-movflags', '+faststart', out], check=True)
    finally:
        os.remove(tmp)
    print(f'[mix] {out}: flash frame {fl} ({t_flash:.3f} s); music {lm:.1f} LUFS {music_db:+g} dB -> '
          f'{lufs(mus * 10 ** (music_db / 20)):.1f}, ambience {la:.1f} LUFS raw -> '
          f'{lm + amb_db:.1f} (flash {lm + amb_flash_db:.1f}); final {lufs(final):.2f} LUFS, '
          f'peak {20 * np.log10(np.abs(final).max()):.2f} dBFS')


def onset(x, lo, hi):
    """First sample in [lo, hi) s where the 2 ms energy jumps above half its maximum in that window."""
    a, b = int(lo * SR), int(hi * SR)
    e = uniform_filter1d((x[a:b] ** 2).sum(1), int(0.002 * SR))
    return (a + int(np.argmax(e > 0.5 * e.max()))) / SR


def ffmpeg_stats(path):
    r = subprocess.run(['ffmpeg', '-nostats', '-hide_banner', '-i', path, '-map', '0:a:0', '-af',
                        'ebur128=peak=true+sample,astats=measure_overall=Peak_level+DC_offset+RMS_level:measure_perchannel=none',
                        '-f', 'null', '-'], capture_output=True, text=True).stderr
    keep = []
    summary = False
    for line in r.splitlines():
        if 'Summary:' in line:
            summary = True
        if summary and line.strip():
            keep.append(line.strip())
        elif 'Overall' in line or ('Parsed_astats' in line and ('Peak' in line or 'DC' in line or 'RMS' in line)):
            keep.append(line.split(']')[-1].strip())
    return '\n'.join(keep)


def check(path, png=None, t_flash=None):
    x = read_audio(path)
    if t_flash is None:
        try:
            fl, fps = flash_frame(path)
            t_flash = fl / fps
        except (subprocess.CalledProcessError, IndexError, KeyError):
            t_flash = T_FLASH
    pk = np.abs(x).max()
    f, P = signal.welch(x.mean(1), SR, nperseg=8192)
    hf = 10 * np.log10(P[f > 16000].sum() / P.sum())
    on = onset(x, t_flash - 0.25, t_flash + 0.25)
    print(f'[check] {path}: {len(x) / SR:.4f} s, {lufs(x):.2f} LUFS (python BS.1770), '
          f'sample peak {20 * np.log10(pk):.2f} dBFS, DC {x.mean(0).round(6).tolist()}, '
          f'energy above 16 kHz {hf:.1f} dB of total')
    print(f'[check] hit onset {on:.4f} s vs flash {t_flash:.4f} s: {(on - t_flash) * 1000:+.1f} ms '
          f'({(on - t_flash) * FPS:+.2f} frames)')
    print(ffmpeg_stats(path))
    if png:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(2, 1, figsize=(12, 7), sharex=True)
        tt = _t(len(x))
        ax[0].plot(tt, x[:, 0], lw=0.3, color='#5b21ff')
        ax[0].plot(tt, x[:, 1], lw=0.3, color='#ff4fa3', alpha=0.6)
        ax[0].axvline(t_flash, color='k', lw=0.8, ls='--')
        ax[0].set_ylim(-1, 1)
        ax[0].set_title(os.path.basename(path))
        ff, ts, S = signal.spectrogram(x.mean(1), SR, nperseg=2048, noverlap=1536)
        ax[1].pcolormesh(ts, ff / 1000, 10 * np.log10(S + 1e-14), shading='auto', vmin=-130, vmax=-30, cmap='magma')
        ax[1].axvline(t_flash, color='w', lw=0.8, ls='--')
        ax[1].set_ylabel('kHz')
        ax[1].set_xlabel('s')
        fig.tight_layout()
        fig.savefig(png, dpi=110)
        print('[check] wrote', png)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('render', help='render an occasion to a 48 kHz stereo WAV')
    r.add_argument('occasion', choices=sorted(OCCASIONS))
    r.add_argument('out')
    r.add_argument('--frames', type=int, default=FRAMES)
    r.add_argument('--fps', type=float, default=FPS)
    r.add_argument('--flash', type=float, default=T_FLASH, help='hit time in seconds (card.T_FLASH)')
    r.add_argument('--seed', type=int, default=11)
    r.add_argument('--png', action='store_true', help='also write <out>.png (waveform + spectrogram)')
    m = sub.add_parser('mix', help='mix music with the clip\'s own ambience and mux (video copied, AAC 192k)')
    m.add_argument('video')
    m.add_argument('out')
    m.add_argument('--music', help='WAV from render (default: render --occasion for this clip)')
    m.add_argument('--occasion', default='bday')
    m.add_argument('--amb-db', type=float, default=-20.0, help='ambience vs music loudness, LU')
    m.add_argument('--amb-flash-db', type=float, default=-10.0, help='ambience around the flash, LU')
    m.add_argument('--keep-wav', help='also keep the final mix as a WAV here')
    m.add_argument('--music-db', type=float, default=0.0,
                   help='music gain in the mix, dB (e.g. -5: music about -19 LUFS, ambience stays where it was)')
    c = sub.add_parser('check', help='loudness, peaks, DC, HF content, hit vs flash timing')
    c.add_argument('path')
    c.add_argument('--png')
    c.add_argument('--flash', type=float)
    a = ap.parse_args()
    if a.cmd == 'render':
        y, score, mx = render(a.occasion, a.frames, a.fps, a.flash, a.seed)
        write_wav(a.out, y)
        print(f'[render] {a.out}: {score["name"]}, {score["key"]}, {score["bpm"]:g} bpm {score["meter"]}/4, '
              f'{len(y) / SR:.4f} s, {lufs(y):.2f} LUFS, peak {20 * np.log10(np.abs(y).max()):.2f} dBFS')
        for k, v in sorted(mx.stems.items()):
            pk = np.abs(v).max()
            print(f'  stem {k:14s} peak {20 * np.log10(pk + 1e-12):7.1f} dB  loudness {lufs(v):6.1f} LUFS (pre-master)')
        dry = sum(v for k, v in mx.stems.items() if k != 'reverb')
        print(f'  dry total {lufs(dry):.1f} LUFS, reverb return {lufs(mx.stems["reverb"]):.1f} LUFS (pre-master)')
        ms = _kblocks(y)
        tb = np.arange(len(ms)) * 0.1 + 0.2
        for lo, hi, what in ((0.0, 1.0, 'standby'), (1.0, 1.45, 'charge-up'), (1.5, 2.3, 'hit'),
                             (2.6, 8.1, 'tune'), (8.2, 9.6, 'ring-out')):
            sel = (tb >= lo) & (tb < hi)
            print(f'  momentary {what:10s} {lo:4.1f}-{hi:4.1f} s  mean {-0.691 + 10 * np.log10(ms[sel].mean()):6.1f} LUFS'
                  f'  max {-0.691 + 10 * np.log10(ms[sel].max()):6.1f}')
        if a.png:
            check(a.out, os.path.splitext(a.out)[0] + '.png', a.flash)
    elif a.cmd == 'mix':
        mix(a.video, a.out, a.music, a.occasion, a.amb_db, a.amb_flash_db, keep_wav=a.keep_wav, music_db=a.music_db)
    else:
        check(a.path, a.png, a.flash)


if __name__ == '__main__':
    main()
