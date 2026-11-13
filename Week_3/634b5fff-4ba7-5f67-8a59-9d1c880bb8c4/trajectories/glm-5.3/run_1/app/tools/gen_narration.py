#!/usr/bin/env python3
"""Generate narration audio: one synthesised piece per chapter.

All audio is generated offline from sine partials and shaped noise (no
external recordings), so it is public domain by construction. Output is
Ogg Vorbis written through libsndfile.
"""
import math, random, os, sys
import numpy as np
import soundfile as sf

SR = 44100

def synth(path, seconds, base, wind_level, chime_hz, seed):
    rng = random.Random(seed)
    n = int(SR * seconds)
    idx = np.arange(n)
    t = idx / SR
    # wind bed: smoothed noise
    noise = np.random.RandomState(seed).uniform(-1, 1, n)
    wind = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc = acc * 0.995 + noise[i] * 0.005
        wind[i] = acc
    signal = wind * wind_level
    # narration pulses: amplitude-shaped vowel-like tones at word rhythm
    ws = 0.35
    while ws < seconds - 0.5:
        dur = rng.uniform(0.14, 0.30)
        hz = base * rng.choice([1.0, 1.02, 0.97, 1.05, 0.94])
        m = (t >= ws) & (t < ws + dur)
        ph = (t[m] - ws) / dur
        env = np.sin(np.pi * ph) ** 2
        tone = env * (
            0.30 * np.sin(2 * np.pi * hz * t[m])
            + 0.12 * np.sin(2 * np.pi * hz * 2 * t[m])
            + 0.05 * np.sin(2 * np.pi * hz * 3 * t[m])
        )
        tick = np.where(ph < 0.03, (0.03 - ph) * 8 * np.sin(2 * np.pi * 1400 * t[m]), 0.0)
        signal[m] += (tone + tick) * 0.9
        ws += dur + rng.uniform(0.06, 0.22)
    if chime_hz:
        ct = (t * 0.5) % 1.0
        signal += 0.02 * np.sin(np.pi * ct) * np.sin(2 * np.pi * chime_hz * t)
    signal = np.clip(signal * 0.5, -0.98, 0.98)
    stereo = np.stack([signal, signal], axis=1)
    sf.write(path, stereo, SR, format='OGG', subtype='VORBIS')

CHAPTERS = {
    'alley':        dict(base=196.0, wind=0.55, chime=0.0,   seed=11, sec=22),
    'stove':        dict(base=246.9, wind=0.22, chime=0.0,   seed=12, sec=19),
    'goose':        dict(base=261.6, wind=0.20, chime=0.0,   seed=13, sec=18),
    'tree':         dict(base=293.7, wind=0.18, chime=523.3, seed=14, sec=18),
    'star':         dict(base=220.0, wind=0.30, chime=659.3, seed=15, sec=17),
    'grandmother':  dict(base=329.6, wind=0.12, chime=784.0, seed=16, sec=21),
    'shelf':        dict(base=174.6, wind=0.40, chime=0.0,   seed=17, sec=15),
}

if __name__ == '__main__':
    outdir = sys.argv[1] if len(sys.argv) > 1 else 'public/narration'
    os.makedirs(outdir, exist_ok=True)
    for name, cfg in CHAPTERS.items():
        ogg = os.path.join(outdir, name + '.ogg')
        synth(ogg, cfg['sec'], cfg['base'], cfg['wind'], cfg['chime'], cfg['seed'])
        print('wrote', ogg)
