# Relax lo-fi sample pack — sources and licences

The Relax break's music (`relax-biomes/_lofi.js`) is played from these recordings. Each
`<instrument>.js` here holds a few notes of one instrument (the engine pitch-shifts between
them) as mono Ogg Opus, base64-encoded, so that the break page and the preview page can load
it with a `<script>` tag: a page opened from `file://` may not fetch binary files.

Everything here is either CC0 (public domain) or released by its maker "without
restrictions". No attribution is required; it is given anyway.

## Sources

### Versilian Community Sample Library (VCSL) — CC0 1.0 Universal

<https://github.com/sgossner/VCSL> (branch `master`, files fetched 2026-10-04). The
repository's `LICENSE` is the full CC0 1.0 Universal text, and its README says: "This
collection is under a Creative Commons 0 license. Essentially it's Public Domain- you can do
whatever you want with these sounds (even make commercial software), no royalties, no credit,
no special terms." Thanks to Versilian Studios and the contributors.

| File | Instrument | Recordings used |
|---|---|---|
| `piano.js` | Upright piano (Knight), sampled by Simon Dalzell of Ivy Audio for VSCO 2 Pro | `Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_vl1_rr1_*.wav`: 14 notes, B1 to D#6 (MIDI 35–87, every major third), soft layer |
| `vibes.js` | Vibraphone, soft mallets | `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_{A2,C3,E3,G3,B3,D4,F4,A4,C5,E5}_v1_*_Main.wav`: 10 notes, A3 to E6 (MIDI 57–88) |
| `kalimba.js` | Kalimba, Kenya | `Idiophones/Plucked Idiophones/Kalimba, Kenya/Mbira6_Normal_MainSpirit_{B2_k8,C#3_k7,D#3_k6,F#3_k5,G#3_k4,B3_k3,C#4_k2,D#4_k13,F#4_k14,A4_k1}_vl3_rr2.wav`: 10 tines |
| `drums.js` (kick) | Bass drum | `Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_{v2_rr1,v2_rr2,v3_rr1}_Sum.wav` |
| `drums.js` (rim) | Snare, cross-stick | `.../Snare Drum, Modern 2/Snare3M_Xstick_v2_rr{1,2}_Mid.wav`, `.../Snare Drum, Modern 3/Snare4_Xstick_v2_rr1_Mid.wav` |
| `drums.js` (snare, tap) | Snare, soft hit and taps | `.../Snare Drum, Modern 2/Snare3M_HitSN_v2_rr{1,2}_Mid.wav`, `Snare3M_taps_v4_rr{1,2}_Mid.wav` |
| `drums.js` (hat, pedal) | Hi-hat, closed and foot | `Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v{1,2}_rr{1,2}_Mid.wav`, `HiHat_Close_rr1_Mid.wav` |
| `drums.js` (shaker) | Small shaker | `Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_{Down,Up}_rr{1,2}.wav` |
| `piano2.js` | The same upright piano, its louder layer (played for accented notes) | `Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_vl2_rr1_*.wav`: 8 notes, G3 to B5 (MIDI 55–83, every major third). Fetched 2026-10-31 |
| `bowed.js` | Vibraphone, bowed | `Idiophones/Struck Idiophones/Vibraphone/Bowed/Vibes_bowed_{A2,E3,G3,D4,A4}_rr1_Main.wav`: 5 notes, A3 to A5 (MIDI 57–81). Fetched 2026-10-31 |

### University of Iowa Electronic Music Studios — Musical Instrument Samples (MIS)

<https://theremin.music.uiowa.edu/MIS.html>, by Lawrence Fritts and the Electronic Music
Studios. The site's terms: "Since 1997, these recordings have been freely available on this
website and may be downloaded and used for any projects, without restrictions."

| File | Instrument | Recordings used |
|---|---|---|
| `guitar.js` | Classical (nylon) guitar, Raimundo 118, played by Brian Penkrot (2011) | mono chromatic-scale files `Guitar.mf.{sulA.C3B3,sulD.D3B3,sulG.C4B4,sulB.C4B4,sulB.C5Gb5,sul_E.C5B5}.mono.aif`: 10 notes, E3 to G5 (MIDI 52–79), cut from the scales |
| `bass.js` | Double bass (Anton Krutz, 2004), pizzicato, played by Mike White (2012) | `Bass.pizz.{sulE.mf.E1B1,sulE.mf.C2B2,sulA.mf.C2B2,sulD.mf.C3A3}.mono.aif`: 9 notes, E1 to E3 (MIDI 28–52), cut from the scales |

### Karoryfer Samples — CC0 1.0 Universal

Fetched 2026-10-31 from the SFZ Instruments mirror on GitHub. Each repository's `license` /
`LICENSE` file is the full, unmodified CC0 1.0 Universal legal code (read in full; the two files
are identical). The Swirly Drums changelog says "License changed to free" (version 1.104); the
cello's readme says "This instrument is open source, and you can do whatever you want with it"
and "royalty-free for all commercial and non-commercial use". Thanks to Karoryfer Samples
(D. Smolken) and bigcat instruments.

| File | Instrument | Recordings used |
|---|---|---|
| `brushes.js` | Swirly Drums, a jazz kit played with brushes (Karoryfer Samples) — <https://github.com/sfzinstruments/karoryfer.swirly-drums> | `Samples/snare_main/snare_hit_vl7_rr{1-4}_top.wav` (brushed snare), `snare_hit_vl2_rr{1-3}_top.wav` (soft brush taps), `snare_stir/stir_dl1_rr{1,3}.wav` (long stirs), `snare_stir/stir_dl4_rr{1,2}.wav` (short, fast stirs), `ride/ride_vl4_rr{1-3}.wav` (ride, brushed), `hat_tight/hh_tight_vl6_rr{1,2}.wav` (closed hi-hat, brushed) |
| `cello.js` | Karoryfer x bigcat cello, arco sustain, played by Kamila Borowiak — <https://github.com/sfzinstruments/karoryfer-bigcat.cello> | `Samples/sus/{C1,Eb1,Gb1,A1,C2,Eb2,Gb2,A2,C3}_p_d.wav` (soft, one bow direction): 9 notes, C2 to C4 (MIDI 36–60; the library names its notes an octave low) |

The Rhodes: no electric-piano recording with a CC0 or equally free licence was found (checked:
VCSL, which has none; the SFZ Instruments list, where jRhodes3c/3d are CC-BY-NC and the Greg
Sullivan electric pianos CC-BY 3.0 per the mirror's README, with the chain back to the author not
verifiable; Freesound's CC0 instrument samples, which hold
single short notes and chords only). So the "Rhodes-like" keys are still the upright piano,
dulled and given a gentle tremolo by the engine.

## What was done to them

- Each note was cut from its file: the attack found (on a high-passed copy for the guitar,
  whose recordings carry low rumble), 3 ms before it faded in, the note kept for 2–6.5 s or
  until it fell 62 dB below its peak, then faded out with a half-cosine. Stereo files were
  mixed to mono.
- Levels: each note's attack (first 300 ms) was pulled part-way towards the instrument's
  median so no note jumps out, then one gain per instrument set its loudest peak to −1 dBFS.
  The drums keep the levels between their takes.
- High-pass filters: guitar 90 Hz, bass 28 Hz, cello 40 Hz, drums 30–400 Hz and brushes
  90–300 Hz depending on the drum (room rumble). Nothing else was equalised.
- The bowed notes (cello, bowed vibraphone) swell in slowly, so they were balanced on the whole
  note (4–6 s) instead of its first 300 ms, and kept 4.6 s (cello) and 9 s (vibraphone) long;
  the engine chains them for longer notes, the way a player changes bow, and never loops one.
  The brushed kit keeps one strike per kind (all takes of a kind are the same dynamic), so the
  takes can rotate without jumping in level; the stirs are kept 7 s and 3 s long.
- Tuning: the pitch of every note was measured (to a few cents) and stored next to it; the
  engine corrects it when playing. The kalimba is tuned by ear and the pizzicato bass is
  fretless, so some notes are 10–45 cents off. The piano keeps its tuner's stretch.
- Encoding: libopus, mono, 48 kHz, 32–48 kbit/s VBR, then base64. The first six files were
  encoded with ffmpeg 7.0.2 (2026-10-04); `piano2.js`, `bowed.js`, `cello.js` and
  `brushes.js` with the ffmpeg build N-127371 (2026-10-11), whose libopus writes different
  bytes for the same input, so a rebuild matches the files byte for byte only with the same
  ffmpeg. Total 2.71 MB.
