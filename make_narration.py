import base64
import json
import math
import os
import re
import struct
import subprocess
import sys
import urllib.request
import wave

GEMINI_MODEL = "models/gemini-2.5-flash-preview-tts"
VOICE_NAME = "Puck"
TEMPO = 1.07
INTRA_BEAT_PAUSE = 0.20
SENTENCE_PAUSE = 0.25
INTER_BEAT_PAUSE = 0.28
LEAD_IN = 0.18
TAIL_PAD = 1.95

BEATS = [
    {
        "id": "hook",
        "clauses": [
            {
                "tts": "Biasanya, insinyur bikin badan pesawatnya dulu,",
                "caption": "Biasanya, insinyur bikin badan pesawatnya dulu,",
            },
            {
                "tts": "baru mikir senjatanya dipasang di mana.",
                "caption": "baru mikir senjatanya dipasang di mana.",
            },
            {
                "tts": "Tapi pesawat tempur ini kebalik!",
                "caption": "Tapi pesawat tempur ini kebalik!",
            },
            {
                "tts": "Meriam raksasanya dibuat duluan, baru pesawatnya dirakit mengelilingi meriam itu.",
                "caption": "Meriam raksasanya dibuat duluan, baru pesawatnya dirakit mengelilingi meriam itu.",
            },
        ],
    },
    {
        "id": "assemble",
        "clauses": [
            {
                "tts": "Jadi gini ceritanya.",
                "caption": "Jadi gini ceritanya.",
            },
            {
                "tts": "Inilah A-sepuluh Warthog!",
                "caption": "Inilah A-10 Warthog!",
            },
            {
                "tts": "Di hidungnya ada meriam putar G-A-U delapan kaliber tiga puluh milimeter,",
                "caption": "Di hidungnya ada meriam putar GAU-8 kaliber 30 milimeter,",
            },
            {
                "tts": "yang memuntahkan tiga ribu sembilan ratus peluru per menit.",
                "caption": "yang memuntahkan 3.900 peluru per menit.",
            },
        ],
    },
    {
        "id": "recoil",
        "clauses": [
            {
                "tts": "Masalahnya,",
                "caption": "Masalahnya,",
            },
            {
                "tts": "tendangan balik meriam ini lebih kuat dari satu mesin jetnya.",
                "caption": "tendangan balik meriam ini lebih kuat dari satu mesin jetnya.",
            },
            {
                "tts": "Supaya pesawat nggak melintir waktu nembak,",
                "caption": "Supaya pesawat nggak melintir waktu nembak,",
            },
            {
                "tts": "meriamnya dipasang persis di garis tengah,",
                "caption": "meriamnya dipasang persis di garis tengah,",
            },
            {
                "tts": "dan roda depannya terpaksa digeser ke kanan.",
                "caption": "dan roda depannya terpaksa digeser ke kanan.",
            },
        ],
    },
    {
        "id": "igniter_tub",
        "clauses": [
            {
                "tts": "Belum selesai!",
                "caption": "Belum selesai!",
            },
            {
                "tts": "Asap meriamnya bisa bikin mesin jet mati di udara,",
                "caption": "Asap meriamnya bisa bikin mesin jet mati di udara,",
            },
            {
                "tts": "jadi pemantik mesin otomatis menyala tiap pelatuk ditekan.",
                "caption": "jadi pemantik mesin otomatis menyala tiap pelatuk ditekan.",
            },
            {
                "tts": "Pilotnya pun duduk di dalam bak mandi titanium lima ratus lima puluh kilogram.",
                "caption": "Pilotnya pun duduk di dalam bak mandi titanium 550 kilogram.",
            },
        ],
    },
    {
        "id": "outro",
        "clauses": [
            {
                "tts": "Hasilnya,",
                "caption": "Hasilnya,",
            },
            {
                "tts": "ini bukan pesawat yang bawa senjata,",
                "caption": "ini bukan pesawat yang bawa senjata,",
            },
            {
                "tts": "tapi meriam terbang yang kebetulan dikasih sayap.",
                "caption": "tapi meriam terbang yang kebetulan dikasih sayap.",
            },
        ],
    },
]


def load_api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    key_path = os.path.expanduser("~/.config/gemini/key")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    raise RuntimeError("Missing GEMINI_API_KEY and ~/.config/gemini/key")


def synthesize_gemini_raw(raw_wav_path, beats):
    key = load_api_key()
    paragraphs = []
    for beat in beats:
        for cl in beat["clauses"]:
            paragraphs.append(cl["tts"])

    prompt = (
        "Bacakan naskah berikut dengan gaya narator YouTube Shorts Indonesia yang santai, "
        "hangat, ekspresif, dan bercerita seperti manusia asli. Beri jeda napas yang jelas "
        "di setiap pergantian baris:\n\n" + "\n\n".join(paragraphs)
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": VOICE_NAME}
                }
            },
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/{GEMINI_MODEL}:generateContent?key={key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        res = json.loads(resp.read().decode("utf-8"))

    part = res["candidates"][0]["content"]["parts"][0]["inlineData"]
    raw_pcm = base64.b64decode(part["data"])
    with wave.open(raw_wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(raw_pcm)


def detect_speech_segments(samples, sr, rms_thresh=0.012, min_silence=0.20):
    win = int(sr * 0.02)
    rms_vals = []
    for i in range(0, len(samples), win):
        chunk = samples[i : i + win]
        if not chunk:
            continue
        val = math.sqrt(sum(s * s for s in chunk) / len(chunk)) / 32768.0
        rms_vals.append((i / sr, val))

    silences = []
    in_sil = False
    s_start = 0.0
    for t, v in rms_vals:
        if v < rms_thresh:
            if not in_sil:
                in_sil = True
                s_start = t
        else:
            if in_sil:
                if t - s_start >= min_silence:
                    silences.append((s_start, t))
                in_sil = False
    total_dur = len(samples) / sr
    if in_sil and total_dur - s_start >= 0.05:
        silences.append((s_start, total_dur))

    segments = []
    cur = 0.0
    for ss, se in silences:
        if ss - cur >= 0.12:
            segments.append((max(0.0, cur - 0.03), min(total_dur, ss + 0.03)))
        cur = se
    if total_dur - cur >= 0.12:
        segments.append((max(0.0, cur - 0.03), total_dur))
    return segments, silences


def syllable_weight(word):
    clean = re.sub(r"[^a-zA-Z0-9]", "", word)
    vowels = len(re.findall(r"[aeiouAEIOU]", clean))
    digits = len(re.findall(r"[0-9]", clean))
    return max(1.0, vowels + digits * 1.5 + 0.35 * len(clean) / 4.0)


def assign_words(caption_text, start_s, dur_s):
    tokens = caption_text.split()
    weights = [syllable_weight(w) for w in tokens]
    total_w = sum(weights) or 1.0
    t_cur = start_s
    out = []
    for tok, w in zip(tokens, weights):
        w_dur = dur_s * (w / total_w)
        out.append({
            "text": tok,
            "start": round(t_cur, 3),
            "end": round(t_cur + w_dur, 3),
        })
        t_cur += w_dur
    return out


def align_segments_to_count(samples, sr, clause_texts):
    target_count = len(clause_texts)
    segs, sils = detect_speech_segments(samples, sr, rms_thresh=0.012, min_silence=0.20)
    if len(segs) == target_count:
        return segs, sils

    # If default threshold splits differently, collect fine segments and use DP to align to syllable weights
    if len(segs) < target_count:
        for ms in (0.16, 0.14, 0.12, 0.10, 0.08):
            segs, sils = detect_speech_segments(samples, sr, rms_thresh=0.012, min_silence=ms)
            if len(segs) >= target_count:
                break
    m = len(segs)
    if m < target_count:
        raise RuntimeError(f"Segment count mismatch: got {m} vs expected {target_count}")

    weights = [sum(syllable_weight(w) for w in txt.split()) for txt in clause_texts]
    tot_w = sum(weights) or 1.0
    exp_fracs = [w / tot_w for w in weights]
    tot_speech = sum(e - s for s, e in segs) or 1.0

    # Prefix sums of raw speech duration inside segments
    pref_speech = [0.0] * (m + 1)
    for i in range(m):
        pref_speech[i + 1] = pref_speech[i] + (segs[i][1] - segs[i][0])

    # DP[k][i] = min cost to assign first i fine segments to first k clauses
    INF = 1e18
    dp = [[INF] * (m + 1) for _ in range(target_count + 1)]
    parent = [[-1] * (m + 1) for _ in range(target_count + 1)]
    dp[0][0] = 0.0

    for k in range(1, target_count + 1):
        for i in range(k, m - (target_count - k) + 1):
            for j in range(k - 1, i):
                if dp[k - 1][j] >= INF:
                    continue
                span_frac = (pref_speech[i] - pref_speech[j]) / tot_speech
                dur_err = ((span_frac - exp_fracs[k - 1]) / max(0.02, exp_fracs[k - 1])) ** 2
                # Reward cutting at longer silence boundaries after seg i-1 (when k < target_count)
                gap_pen = 0.0
                if i < m:
                    gap = max(0.0, segs[i][0] - segs[i - 1][1])
                    gap_pen = 0.12 / max(0.08, gap)
                cost = dp[k - 1][j] + dur_err + gap_pen
                if cost < dp[k][i]:
                    dp[k][i] = cost
                    parent[k][i] = j

    # Backtrack optimal partition
    bounds = []
    cur = m
    for k in range(target_count, 0, -1):
        prev = parent[k][cur]
        bounds.append((segs[prev][0], segs[cur - 1][1]))
        cur = prev
    bounds.reverse()
    return bounds, sils


def main():
    force = "--force" in sys.argv
    beats = BEATS
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--beats-file" and i + 1 < len(argv):
            with open(argv[i + 1], "r", encoding="utf-8") as f:
                beats = json.load(f)
        elif a == "--out-dir" and i + 1 < len(argv):
            out_dir = os.path.abspath(argv[i + 1])

    os.makedirs(out_dir, exist_ok=True)
    raw_wav = os.path.join(out_dir, "gemini_raw_puck.wav")

    if force or not os.path.exists(raw_wav):
        print(f"Synthesizing fresh Gemini TTS ({GEMINI_MODEL}, voice={VOICE_NAME})...")
        synthesize_gemini_raw(raw_wav, beats)
    else:
        print(f"Using cached Gemini TTS audio: {raw_wav}")

    with wave.open(raw_wav, "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw_bytes = wf.readframes(n)
        samples = struct.unpack(f"<{n}h", raw_bytes)

    all_clauses = []
    for beat in beats:
        for cl in beat["clauses"]:
            all_clauses.append((beat["id"], cl["caption"]))

    segments, silences = align_segments_to_count(samples, sr, [c[1] for c in all_clauses])
    print(f"Detected {len(segments)} speech segments (expected {len(all_clauses)})")

    # Extract, tempo-adjust, and master each clause or splice with tightened pauses first
    spliced_samples = []
    lead_samples = int(round(LEAD_IN * TEMPO * sr))
    spliced_samples.extend([0] * lead_samples)

    cur_raw_s = LEAD_IN * TEMPO
    clause_timings = []

    for idx, ((seg_s, seg_e), (beat_id, caption_text)) in enumerate(zip(segments, all_clauses)):
        i0 = max(0, int(round(seg_s * sr)))
        i1 = min(n, int(round(seg_e * sr)))
        seg_slice = list(samples[i0:i1])

        # Gentle 8ms fade-in/out on slice edges to avoid clicks
        fade_n = min(int(0.008 * sr), len(seg_slice) // 4)
        for k in range(fade_n):
            g = k / max(1, fade_n)
            seg_slice[k] = int(seg_slice[k] * g)
            seg_slice[-1 - k] = int(seg_slice[-1 - k] * g)

        seg_dur_raw = len(seg_slice) / sr
        spliced_samples.extend(seg_slice)

        # Determine pause after this clause (in final tempo-adjusted seconds)
        is_last_clause = idx == len(all_clauses) - 1
        next_beat_id = all_clauses[idx + 1][0] if not is_last_clause else None
        if is_last_clause:
            pause_final = TAIL_PAD
        elif next_beat_id != beat_id:
            pause_final = INTER_BEAT_PAUSE
        elif caption_text.rstrip().endswith((".", "!")):
            pause_final = SENTENCE_PAUSE
        else:
            pause_final = INTRA_BEAT_PAUSE

        pause_raw_s = pause_final * TEMPO
        spliced_samples.extend([0] * int(round(pause_raw_s * sr)))

        start_final = cur_raw_s / TEMPO
        dur_final = seg_dur_raw / TEMPO
        clause_timings.append({
            "beat": beat_id,
            "clause": idx,
            "caption": caption_text,
            "start": start_final,
            "end": start_final + dur_final,
            "dur": dur_final,
        })
        cur_raw_s += seg_dur_raw + pause_raw_s

    spliced_wav = os.path.join(out_dir, "vo_spliced_tmp.wav")
    with wave.open(spliced_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{len(spliced_samples)}h", *spliced_samples))

    vo_wav = os.path.join(out_dir, "vo.wav")
    af_chain = (
        f"atempo={TEMPO},"
        "highpass=f=70,"
        "equalizer=f=140:t=q:w=1.1:g=2.2,"
        "equalizer=f=3000:t=q:w=1.3:g=1.8,"
        "acompressor=threshold=-19dB:ratio=2.8:attack=10:release=130:makeup=2.2dB,"
        "loudnorm=I=-14:TP=-1.5:LRA=7,"
        "aresample=44100"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", spliced_wav, "-af", af_chain, "-ac", "1", "-ar", "44100", vo_wav],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    os.remove(spliced_wav)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", vo_wav],
        capture_output=True, text=True, check=True,
    )
    actual_total_dur = round(float(probe.stdout.strip()), 3)
    expected_total_dur = cur_raw_s / TEMPO
    scale = actual_total_dur / max(0.01, expected_total_dur)

    timeline = {"beats": [], "words": [], "total_duration": actual_total_dur}
    beat_groups = {}
    for ct in clause_timings:
        s = ct["start"] * scale
        e = ct["end"] * scale
        d = ct["dur"] * scale
        bid = ct["beat"]
        if bid not in beat_groups:
            beat_groups[bid] = {"id": bid, "start": round(s, 3), "end": round(e, 3), "texts": []}
        else:
            beat_groups[bid]["end"] = round(e, 3)
        beat_groups[bid]["texts"].append(ct["caption"])

        for w in assign_words(ct["caption"], s, d):
            w["beat"] = bid
            w["clause"] = ct["clause"]
            timeline["words"].append(w)

    for beat in beats:
        bg = beat_groups[beat["id"]]
        timeline["beats"].append({
            "id": bg["id"],
            "start": bg["start"],
            "end": bg["end"],
            "text": " ".join(bg["texts"]),
        })

    timings_path = os.path.join(out_dir, "vo_timings.json")
    with open(timings_path, "w", encoding="utf-8") as f:
        json.dump(timeline, f, indent=2, ensure_ascii=False)

    print(f"VO generated: {vo_wav} | duration={actual_total_dur:.2f}s | words={len(timeline['words'])}")
    for b in timeline["beats"]:
        print(f"  [{b['start']:5.2f}s - {b['end']:5.2f}s] {b['id']}")


if __name__ == "__main__":
    main()
