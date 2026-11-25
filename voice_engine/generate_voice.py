#!/usr/bin/env python3
"""Local Dutch narration with Chatterbox Multilingual (T3 v3), cloned from Lisa's authorised reference.

Two modes, one model load per process:

  Single text file -> one WAV
    python voice_engine/generate_voice.py --input scripts/les_01.txt --output voice_engine/output/les_01.wav

  Every scene of a video script -> vo-<scene>.wav (+ vo-<scene>.mp3 for video/assemble.mjs)
    python voice_engine/generate_voice.py --script video/scripts/s1-zoeken-en-vinden.json --lang nl \
        --out-dir video/out/s1-zoeken-en-vinden/nl

Nothing is sent to any external service. The model weights are downloaded once from Hugging Face
(first run only) and cached; the reference recording never leaves this machine.
It never falls back to another voice or another model version: any problem is a hard error.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REFERENCE = HERE / "voices" / "lisa_reference.wav"
LANGUAGE_ID = "nl"
MAX_CHUNK_CHARS = 220          # Chatterbox stops at 1000 speech tokens (~40 s); stay far below it
PAUSE_SECONDS = 0.18           # silence between chunks of one scene
# Spoken form of words the model reads badly. Applied only to what is sent to the model;
# the exact original text is stored next to the audio (<name>.txt).
PRONUNCIATION = {"Key24": "Key vierentwintig", "KEY24": "Key vierentwintig", "CRM": "C R M",
                 "QR-code": "Q R code", "QR": "Q R", "Bak- en locatie-etiket": "Bak en locatie etiket"}


class VoiceError(RuntimeError):
    pass


def split_text(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split on sentence ends, then on , ; : if a sentence is still too long. Nothing is dropped."""
    text = re.sub(r"\s+", " ", text.replace(" ", " ")).strip()
    if not text:
        raise VoiceError("The script is empty.")
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    chunks: list[str] = []
    for sentence in sentences:
        parts = [sentence]
        if len(sentence) > limit:
            parts = [p.strip() for p in re.split(r"(?<=[,;:])\s+", sentence) if p.strip()]
        for part in parts:
            while len(part) > limit:            # last resort: break at a space, never mid-word
                cut = part.rfind(" ", 0, limit)
                cut = cut if cut > 0 else limit
                chunks.append(part[:cut].strip())
                part = part[cut:].strip()
            if part:
                chunks.append(part)
    # glue short neighbours back together so the prosody is not choppy
    merged: list[str] = []
    for chunk in chunks:
        if merged and len(merged[-1]) + 1 + len(chunk) <= limit and not merged[-1].endswith(("?", "!")):
            merged[-1] = f"{merged[-1]} {chunk}"
        else:
            merged.append(chunk)
    if "".join(merged).replace(" ", "") != text.replace(" ", ""):
        raise VoiceError("Internal check failed: the split text does not match the original script.")
    return merged


def pick_device(requested: str) -> str:
    import torch
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise VoiceError("--device cuda was requested but CUDA is not available.")
    return requested


class Narrator:
    def __init__(self, reference: Path, device: str, t3_model: str, exaggeration: float, cfg_weight: float):
        if not reference.is_file():
            raise VoiceError(f"Reference recording not found: {reference}\n"
                             "Put Lisa's authorised recording there (see voice_engine/README.md). "
                             "No other voice is used instead.")
        import inspect
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        if "t3_model" not in inspect.signature(ChatterboxMultilingualTTS.from_pretrained).parameters:
            raise VoiceError("The installed chatterbox package has no t3_model option (v3 needs the GitHub version, "
                             "not PyPI 0.1.7). Reinstall from a git checkout, see README.")
        self.device = pick_device(device)
        self.reference = reference
        self.exaggeration, self.cfg_weight = exaggeration, cfg_weight
        self.torch = torch
        print(f"[voice] loading Chatterbox Multilingual t3_model={t3_model!r} on {self.device} ...", flush=True)
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=self.device, t3_model=t3_model)
        self.sample_rate = int(self.model.sr)

    def synthesize(self, text: str, seed: int | None):
        for written, spoken in PRONUNCIATION.items():
            text = text.replace(written, spoken)
        chunks = split_text(text)
        pieces = []
        silence = self.torch.zeros(1, int(PAUSE_SECONDS * self.sample_rate))
        for i, chunk in enumerate(chunks, 1):
            if seed is not None:
                self.torch.manual_seed(seed + i)
            print(f"[voice]   {i}/{len(chunks)}: {chunk[:70]}{'…' if len(chunk) > 70 else ''}", flush=True)
            wav = self.model.generate(chunk, language_id=LANGUAGE_ID, audio_prompt_path=str(self.reference),
                                      exaggeration=self.exaggeration, cfg_weight=self.cfg_weight)
            wav = wav.detach().cpu()
            if wav.dim() == 1:
                wav = wav.unsqueeze(0)
            if wav.shape[-1] < int(0.2 * self.sample_rate):
                raise VoiceError(f"Chunk {i} produced almost no audio: {chunk!r}")
            pieces.append(wav)
            if i < len(chunks):
                pieces.append(silence)
        return self.torch.cat(pieces, dim=-1), chunks


def write_wav(path: Path, wav, sample_rate: int) -> None:
    import numpy as np
    import soundfile as sf
    path.parent.mkdir(parents=True, exist_ok=True)
    data = wav.squeeze(0).numpy() if wav.dim() == 2 else wav.numpy()
    sf.write(str(path), np.clip(data, -1.0, 1.0), sample_rate, subtype="PCM_16")


def verify_wav(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size < 1000:
        raise VoiceError(f"WAV was not written: {path}")
    with wave.open(str(path), "rb") as handle:
        frames, rate = handle.getnframes(), handle.getframerate()
        if frames == 0:
            raise VoiceError(f"WAV is empty: {path}")
        return {"path": str(path), "seconds": round(frames / rate, 3), "sample_rate": rate, "channels": handle.getnchannels()}


def write_mp3(wav_path: Path, mp3_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise VoiceError("ffmpeg is needed for the MP3 copy that video/assemble.mjs reads.")
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(wav_path), "-af", "loudnorm=I=-18:TP=-2:LRA=9",
                    "-ar", "48000", "-b:a", "320k", str(mp3_path)], check=True)


def run_one(narrator: Narrator, text: str, out_wav: Path, seed: int | None, mp3: bool) -> dict:
    wav, chunks = narrator.synthesize(text, seed)
    write_wav(out_wav, wav, narrator.sample_rate)
    out_wav.with_suffix(".txt").write_text(text, encoding="utf-8")          # keep the exact script next to the audio
    info = verify_wav(out_wav)
    info["chunks"] = len(chunks)
    if mp3:
        write_mp3(out_wav, out_wav.with_suffix(".mp3"))
        info["mp3"] = str(out_wav.with_suffix(".mp3"))
    return info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", type=Path, help="UTF-8 text file with the approved Dutch script")
    src.add_argument("--script", type=Path, help="video/scripts/<slug>.json (every scene's narration)")
    ap.add_argument("--output", type=Path, help="output WAV (with --input)")
    ap.add_argument("--out-dir", type=Path, help="folder for vo-<scene>.wav/.mp3 (with --script)")
    ap.add_argument("--lang", default="nl", help="key of the narration text inside the script JSON (default nl)")
    ap.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    ap.add_argument("--exaggeration", type=float, default=0.5)
    ap.add_argument("--cfg-weight", type=float, default=0.5)
    ap.add_argument("--t3-model", default="v3")
    ap.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    ap.add_argument("--seed", type=int, default=None, help="fixed seed for repeatable takes")
    ap.add_argument("--force", action="store_true", help="regenerate scenes whose vo-<scene>.wav already exists")
    ap.add_argument("--scenes", help="comma separated scene ids (with --script); default: all scenes that have narration")
    ap.add_argument("--no-mp3", action="store_true", help="skip the MP3 copy")
    args = ap.parse_args()

    try:
        if args.input:
            if not args.output:
                raise VoiceError("--output is required with --input.")
            if not args.input.is_file():
                raise VoiceError(f"Input text not found: {args.input}")
            text = args.input.read_text(encoding="utf-8")
            jobs = [("script", text, args.output)]
        else:
            if not args.out_dir:
                raise VoiceError("--out-dir is required with --script.")
            if not args.script.is_file():
                raise VoiceError(f"Script not found: {args.script}")
            data = json.loads(args.script.read_text(encoding="utf-8"))
            wanted = set(args.scenes.split(",")) if args.scenes else None
            jobs = []
            for scene in data["scenes"]:
                text = scene.get(args.lang)
                if not text or scene.get("type") == "endcard":   # the end card is silent
                    continue
                if wanted and scene["id"] not in wanted:
                    continue
                target = args.out_dir / f"vo-{scene['id']}.wav"
                if target.exists() and not args.force:
                    print(f"[voice] keep existing {target.name} (use --force to regenerate)")
                    continue
                jobs.append((scene["id"], text, target))
            if not jobs:
                print("[voice] nothing to generate")
                return 0

        narrator = Narrator(args.reference, args.device, args.t3_model, args.exaggeration, args.cfg_weight)
        results = []
        for name, text, target in jobs:
            print(f"[voice] {name} -> {target}", flush=True)
            info = run_one(narrator, text, target, args.seed, mp3=bool(args.script) and not args.no_mp3)
            info["scene"] = name
            results.append(info)
            print(f"[voice] ok {name}: {info['seconds']} s", flush=True)
        print("RESULT " + json.dumps(results, ensure_ascii=False))
        return 0
    except VoiceError as error:
        print(f"[voice] ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
