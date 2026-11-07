#!/usr/bin/env python3
# Rebuilds the Relax lo-fi sample pack (this folder's <instrument>.js files) from
# the original recordings - see NOTICE.md for the sources and licences. A dev
# tool only, not shipped: needs python3 + numpy, curl and an ffmpeg with libopus
# (FFMPEG=/path/to/ffmpeg). Run it from an empty scratch directory:
#   FFMPEG=~/scratch/ffmpeg python3 build-pack.py ~/claude-meter/relax-biomes/samples
import os, re, sys, json, base64, subprocess, urllib.parse
import numpy as np
FF = os.environ.get('FFMPEG', 'ffmpeg')
SR = 48000
def load(path, sr=SR, ch=1):
    r = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, dtype=np.float32).copy()
    return x if ch == 1 else x.reshape(-1, ch)
def save_wav(path, x, sr=SR):
    p = subprocess.run([FF, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1' if x.ndim == 1 else str(x.shape[1]), '-i', '-', '-c:a', 'pcm_s16le', path], input=x.astype(np.float32).tobytes(), check=True)
def env_db(x, sr=SR, win=0.01):
    n = int(sr * win); m = len(x) // n
    e = np.sqrt(np.mean(x[:m*n].reshape(m, n) ** 2, axis=1) + 1e-20)
    return 20 * np.log10(e)
def onset(x, sr=SR, rel=-30):
    a = np.abs(x); pk = a.max()
    thr = pk * 10 ** (rel / 20)
    i = int(np.argmax(a > thr))
    return i
def midi_of(f): return 69 + 12 * np.log2(f / 440.0)
def pitch(x, sr=SR, start=0.08, dur=0.5, fmin=25, fmax=2000):
    s = int(start * sr); seg = x[s:s + int(dur * sr)]
    if len(seg) < 2048: seg = x[:int(dur*sr)]
    seg = seg * np.hanning(len(seg))
    n = 1 << int(np.ceil(np.log2(len(seg) * 8)))
    S = np.abs(np.fft.rfft(seg, n))
    f = np.fft.rfftfreq(n, 1 / sr)
    # harmonic product spectrum over 4 harmonics
    hps = S.copy()
    for h in (2, 3, 4):
        d = S[::h]; hps[:len(d)] *= d; hps[len(d):] = 0
    band = (f >= fmin) & (f <= fmax)
    i = np.argmax(np.where(band, hps, 0))
    # refine with the strongest spectral peak near i (or its multiples)
    return f[i]
def centroid(x, sr=SR):
    S = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / sr)
    return float((S * f).sum() / (S.sum() + 1e-12))

V = 'https://raw.githubusercontent.com/sgossner/VCSL/master/'
I = 'https://theremin.music.uiowa.edu/'
files = {}
def name(m):  # VCSL piano octave = standard - 1
    n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m % 12]
    return f'{n}{m // 12 - 2}'
for m in [35,39,43,47,51,55,59,63,67,71,75,79,83,87]:
    p = f'Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_vl1_rr1_{name(m)}.wav'
    files[f'piano_{m}.wav'] = V + p
for n in ['F2','A2','C3','E3','G3','B3','D4','F4','A4','C5','E5']:
    rr = 'rr2' if n in ('C3','E3') else 'rr1'
    files[f'vibes_{n}.wav'] = V + f'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_{n}_v1_{rr}_Main.wav'
for f in ['A4_k1','B2_k8','B3_k3','B4_k15','C#3_k7','C#4_k2','D#3_k6','D#4_k13','F#3_k5','F#4_k14','G#3_k4']:
    files[f'kalimba_{f}.wav'] = V + f'Idiophones/Plucked Idiophones/Kalimba, Kenya/Mbira6_Normal_MainSpirit_{f}_vl3_rr2.wav'
dr = {
 'kick_bd1_v2_rr1': 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v2_rr1_Sum.wav',
 'kick_bd1_v2_rr2': 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v2_rr2_Sum.wav',
 'kick_bd1_v3_rr1': 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v3_rr1_Sum.wav',
 'cajon_hit1_mp_rr1': 'Idiophones/Struck Idiophones/Cajon/Cajon_hit1_mp_rr1.wav',
 'cajon_hit2_mp_rr1': 'Idiophones/Struck Idiophones/Cajon/Cajon_hit2_mp_rr1.wav',
 'cajon_hit3_mp_rr1': 'Idiophones/Struck Idiophones/Cajon/Cajon_hit3_mp_rr1.wav',
 'cajon_hit1_mp_rr2': 'Idiophones/Struck Idiophones/Cajon/Cajon_hit1_mp_rr2.wav',
 'cajon_hit2_pp_rr1': 'Idiophones/Struck Idiophones/Cajon/Cajon_hit2_pp_rr1.wav',
 'xstick_3m_rr1': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_Xstick_v2_rr1_Mid.wav',
 'xstick_3m_rr2': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_Xstick_v2_rr2_Mid.wav',
 'xstick_4_rr1': 'Membranophones/Struck Membranophones/Snare Drum, Modern 3/Snare4_Xstick_v2_rr1_Mid.wav',
 'xstick_4_rr2': 'Membranophones/Struck Membranophones/Snare Drum, Modern 3/Snare4_Xstick_v2_rr2_Mid.wav',
 'snare_3m_sn2_rr1': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_HitSN_v2_rr1_Mid.wav',
 'snare_3m_sn2_rr2': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_HitSN_v2_rr2_Mid.wav',
 'snare_3m_taps_rr1': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_taps_v4_rr1_Mid.wav',
 'snare_3m_taps_rr2': 'Membranophones/Struck Membranophones/Snare Drum, Modern 2/Snare3M_taps_v4_rr2_Mid.wav',
 'snare_2_taps_rr1': 'Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_taps_v4_rr1_Mid.wav',
 'hat_c1_rr1': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v1_rr1_Mid.wav',
 'hat_c1_rr2': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v1_rr2_Mid.wav',
 'hat_c2_rr1': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v2_rr1_Mid.wav',
 'hat_c2_rr2': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v2_rr2_Mid.wav',
 'hat_pedal_rr1': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_Close_rr1_Mid.wav',
 'hat_loose_rr1': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitLoose_rr1_Mid.wav',
 'shaker_hf_down_rr1': 'Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_Down_rr1.wav',
 'shaker_hf_up_rr1': 'Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_Up_rr1.wav',
 'shaker_hf_down_rr2': 'Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_Down_rr2.wav',
 'shaker_hf_up_rr2': 'Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_Up_rr2.wav',
}
for k, p in dr.items(): files[f'drum_{k}.wav'] = V + p
G = 'sound files/MIS/Piano_Other/guitar/'
for f in ['Guitar.mf.sulE.E2B2','Guitar.mf.sulE.C3B3','Guitar.mf.sulA.C3B3','Guitar.mf.sulD.D3B3','Guitar.mf.sulD.C4Ab4','Guitar.mf.sulG.C4B4','Guitar.mf.sulB.C4B4','Guitar.mf.sulB.C5Gb5','Guitar.mf.sul_E.C5B5','Guitar.pp.sulG.C4B4','Guitar.pp.sulB.C5Gb5']:
    files[f'iowa_{f}.aif'] = I + G + f + '.mono.aif'
B = 'sound files/MIS/Strings/doublebass2012/'
for f in ['Bass.pizz.sulE.mf.E1B1','Bass.pizz.sulE.mf.C2B2','Bass.pizz.sulA.mf.C2B2','Bass.pizz.sulD.mf.D2B2','Bass.pizz.sulG.mf.G2B2','Bass.pizz.sulG.mf.C3B3','Bass.pizz.sulD.mf.C3A3']:
    files[f'iowa_{f}.aif'] = I + B + f + '.mono.aif'
# The second round (2026-10-31): a louder piano layer for accented notes, a
# brushed kit, a bowed cello and a bowed vibraphone for the long sustained notes.
for m in [55, 59, 63, 67, 71, 75, 79, 83]:
    files[f'piano2_{m}.wav'] = V + f'Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_vl2_rr1_{name(m)}.wav'
for n in ['A2', 'E3', 'G3', 'D4', 'A4']:
    files[f'bowed_{n}.wav'] = V + f'Idiophones/Struck Idiophones/Vibraphone/Bowed/Vibes_bowed_{n}_rr1_Main.wav'
SW = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.swirly-drums/main/Samples/'
BRUSH = {
 'snare': ['snare_main/snare_hit_vl7_rr1_top', 'snare_main/snare_hit_vl7_rr2_top', 'snare_main/snare_hit_vl7_rr3_top', 'snare_main/snare_hit_vl7_rr4_top'],
 'ghost': ['snare_main/snare_hit_vl2_rr1_top', 'snare_main/snare_hit_vl2_rr2_top', 'snare_main/snare_hit_vl2_rr3_top'],
 'stir': ['snare_stir/stir_dl1_rr1', 'snare_stir/stir_dl1_rr3'],
 'swish': ['snare_stir/stir_dl4_rr1', 'snare_stir/stir_dl4_rr2'],
 'ride': ['ride/ride_vl4_rr1', 'ride/ride_vl4_rr2', 'ride/ride_vl4_rr3'],
 'bhat': ['hat_tight/hh_tight_vl6_rr1', 'hat_tight/hh_tight_vl6_rr2'],
}
for kind, names in BRUSH.items():
    for n in names: files[f'swirly_{n.split("/")[1]}.wav'] = SW + n + '.wav'
CE = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer-bigcat.cello/master/Samples/sus/'
CELLO = {36: 'C1', 39: 'Eb1', 42: 'Gb1', 45: 'A1', 48: 'C2', 51: 'Eb2', 54: 'Gb2', 57: 'A2', 60: 'C3'}  # Karoryfer names a note an octave low
for m, n in CELLO.items(): files[f'cello_{n}_p_d.wav'] = CE + f'{n}_p_d.wav'
import json
def fetch_all():
  os.makedirs('raw', exist_ok=True)
  for local, url in files.items():
    out = os.path.join('raw', local)
    if os.path.exists(out) and os.path.getsize(out) > 1000: continue
    u = urllib.parse.quote(url, safe=':/')
    r = subprocess.run(['curl', '-sS', '-f', '-m', '120', '-o', out, u])
    print(('ok ' if r.returncode == 0 else 'FAIL ') + local, flush=True)

# Builds the lo-fi sample pack: picks notes from the downloaded CC0 / free sources,
# trims, tunes (measures), balances, encodes mono Ogg Opus, writes JS wrappers.
NAMES = {'C':0,'Db':1,'C#':1,'D':2,'Eb':3,'D#':3,'E':4,'F':5,'Gb':6,'F#':6,'G':7,'Ab':8,'G#':8,'A':9,'Bb':10,'A#':10,'B':11}
def nn(s):
    m = re.match(r'([A-G][b#]?)(-?\d)', s); return NAMES[m.group(1)] + 12 * (int(m.group(2)) + 1)
def hz(m): return 440 * 2 ** ((m - 69) / 12)

def spec(seg, n=1 << 18):
    seg = seg * np.hanning(len(seg)); S = np.abs(np.fft.rfft(seg, n)); f = np.fft.rfftfreq(n, 1 / SR); return f, S
def peak_near(f, S, target, cents=70):
    lo, hi = target * 2 ** (-cents / 1200), target * 2 ** (cents / 1200)
    idx = np.where((f >= lo) & (f <= hi))[0]
    if not len(idx): return None, 0
    i = idx[np.argmax(S[idx])]
    if 0 < i < len(S) - 1:  # parabolic interpolation on log magnitude
        a, b, c = np.log(S[i - 1] + 1e-12), np.log(S[i] + 1e-12), np.log(S[i + 1] + 1e-12)
        p = 0.5 * (a - c) / (a - 2 * b + c); return f[i] + p * (f[1] - f[0]), S[i]
    return f[i], S[i]
def tune_cents(x, m, harmonics=(1, 2, 3, 4)):
    seg = x[int(0.06 * SR):int(0.8 * SR)]
    f, S = spec(seg)
    est = []
    for h in harmonics:
        fp, mag = peak_near(f, S, hz(m) * h)
        if fp: est.append((mag, 1200 * np.log2(fp / (hz(m) * h)), h))
    est.sort(reverse=True)
    top = [e for e in est[:2]]
    return float(np.median([e[1] for e in top])), est
def pitch_score(x, m):
    seg = x[int(0.05 * SR):int(0.7 * SR)]; f, S = spec(seg)
    sc = 0
    for h in range(1, 7):
        fp, mag = peak_near(f, S, hz(m) * h, 30); sc += np.log(mag + 1e-9) / h
    return sc

def split_zero_runs(x, min_ms=40):
    z = np.abs(x) < 1e-6
    segs = []; start = None; run = 0
    n = int(SR * min_ms / 1000)
    i = 0; L = len(x)
    # find boundaries: runs of >= n zeros
    edges = np.diff(np.concatenate([[0], z.astype(np.int8), [0]]))
    zs = np.where(edges == 1)[0]; ze = np.where(edges == -1)[0]
    cuts = [(a, b) for a, b in zip(zs, ze) if b - a >= n]
    pos = 0
    for a, b in cuts:
        if a - pos > SR * 0.3: segs.append((pos, a))
        pos = b
    if L - pos > SR * 0.3: segs.append((pos, L))
    return segs
def split_onsets(x, gap=2.0, rel=-20):
    e = env_db(x, SR, 0.01); pk = e.max(); on = []; i = 3
    while i < len(e) - 30:
        if e[i] - e[i - 3] > 10 and e[i:i + 30].max() > pk + rel:
            on.append(i * 480); i += int(gap * 100)
        else: i += 1
    return [(o, (on[k + 1] if k + 1 < len(on) else len(x))) for k, o in enumerate(on)]

def find_note(path, m, lo, hi, mode):
    x = load(path)
    segs = split_zero_runs(x) if mode == 'zeros' else split_onsets(x)
    best = None
    for a, b in segs:
        seg = x[a:b]
        if np.abs(seg).max() < 1e-3: continue
        o = onset(seg, rel=-30)
        s = seg[o:]
        cand = {mm: pitch_score(s, mm) for mm in range(lo - 1, hi + 2)}
        guess = max(cand, key=cand.get)
        if guess == m:
            if best is None or np.abs(seg).max() > best[1]: best = (seg, np.abs(seg).max())
    if best is None: raise SystemExit(f'note {m} not found in {path}')
    return best[0]

def hp_detect(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[f < fc] = 0
    return np.fft.irfft(X, len(x))
def prep(x, secs, fade=None, pre_ms=3.0, rel=-24, det_hp=None):
    o = onset(hp_detect(x, det_hp) if det_hp else x, rel=rel); s = max(0, o - int(SR * pre_ms / 1000))
    y = x[s:s + int(secs * SR)].astype(np.float64).copy()
    fi = max(1, o - s); y[:fi] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi))  # fade in up to the onset
    # cut where it has died away (-62 dB re peak), then fade out
    e = env_db(y / (np.abs(y).max() + 1e-12), SR, 0.01)
    dead = np.where(e < -62)[0]
    dead = [d for d in dead if d > 20]
    if dead: y = y[:min(len(y), (dead[0] + 5) * 480)]
    fo = int(SR * (fade if fade else min(0.6, len(y) / SR / 3)))
    y[-fo:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo))
    return y

def attack_rms(y): return float(np.sqrt(np.mean(y[:int(0.3 * SR)] ** 2)) + 1e-12)

def encode(y, path, br, hpf=None, lpf=None):
    af = []
    if hpf: af.append(f'highpass=f={hpf}:poles=2')
    if lpf: af.append(f'lowpass=f={lpf}:poles=2')
    cmd = [FF, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-']
    if af: cmd += ['-af', ','.join(af)]
    cmd += ['-c:a', 'libopus', '-b:a', f'{br}k', '-vbr', 'on', '-application', 'audio', '-frame_duration', '20', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', path]  # bit-exact: the same input builds the same bytes
    subprocess.run(cmd, input=y.astype(np.float32).tobytes(), check=True)

R = 'raw/'
TONAL = {
  'piano': dict(br=48, hpf=None, balance=0.75, notes=[(m, R + f'piano_{m}.wav', None, 6.5 if m < 52 else 5.5 if m < 68 else 4.0) for m in [35,39,43,47,51,55,59,63,67,71,75,79,83,87]],
                src='VCSL: Upright Piano, Knight (Sustains, vl1, Player mic)'),
  'vibes': dict(br=40, hpf=None, balance=0.7, notes=[(nn(n) + 12, R + f'vibes_{n}.wav', None, 5.0) for n in ['A2','C3','E3','G3','B3','D4','F4','A4','C5','E5']],
                src='VCSL: Vibraphone (Soft Mallets, v1)'),
  'kalimba': dict(br=40, hpf=None, balance=0.7, notes=[(nn(n.split('_')[0]) + 12, R + f'kalimba_{n}.wav', None, 3.2) for n in ['B2_k8','C#3_k7','D#3_k6','F#3_k5','G#3_k4','B3_k3','C#4_k2','D#4_k13','F#4_k14','A4_k1']],
                src='VCSL: Kalimba, Kenya (Mbira6, vl3)'),
  'guitar': dict(br=40, hpf=90, balance=0.7, notes=[
      (52, R + 'iowa_Guitar.mf.sulA.C3B3.aif', (48, 59, 'zeros'), 3.6), (55, R + 'iowa_Guitar.mf.sulA.C3B3.aif', (48, 59, 'zeros'), 3.6),
      (58, R + 'iowa_Guitar.mf.sulD.D3B3.aif', (50, 59, 'zeros'), 3.4), (61, R + 'iowa_Guitar.mf.sulG.C4B4.aif', (60, 71, 'zeros'), 3.4),
      (64, R + 'iowa_Guitar.mf.sulG.C4B4.aif', (60, 71, 'zeros'), 3.2), (67, R + 'iowa_Guitar.mf.sulB.C4B4.aif', (60, 71, 'zeros'), 3.2),
      (70, R + 'iowa_Guitar.mf.sulB.C4B4.aif', (60, 71, 'zeros'), 3.0), (73, R + 'iowa_Guitar.mf.sulB.C5Gb5.aif', (72, 78, 'zeros'), 3.0),
      (76, R + 'iowa_Guitar.mf.sul_E.C5B5.aif', (72, 83, 'zeros'), 2.8), (79, R + 'iowa_Guitar.mf.sul_E.C5B5.aif', (72, 83, 'zeros'), 2.6)],
      src='University of Iowa MIS: Guitar (Raimundo 118 classical, mf, mono)'),
  'bass': dict(br=40, hpf=28, balance=0.8, notes=[
      (28, R + 'iowa_Bass.pizz.sulE.mf.E1B1.aif', (28, 35, 'onsets'), 2.8), (31, R + 'iowa_Bass.pizz.sulE.mf.E1B1.aif', (28, 35, 'onsets'), 2.8),
      (34, R + 'iowa_Bass.pizz.sulE.mf.E1B1.aif', (28, 35, 'onsets'), 2.8), (37, R + 'iowa_Bass.pizz.sulE.mf.C2B2.aif', (36, 47, 'onsets'), 2.6),
      (40, R + 'iowa_Bass.pizz.sulE.mf.C2B2.aif', (36, 47, 'onsets'), 2.6), (43, R + 'iowa_Bass.pizz.sulA.mf.C2B2.aif', (36, 47, 'onsets'), 2.5),
      (46, R + 'iowa_Bass.pizz.sulA.mf.C2B2.aif', (36, 47, 'onsets'), 2.5), (49, R + 'iowa_Bass.pizz.sulD.mf.C3A3.aif', (48, 57, 'onsets'), 2.4),
      (52, R + 'iowa_Bass.pizz.sulD.mf.C3A3.aif', (48, 57, 'onsets'), 2.4)],
      src='University of Iowa MIS: Double Bass 2012 (Anton Krutz, pizzicato, mf, mono)'),
  # balance_win: the bowed notes swell in slowly, so they are balanced on the whole note, not its attack
  'piano2': dict(br=48, hpf=None, balance=0.75, notes=[(m, R + f'piano2_{m}.wav', None, 5.0 if m < 68 else 4.0) for m in [55, 59, 63, 67, 71, 75, 79, 83]],
                 src='VCSL: Upright Piano, Knight (Sustains, vl2, Player mic)'),
  'cello': dict(br=40, hpf=40, balance=0.8, balance_win=4.0, notes=[(m, R + f'cello_{n}_p_d.wav', None, 4.6) for m, n in CELLO.items()],
                src='Karoryfer x bigcat cello (arco sustain, p, by Kamila Borowiak)'),
  'bowed': dict(br=32, hpf=None, balance=0.8, balance_win=6.0, notes=[(nn(n) + 12, R + f'bowed_{n}.wav', None, 9.0) for n in ['A2', 'E3', 'G3', 'D4', 'A4']],
                src='VCSL: Vibraphone (Bowed)'),
}
DRUMS = {
  'kick': (['kick_bd1_v2_rr1', 'kick_bd1_v2_rr2', 'kick_bd1_v3_rr1'], 0.6, 30, None, 'VCSL: Bass Drum 1 (hit v2/v3)'),
  'rim': (['xstick_3m_rr1', 'xstick_3m_rr2', 'xstick_4_rr1'], 0.35, 120, None, 'VCSL: Snare Drum, Modern 2 and 3 (cross-stick)'),
  'snare': (['snare_3m_sn2_rr1', 'snare_3m_sn2_rr2'], 0.5, 100, None, 'VCSL: Snare Drum, Modern 2 (soft hit, snares on)'),
  'tap': (['snare_3m_taps_rr1', 'snare_3m_taps_rr2'], 0.35, 120, None, 'VCSL: Snare Drum, Modern 2 (taps)'),
  'hat': (['hat_c1_rr1', 'hat_c1_rr2', 'hat_c2_rr1', 'hat_c2_rr2'], 0.32, 300, None, 'VCSL: Hi-Hat Cymbal (closed, v1/v2)'),
  'pedal': (['hat_pedal_rr1'], 0.25, 300, None, 'VCSL: Hi-Hat Cymbal (foot close)'),
  'shaker': (['shaker_hf_down_rr1', 'shaker_hf_up_rr1', 'shaker_hf_down_rr2', 'shaker_hf_up_rr2'], 0.2, 400, None, 'VCSL: Shaker, Small (high, faster)'),
}
def build():
  os.makedirs('pack_ogg', exist_ok=True)
  report = {'tonal': {}, 'drums': {}}
  for inst, cfg in TONAL.items():
      ys = []
      for m, path, sel, secs in cfg['notes']:
          x = find_note(path, m, sel[0], sel[1], sel[2]) if sel else load(path)
          y = prep(x, secs, det_hp=(cfg['hpf'] * 1.6 if inst == 'guitar' else None))
          if inst in ('bass', 'guitar', 'cello'):
              c = float(np.median([tune_cents(y, m, (h,))[0] for h in (1, 2, 3, 4)]))
          else:
              c, est = tune_cents(y, m, (1,))
          if inst in ('piano', 'piano2'): c = 0.0  # keep the piano tuner's own stretch
          ys.append((m, y, c))
      win = cfg.get('balance_win', 0.3)
      rms = np.array([float(np.sqrt(np.mean(y[:int(win * SR)] ** 2)) + 1e-12) for _, y, _ in ys]); med = np.median(rms)
      out = []
      for (m, y, c), r in zip(ys, rms):
          g = (med / r) ** cfg['balance']   # pull each note part-way to the median loudness
          out.append((m, y * g, c))
      pk = max(np.abs(y).max() for _, y, _ in out); G = 10 ** (-1 / 20) / pk
      entry = []
      for m, y, c in out:
          p = f'pack_ogg/{inst}_{m}.ogg'
          encode(y * G, p, cfg['br'], cfg['hpf'])
          entry.append({'midi': m, 'tune': round(c, 1), 'secs': round(len(y) / SR, 2), 'file': p})
      report['tonal'][inst] = {'src': cfg['src'], 'notes': entry}
      print(inst, [(e['midi'], e['tune'], e['secs']) for e in entry])
  for kind, (names, secs, hpf, lpf, src) in DRUMS.items():
      ys = [prep(load(R + f'drum_{n}.wav'), secs, fade=min(0.12, secs / 3), pre_ms=1.5, rel=-24) for n in names]
      pk = max(np.abs(y).max() for y in ys); G = 10 ** (-1 / 20) / pk
      entry = []
      for n, y in zip(names, ys):
          p = f'pack_ogg/drum_{kind}_{n}.ogg'; encode(y * G, p, 48, hpf, lpf)
          entry.append({'name': n, 'secs': round(len(y) / SR, 3), 'file': p, 'rel_db': round(20 * np.log10(np.abs(y).max() / pk), 1)})
      report['drums'][kind] = {'src': src, 'hits': entry}
      print(kind, [(e['name'], e['secs'], e['rel_db']) for e in entry])
  # The brushed kit: every take of a kind is the same strike, so the takes rotate
  # without jumping in level; the stirs are long continuous circles the engine
  # shapes into one sweep per beat or bar.
  report['brushes'] = {}
  for kind, names in BRUSH.items():
      secs, hpf, fade = BRUSH_CUT[kind]
      ys = [prep(load(R + f'swirly_{n.split("/")[1]}.wav'), secs, fade=fade, pre_ms=1.5, rel=-24) for n in names]
      pk = max(np.abs(y).max() for y in ys); G = 10 ** (-1 / 20) / pk
      entry = []
      for n, y in zip(names, ys):
          p = f'pack_ogg/brush_{kind}_{n.split("/")[1]}.ogg'; encode(y * G, p, 40 if kind in ('stir', 'swish', 'ride') else 48, hpf)
          entry.append({'name': n, 'secs': round(len(y) / SR, 3), 'file': p, 'rel_db': round(20 * np.log10(np.abs(y).max() / pk), 1)})
      report['brushes'][kind] = {'hits': entry}
      print('brush', kind, [(e['name'], e['secs'], e['rel_db']) for e in entry])
  return report
BRUSH_CUT = {'snare': (0.7, 90, 0.2), 'ghost': (0.5, 120, 0.15), 'stir': (7.0, 150, 0.4), 'swish': (3.0, 150, 0.4), 'ride': (3.2, 250, 0.9), 'bhat': (0.4, 300, 0.12)}

def wrap(rep, DEST):
  os.makedirs(DEST, exist_ok=True)
  def b64(p): return base64.b64encode(open(p, 'rb').read()).decode('ascii')
  HEAD = ("// Relax lo-fi sample pack: {what}.\n// Source: {src}.\n// Licence and processing: NOTICE.md in this folder. Mono Ogg Opus, base64, so the\n"
          "// pages can load it with a <script> tag (a file:// page may not fetch binary files).\n")
  total = 0
  for inst, v in rep['tonal'].items():
      lines = [HEAD.format(what=inst, src=v['src']), "RelaxSamples.add('%s', { notes: [\n" % inst]
      lines.append("  // [midi, tuning of the recording in cents, data]\n")
      for e in v['notes']:
          lines.append("  [%d, %s, '%s'],\n" % (e['midi'], e['tune'], b64(e['file'])))
      lines.append('] });\n')
      p = os.path.join(DEST, inst + '.js'); open(p, 'w').write(''.join(lines)); total += os.path.getsize(p)
  lines = [HEAD.format(what='drums', src='; '.join(f"{k}: {v['src']}" for k, v in rep['drums'].items())), "RelaxSamples.add('drums', {\n"]
  for kind, v in rep['drums'].items():
      lines.append("  %s: [\n" % kind)
      for e in v['hits']: lines.append("    '%s',\n" % b64(e['file']))
      lines.append('  ],\n')
  lines.append('});\n')
  p = os.path.join(DEST, 'drums.js'); open(p, 'w').write(''.join(lines)); total += os.path.getsize(p)
  lines = [HEAD.format(what='brushes', src='Karoryfer Samples, Swirly Drums (a kit played with brushes)'), "RelaxSamples.add('brushes', {\n"]
  for kind, v in rep['brushes'].items():
      lines.append("  %s: [\n" % kind)
      for e in v['hits']: lines.append("    '%s',\n" % b64(e['file']))
      lines.append('  ],\n')
  lines.append('});\n')
  p = os.path.join(DEST, 'brushes.js'); open(p, 'w').write(''.join(lines)); total += os.path.getsize(p)
  print('total bytes', total)


if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit('usage: build-pack.py <relax-biomes/samples folder>')
    fetch_all()
    wrap(build(), sys.argv[1])
