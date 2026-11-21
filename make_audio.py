import json
import os
import re
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SAMPLE_RATE = 44100


def bandpass_noise(rng, n_samples, lo_hz, hi_hz):
    noise = rng.standard_normal(n_samples).astype(np.float64)
    nyq = 0.5 * SAMPLE_RATE
    lo = max(10.0, lo_hz) / nyq
    hi = min(nyq * 0.96, hi_hz) / nyq
    sos = butter(2, [lo, hi], btype="bandpass", output="sos")
    return sosfilt(sos, noise)


def lowpass_noise(rng, n_samples, cutoff_hz):
    noise = rng.standard_normal(n_samples).astype(np.float64)
    nyq = 0.5 * SAMPLE_RATE
    hi = min(nyq * 0.96, cutoff_hz) / nyq
    sos = butter(2, hi, btype="lowpass", output="sos")
    return sosfilt(sos, noise)


def midi_to_hz(midi_note):
    return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))


def find_word_time(timings, beat_id, pattern, fallback):
    regex = re.compile(pattern, re.IGNORECASE)
    for w in timings.get("words", []):
        if w.get("beat") == beat_id and regex.search(w.get("text", "")):
            return float(w["start"])
    return float(fallback)


def compute_voice_ducking(vo, num_samples):
    """Compute smooth lookahead attack/release envelope from VO for broadcast ducking."""
    block = 220  # ~5ms blocks at 44.1kHz
    n_blocks = (num_samples + block - 1) // block
    padded = np.zeros(n_blocks * block, dtype=np.float64)
    padded[:num_samples] = vo[:num_samples]
    blocks = padded.reshape(n_blocks, block)

    blk_rms = np.sqrt(np.mean(blocks * blocks, axis=1))
    blk_peak = np.max(np.abs(blocks), axis=1)
    raw_level = 0.72 * blk_rms + 0.28 * blk_peak

    # 10ms lookahead so ducking engages just ahead of vocal consonants
    lookahead = 2
    if n_blocks > lookahead:
        raw_level = np.concatenate([raw_level[lookahead:], np.zeros(lookahead)])

    dt_blk = block / SAMPLE_RATE
    alpha_att = 1.0 - np.exp(-dt_blk / 0.014)
    alpha_rel = 1.0 - np.exp(-dt_blk / 0.240)

    env_blk = np.empty(n_blocks, dtype=np.float64)
    cur = 0.0
    for k in range(n_blocks):
        lvl = raw_level[k]
        alpha = alpha_att if lvl > cur else alpha_rel
        cur += alpha * (lvl - cur)
        env_blk[k] = cur

    block_centers = (np.arange(n_blocks) + 0.5) * block
    sample_idx = np.arange(num_samples, dtype=np.float64)
    vo_env = np.interp(sample_idx, block_centers, env_blk)

    speech_act = np.clip((vo_env - 0.015) / 0.120, 0.0, 1.0)
    bed_duck = 1.0 - 0.874 * speech_act  # -18.0 dB duck on BGM when narration is active
    sfx_duck = 1.0 - 0.50 * speech_act   # -6.0 dB duck on SFX under speech
    return bed_duck, sfx_duck, speech_act


def add_slice(buf, start_s, sig):
    idx0 = int(round(start_s * SAMPLE_RATE))
    if idx0 >= len(buf) or idx0 + len(sig) <= 0:
        return
    src0 = max(0, -idx0)
    dst0 = max(0, idx0)
    length = min(len(sig) - src0, len(buf) - dst0)
    if length > 0:
        buf[dst0 : dst0 + length] += sig[src0 : src0 + length]


def synth_marimba_note(rng, freq_hz, amp=0.14, note_dur=0.46):
    """Warm woody marimba bar synthesis with tuned 4th-partial bloom and felt mallet thud."""
    ln = int(round(SAMPLE_RATE * note_dur))
    t = np.arange(ln, dtype=np.float64) / SAMPLE_RATE
    env_fund = (1.0 - np.exp(-t / 0.0045)) * np.exp(-t / 0.165)
    env_body2 = (1.0 - np.exp(-t / 0.003)) * np.exp(-t / 0.075)
    env_bar4 = (1.0 - np.exp(-t / 0.0018)) * np.exp(-t / 0.026)

    # Subtle filtered wood mallet knock transient
    mallet_noise = bandpass_noise(rng, ln, 320.0, 950.0) * np.exp(-t / 0.0055)
    sig = (
        env_fund * np.sin(2.0 * np.pi * freq_hz * t)
        + 0.10 * env_body2 * np.sin(2.0 * np.pi * (2.0 * freq_hz) * t)
        + 0.11 * env_bar4 * np.sin(2.0 * np.pi * (3.98 * freq_hz) * t)
        + 0.14 * mallet_noise
    )
    fade_tail = min(ln // 4, int(0.020 * SAMPLE_RATE))
    if fade_tail > 0:
        sig[-fade_tail:] *= np.linspace(1.0, 0.0, fade_tail)
    return amp * sig


def synth_pizzicato_note(freq_hz, amp=0.12, note_dur=0.52):
    """Warm upright pizzicato pluck for harmonic storytelling foundation."""
    ln = int(round(SAMPLE_RATE * note_dur))
    t = np.arange(ln, dtype=np.float64) / SAMPLE_RATE
    inst_f = freq_hz * (1.0 + 0.012 * np.exp(-t / 0.008))
    ph = 2.0 * np.pi * np.cumsum(inst_f) / SAMPLE_RATE
    env = (1.0 - np.exp(-t / 0.0055)) * np.exp(-t / 0.21)
    sig = env * (
        0.74 * np.sin(ph)
        + 0.26 * np.sin(2.0 * ph) * np.exp(-t / 0.10)
        + 0.08 * np.sin(3.0 * ph) * np.exp(-t / 0.05)
    )
    fade_tail = min(ln // 4, int(0.020 * SAMPLE_RATE))
    if fade_tail > 0:
        sig[-fade_tail:] *= np.linspace(1.0, 0.0, fade_tail)
    return amp * sig


def build_marimba_story_groove(rng, num_samples, duration):
    """Build @dexplainedid-style 108 BPM A-minor/C-major pentatonic marimba/pizzicato groove."""
    bed = np.zeros(num_samples, dtype=np.float64)
    step_s = 60.0 / 108.0 / 4.0  # 16th note at 108 BPM (~0.1389s)

    # 4-bar 16th-note groove in A minor / C major pentatonic (A, C, D, E, G)
    mel_bars = [
        [69, None, 72, 76, None, 67, 69, None, 76, None, 74, 72, 69, None, 67, 64],
        [72, None, 76, 79, None, 76, 74, None, 72, None, 69, 67, 64, None, 67, 69],
        [74, None, 76, 72, None, 69, 72, None, 74, None, 76, 79, 76, None, 74, 72],
        [67, None, 69, 72, None, 74, 76, None, 74, None, 72, 69, 67, None, 64, 67],
    ]
    bass_bars = [
        [45, None, None, None, None, None, 45, None, 48, None, None, None, 43, None, None, None],
        [48, None, None, None, None, None, 48, None, 43, None, None, None, 45, None, None, None],
        [50, None, None, None, None, None, 50, None, 45, None, None, None, 48, None, None, None],
        [43, None, None, None, None, None, 43, None, 40, None, None, None, 43, None, None, None],
    ]

    total_steps = int(duration / step_s) + 1
    for s in range(total_steps):
        bar = (s // 16) % 4
        st = s % 16
        t0 = s * step_s
        if t0 >= duration - 0.12:
            break

        m_note = mel_bars[bar][st]
        if m_note is not None:
            vel = 1.0 if st % 4 == 0 else (0.76 if st % 2 == 0 else 0.62)
            sig = synth_marimba_note(rng, midi_to_hz(m_note), amp=0.145 * vel)
            add_slice(bed, t0, sig)

        b_note = bass_bars[bar][st]
        if b_note is not None:
            vel_b = 1.0 if st == 0 else 0.80
            sig_b = synth_pizzicato_note(midi_to_hz(b_note), amp=0.125 * vel_b)
            add_slice(bed, t0, sig_b)

        # Gentle brushed shaker tick on off-beat 8th notes for light storytelling pulse
        if st % 4 == 2:
            sh_n = int(0.032 * SAMPLE_RATE)
            sht = np.arange(sh_n, dtype=np.float64) / SAMPLE_RATE
            shaker = bandpass_noise(rng, sh_n, 2800.0, 5600.0) * np.exp(-sht / 0.009)
            add_slice(bed, t0, 0.038 * shaker)

    return bed


def add_cartoon_pop(sfx, rng, start_s, f_start=420.0, f_end=880.0, amp=0.13):
    """Crisp playful pop for clipboard/blueprint callout appearances."""
    dur = 0.075
    n = int(round(dur * SAMPLE_RATE))
    t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    p = t / dur
    freq = f_start + (f_end - f_start) * (1.0 - np.exp(-p * 5.0))
    ph = 2.0 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.sin(np.pi * np.clip(p, 0.0, 1.0)) ** 0.75 * np.exp(-t * 28.0)
    click = bandpass_noise(rng, n, 1100.0, 2900.0) * np.exp(-t * 90.0)
    add_slice(sfx, start_s, amp * (0.85 * env * np.sin(ph) + 0.35 * click))


def add_chibi_whoosh(sfx, rng, start_s, dur=0.22, f_lo=260.0, f_hi=1350.0, amp=0.095):
    """Light playful whip-whoosh for chibi head turns and crisp transitions."""
    n = int(round(dur * SAMPLE_RATE))
    t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    p = t / dur
    env = np.sin(np.pi * p) ** 1.4
    sw = (1.0 - p) * bandpass_noise(rng, n, f_lo, f_lo * 2.1) + p * bandpass_noise(
        rng, n, f_lo * 1.8, f_hi
    )
    pitch_sweep = np.sin(2.0 * np.pi * (240.0 + 380.0 * np.sin(np.pi * p)) * t)
    add_slice(sfx, start_s, env * amp * (0.82 * sw + 0.25 * pitch_sweep))


def add_snap_clunk(sfx, rng, start_s, base_hz=175.0, amp=0.13):
    """Mechanical airframe snap-in clunk for Beat 1->2 assembly locks."""
    dur = 0.13
    n = int(round(dur * SAMPLE_RATE))
    t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    clack = bandpass_noise(rng, n, 950.0, 2800.0) * np.exp(-t * 62.0)
    thud = np.sin(2.0 * np.pi * (base_hz - 95.0 * (t / dur)) * t) * np.exp(-t * 36.0)
    metallic = np.sin(2.0 * np.pi * (base_hz * 3.1) * t) * np.exp(-t * 48.0)
    add_slice(sfx, start_s, amp * (0.88 * thud + 0.65 * clack + 0.28 * metallic))


def add_titanium_knock(sfx, rng, start_s, amp=0.16):
    """Dense metallic titanium plate double-knock for Beat 4 bathtub armor reveal."""
    for offset, pitch_mul, gain in [(0.0, 1.0, 1.0), (0.14, 1.12, 0.72)]:
        dur = 0.24
        n = int(round(dur * SAMPLE_RATE))
        t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
        # Thick Ti-6Al-4V plate modal partials + solid impact transient
        modes = (
            0.55 * np.sin(2.0 * np.pi * (340.0 * pitch_mul) * t) * np.exp(-t * 20.0)
            + 0.35 * np.sin(2.0 * np.pi * (795.0 * pitch_mul) * t) * np.exp(-t * 28.0)
            + 0.22 * np.sin(2.0 * np.pi * (1420.0 * pitch_mul) * t) * np.exp(-t * 42.0)
            + 0.30 * np.sin(2.0 * np.pi * (110.0 * pitch_mul) * t) * np.exp(-t * 32.0)
        )
        tap = bandpass_noise(rng, n, 1200.0, 3800.0) * np.exp(-t * 95.0)
        add_slice(sfx, start_s + offset, amp * gain * (modes + 0.45 * tap))


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--out-dir" and i + 1 < len(argv):
            out_dir = os.path.abspath(argv[i + 1])
    timings_path = os.path.join(out_dir, "vo_timings.json")
    vo_path = os.path.join(out_dir, "vo.wav")

    with open(timings_path, "r", encoding="utf-8") as f:
        timings = json.load(f)

    beats = {b["id"]: b for b in timings["beats"]}
    beat_list = timings["beats"]
    duration = float(timings["total_duration"])

    with wave.open(vo_path, "rb") as wf:
        assert wf.getframerate() == SAMPLE_RATE
        assert wf.getnchannels() == 1
        raw = wf.readframes(wf.getnframes())
        vo_raw = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0

    num_samples = max(len(vo_raw), int(round(SAMPLE_RATE * duration)))
    vo = np.zeros(num_samples, dtype=np.float64)
    vo[: len(vo_raw)] = vo_raw

    rng = np.random.default_rng(42)
    t = np.arange(num_samples, dtype=np.float64) / SAMPLE_RATE

    bed_duck, sfx_duck, _ = compute_voice_ducking(vo, num_samples)

    # =========================================================================
    # 1. Warm Plucked Marimba / Pizzicato Groove (~108 BPM)
    # =========================================================================
    bed = build_marimba_story_groove(rng, num_samples, duration)
    sfx = np.zeros(num_samples, dtype=np.float64)

    is_a10_beats = all(k in beats for k in ("hook", "assemble", "recoil", "igniter_tub", "outro"))
    if is_a10_beats:
        t_hook_s = beats["hook"]["start"]
        t_hook_e = beats["hook"]["end"]
        t_assemble = beats["assemble"]["start"]
        t_assemble_end = beats["assemble"]["end"]
        t_recoil = beats["recoil"]["start"]
        t_igniter = beats["igniter_tub"]["start"]
        t_igniter_end = beats["igniter_tub"]["end"]
        t_outro = beats["outro"]["start"]
        t_outro_end = beats["outro"]["end"]

        t_flip = find_word_time(timings, "hook", r"kebalik|terbalik", t_hook_s + (t_hook_e - t_hook_s) * 0.5)
        t_asm_start = find_word_time(timings, "hook", r"dirakit|mengelilingi", t_hook_e - 1.5)
        t_titanium_word = find_word_time(timings, "igniter_tub", r"titanium", t_igniter + 5.0)
        t_gear_word = find_word_time(timings, "recoil", r"digeser", t_recoil + 5.5)

        spool_start = max(t_asm_start + 0.5, t_assemble - 0.6)
        spool_p = np.clip((t - spool_start) / 1.4, 0.0, 1.0)
        spool_env = spool_p * spool_p * (3.0 - 2.0 * spool_p)
        jet_air = bandpass_noise(rng, num_samples, 160.0, 420.0)
        turb_freq = 118.0 + 36.0 * spool_env
        turb_ph = 2.0 * np.pi * np.cumsum(turb_freq) / SAMPLE_RATE
        bed += spool_env * (0.0085 * jet_air + 0.0045 * np.sin(turb_ph))

        add_cartoon_pop(sfx, rng, 0.45, f_start=380.0, f_end=840.0, amp=0.14)
        add_chibi_whoosh(sfx, rng, 1.15, dur=0.20, f_lo=260.0, f_hi=1280.0, amp=0.09)
        add_chibi_whoosh(sfx, rng, 2.20, dur=0.22, f_lo=300.0, f_hi=1420.0, amp=0.095)
        add_chibi_whoosh(sfx, rng, 3.55, dur=0.20, f_lo=280.0, f_hi=1320.0, amp=0.085)
        add_cartoon_pop(sfx, rng, max(0.2, t_flip - 0.18), f_start=480.0, f_end=1040.0, amp=0.15)
        add_chibi_whoosh(sfx, rng, t_flip, dur=0.34, f_lo=220.0, f_hi=1500.0, amp=0.11)

        snap_offsets = [(0.05, 155.0), (0.38, 185.0), (0.68, 210.0), (0.98, 165.0)]
        for off, hz in snap_offsets:
            add_snap_clunk(sfx, rng, t_asm_start + off, base_hz=hz, amp=0.13)
        add_chibi_whoosh(sfx, rng, t_assemble, dur=0.36, f_lo=200.0, f_hi=1350.0, amp=0.10)
        add_cartoon_pop(sfx, rng, t_assemble + 0.12, f_start=440.0, f_end=920.0, amp=0.12)

        l_dur = 0.12
        l_n = int(round(l_dur * SAMPLE_RATE))
        lt = np.arange(l_n, dtype=np.float64) / SAMPLE_RATE
        lp = lt / l_dur
        laser_ping = np.sin(np.pi * lp) ** 1.1 * 0.055 * np.sin(2.0 * np.pi * (880.0 + 490.0 * lp) * lt)
        add_slice(sfx, t_recoil + 0.35, laser_ping)

        s_dur = 0.62
        s_n = int(round(s_dur * SAMPLE_RATE))
        st = np.arange(s_n, dtype=np.float64) / SAMPLE_RATE
        sp = st / s_dur
        s_env = np.clip(sp / 0.12, 0.0, 1.0) * np.clip((1.0 - sp) / 0.18, 0.0, 1.0)
        servo_freq = 330.0 + 250.0 * np.sin(np.pi * np.clip(sp * 1.15, 0.0, 1.0)) - 90.0 * sp
        servo_ph = 2.0 * np.pi * np.cumsum(servo_freq) / SAMPLE_RATE
        servo_tone = (0.58 * np.sin(servo_ph) + 0.25 * np.sin(2.0 * servo_ph)) * (
            0.85 + 0.15 * np.sin(2.0 * np.pi * 24.0 * st)
        )
        hyd_hiss = bandpass_noise(rng, s_n, 1400.0, 3400.0)
        add_slice(sfx, t_recoil + 1.35, s_env * (0.068 * servo_tone + 0.048 * hyd_hiss))
        add_snap_clunk(sfx, rng, t_recoil + 1.88, base_hz=125.0, amp=0.15)
        add_chibi_whoosh(sfx, rng, max(t_recoil + 2.5, t_gear_word - 0.08), dur=0.24, f_lo=260.0, f_hi=1250.0, amp=0.085)

        ig_s = t_igniter + 0.85
        ig_mid = 0.5 * (t_igniter + t_igniter_end)
        ig_e = min(t_igniter + 4.4, ig_mid + 0.85)
        ig_dur = max(1.2, ig_e - ig_s)
        ig_n = int(round(ig_dur * SAMPLE_RATE))
        igt = np.arange(ig_n, dtype=np.float64) / SAMPLE_RATE
        ig_fade = np.clip(igt / 0.08, 0.0, 1.0) * np.clip((ig_dur - igt) / 0.14, 0.0, 1.0)

        arc_train = np.zeros(ig_n, dtype=np.float64)
        cursor_s = 0.02
        while cursor_s < ig_dur - 0.03:
            idx_a = int(round(cursor_s * SAMPLE_RATE))
            span = int(0.005 * SAMPLE_RATE)
            end_a = min(ig_n, idx_a + span)
            if end_a > idx_a:
                at = np.arange(end_a - idx_a, dtype=np.float64) / SAMPLE_RATE
                arc_train[idx_a:end_a] += rng.uniform(0.45, 1.0) * np.exp(-at * 700.0) * rng.choice([-1.0, 1.0])
            cursor_s += rng.uniform(0.018, 0.048)

        arc_crackle = bandpass_noise(rng, ig_n, 2300.0, 5800.0) * (
            0.35 + 2.5 * np.clip(np.abs(arc_train) * 2.4, 0.0, 1.4)
        )
        coil_buzz = 0.5 * np.sin(2.0 * np.pi * 100.0 * igt) + 0.3 * np.sin(2.0 * np.pi * 200.0 * igt)
        add_slice(sfx, ig_s, ig_fade * (0.14 * arc_crackle + 0.085 * arc_train + 0.020 * coil_buzz))

        t_tub_pop = min(t_igniter + 3.0, ig_mid - 0.85)
        add_titanium_knock(sfx, rng, t_tub_pop, amp=0.16)
        if abs(t_titanium_word - t_tub_pop) > 0.65:
            add_titanium_knock(sfx, rng, t_titanium_word, amp=0.14)

        burst_windows = [
            (t_assemble_end - 1.50, t_assemble_end - 0.15, 0.21, 0.36),
            (t_igniter + 2.20, t_igniter + 3.60, 0.19, 0.36),
            (t_outro + 0.45, min(duration - 1.85, t_outro_end + 0.25), 0.28, 0.45),
        ]
        for bs, be, level, tail_dur in burst_windows:
            if be <= bs + 0.15:
                continue
            sp_dur = 0.12
            sp_n = int(round(sp_dur * SAMPLE_RATE))
            spt = np.arange(sp_n, dtype=np.float64) / SAMPLE_RATE
            spp = spt / sp_dur
            sp_ph = 2.0 * np.pi * np.cumsum(190.0 + 135.0 * spp) / SAMPLE_RATE
            add_slice(sfx, bs - 0.11, (spp ** 1.4) * 0.05 * (np.sin(sp_ph) + 0.4 * np.sin(2.0 * sp_ph)))

            b_dur = be - bs
            b_n = int(round(b_dur * SAMPLE_RATE))
            bt = np.arange(b_n, dtype=np.float64) / SAMPLE_RATE
            b_fade = np.clip(bt / 0.05, 0.0, 1.0) * np.clip((b_dur - bt) / 0.08, 0.0, 1.0)

            phi = 2.0 * np.pi * 65.0 * bt
            harm_stack = (
                0.54 * np.sin(phi)
                + 0.38 * np.sin(2.0 * phi + 0.4)
                + 0.26 * np.sin(3.0 * phi + 0.8)
                + 0.18 * np.sin(4.0 * phi + 1.1)
                + 0.12 * np.sin(5.0 * phi + 1.5)
            )
            ripping_core = np.tanh(1.6 * harm_stack)
            pulse_65 = (0.5 + 0.5 * np.cos(phi)) ** 3.0
            muzzle_crack = bandpass_noise(rng, b_n, 480.0, 3800.0) * (0.24 + 0.95 * pulse_65)
            sub_thump = lowpass_noise(rng, b_n, 115.0) * (0.48 + 0.65 * pulse_65)

            burst_sig = b_fade * level * (0.52 * ripping_core + 0.35 * muzzle_crack + 0.28 * sub_thump)
            add_slice(sfx, bs, burst_sig)

            for k in range(5):
                t_tink = bs + 0.28 + k * 0.17
                if t_tink < be + 0.25:
                    tn = int(0.055 * SAMPLE_RATE)
                    tt = np.arange(tn, dtype=np.float64) / SAMPLE_RATE
                    f_tink = rng.uniform(3200.0, 4400.0)
                    tink = np.sin(2.0 * np.pi * f_tink * tt) * np.exp(-tt * 75.0)
                    add_slice(sfx, t_tink, 0.018 * tink)

            tl_n = int(round(tail_dur * SAMPLE_RATE))
            tlt = np.arange(tl_n, dtype=np.float64) / SAMPLE_RATE
            tl_env = np.clip(tlt / 0.04, 0.0, 1.0) * np.exp(-tlt * 5.2)
            tail_rumble = bandpass_noise(rng, tl_n, 65.0, 340.0) + 0.25 * np.sin(2.0 * np.pi * 65.0 * tlt)
            add_slice(sfx, be - 0.04, tl_env * level * 0.40 * tail_rumble)

        t_payoff = min(duration - 1.65, t_outro_end + 0.10)
        if t_payoff > t_outro + 0.5:
            add_chibi_whoosh(sfx, rng, t_payoff, dur=0.30, f_lo=260.0, f_hi=1480.0, amp=0.11)
            add_cartoon_pop(sfx, rng, t_payoff + 0.28, f_start=420.0, f_end=980.0, amp=0.15)
            add_cartoon_pop(sfx, rng, t_payoff + 0.48, f_start=520.0, f_end=1180.0, amp=0.14)
    else:
        # Generic storyteller foley across arbitrary beat timelines (whooshes + pops on transitions)
        for bi, b in enumerate(beat_list):
            bs = float(b["start"])
            if bi == 0:
                add_cartoon_pop(sfx, rng, bs + 0.35, f_start=380.0, f_end=840.0, amp=0.13)
            else:
                add_chibi_whoosh(sfx, rng, max(0.0, bs - 0.10), dur=0.28, f_lo=240.0, f_hi=1380.0, amp=0.10)
                add_cartoon_pop(sfx, rng, bs + 0.12, f_start=420.0, f_end=940.0, amp=0.12)
        if beat_list:
            t_last_end = float(beat_list[-1]["end"])
            t_pay = min(duration - 1.55, t_last_end + 0.05)
            add_chibi_whoosh(sfx, rng, max(0.0, t_pay), dur=0.30, f_lo=260.0, f_hi=1460.0, amp=0.11)
            add_cartoon_pop(sfx, rng, t_pay + 0.28, f_start=420.0, f_end=980.0, amp=0.14)
            add_cartoon_pop(sfx, rng, t_pay + 0.48, f_start=520.0, f_end=1180.0, amp=0.13)

    bed_fade = np.clip(t / 0.25, 0.0, 1.0) * np.clip((duration - t) / 0.35, 0.0, 1.0)
    bed *= bed_fade

    # =========================================================================
    # 3. Broadcast Mix, Two-Pass Loudnorm (-14 LUFS, TP <= -1.5 dBTP) & Stereo
    # =========================================================================
    mixed = vo * 1.08 + bed * bed_duck + sfx * sfx_duck

    n_fi = min(num_samples // 4, int(0.015 * SAMPLE_RATE))
    n_fo = min(num_samples // 4, int(0.150 * SAMPLE_RATE))
    mixed[:n_fi] *= np.linspace(0.0, 1.0, n_fi)
    mixed[-n_fo:] *= np.linspace(1.0, 0.0, n_fo)
    mixed = np.clip(mixed, -0.95, 0.95)

    out_int16 = (mixed * 32767.0).astype(np.int16)
    raw_mix_wav = os.path.join(out_dir, "raw_mix_tmp.wav")
    with wave.open(raw_mix_wav, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        stereo_int16 = np.column_stack([out_int16, out_int16]).ravel()
        wf.writeframes(stereo_int16.tobytes())

    # Pass 1: measure stereo loudness stats
    p1 = subprocess.run(
        [
            "ffmpeg", "-y", "-i", raw_mix_wav,
            "-af", "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True, text=True, check=True,
    )
    m_json = re.search(r"\{[\s\S]*\"input_i\"[\s\S]*\}", p1.stderr)
    if not m_json:
        raise RuntimeError(f"Failed to parse loudnorm stats:\n{p1.stderr[-400:]}")
    stats = json.loads(m_json.group(0))

    # Pass 2: linear loudnorm on stereo + safety true-peak limiter (-1.50 dBFS = 0.841)
    af_pass2 = (
        f"loudnorm=I=-14:TP=-1.5:LRA=7:"
        f"measured_I={stats['input_i']}:"
        f"measured_TP={stats['input_tp']}:"
        f"measured_LRA={stats['input_lra']}:"
        f"measured_thresh={stats['input_thresh']}:"
        f"offset={stats['target_offset']}:"
        "linear=true,"
        "alimiter=limit=0.841:level=false:asc=false,"
        "aresample=44100"
    )
    final_wav = os.path.join(out_dir, "final_audio.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", raw_mix_wav, "-af", af_pass2, "-ac", "2", "-ar", "44100", final_wav],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    os.remove(raw_mix_wav)

    print(f"Mixed stereo final audio: {final_wav} ({num_samples / SAMPLE_RATE:.2f}s)")


if __name__ == "__main__":
    main()
