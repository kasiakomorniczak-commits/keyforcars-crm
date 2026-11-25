# voice_engine: local Dutch narration in Lisa's voice (Chatterbox Multilingual, T3 v3)

A free, local voice backend for the Key24 training videos. No paid API, no subscription, no external voice
service. Lisa's reference recording never leaves the machine. The only download is the model itself from
Hugging Face (first run, cached afterwards).

It plugs into the existing pipeline: `video/media.mjs` calls it when `VOICE_BACKEND=chatterbox`; the
existing `video/assemble.mjs`, recording, subtitles, animation and rendering are unchanged. HeyGen stays the
default backend. The backend is always chosen explicitly, it never switches voice on its own.

## Requirements

| | Minimum | Recommended |
|---|---|---|
| Python | 3.11 (3.10 to 3.13 work) | 3.11 in its own venv |
| GPU | none (CPU works, but is several times slower than real time) | NVIDIA, 8 GB VRAM or more, CUDA 12.x |
| RAM | 8 GB | 16 GB |
| Disk | about 10 GB (torch + model weights) | |
| ffmpeg | on PATH (MP3 copy for the assembler) | |

`chatterbox-tts` 0.1.7 on PyPI has **no** `t3_model` option. T3 v3 only exists in the GitHub version, so install
from a checkout of https://github.com/resemble-ai/chatterbox.

## Install (dedicated venv, existing environments are not touched)

```bash
git clone --depth 1 https://github.com/resemble-ai/chatterbox ../chatterbox
python3.11 -m venv voice_engine/.venv
voice_engine/.venv/bin/pip install ../chatterbox          # Windows: voice_engine\.venv\Scripts\pip install ..\chatterbox
```

On Windows with an NVIDIA GPU install a CUDA build of torch first if the default wheel is CPU only (check
https://pytorch.org/get-started/previous-versions/ for torch 2.6.0), then install chatterbox.

## Lisa's reference recording

Put the authorised recording at `voice_engine/voices/lisa_reference.wav` (mono WAV, 10 to 30 s of clean speech,
no music, no noise). Replace the file to change the voice. It is git-ignored, as are the venv, the model cache
and all generated audio. Only use a voice you have the speaker's permission to clone.

## Generate

One script as text (UTF-8):

```bash
voice_engine/.venv/bin/python voice_engine/generate_voice.py \
    --input scripts/les_01.txt --output voice_engine/output/les_01.wav
```

All scenes of a video script (this is what the pipeline uses; the model is loaded once):

```bash
VOICE_BACKEND=chatterbox node video/media.mjs s1-zoeken-en-vinden nl
# or directly
voice_engine/.venv/bin/python voice_engine/generate_voice.py \
    --script video/scripts/s1-zoeken-en-vinden.json --lang nl --out-dir video/out/s1-zoeken-en-vinden/nl
node video/assemble.mjs s1-zoeken-en-vinden nl
```

For every scene it writes `vo-<scene>.wav` (native sample rate, 16 bit), a `vo-<scene>.txt` with the exact script
text, and `vo-<scene>.mp3` (loudness normalised, 320 kbit/s) because `assemble.mjs` reads that name and measures
its duration with ffprobe. The last line printed is `RESULT [...]` with the path, duration, sample rate and
number of chunks of each file. Existing files are kept unless `--force` is given. No extra takes are made.

Options: `--exaggeration 0.5`, `--cfg-weight 0.5` (defaults), `--seed N` for repeatable takes, `--device auto|cuda|cpu`,
`--scenes id1,id2`, `--t3-model v3`.

Long scenes are split on sentence ends (at most about 220 characters per piece, because Chatterbox stops after
about 40 s of speech) and joined with a short pause. The split is checked against the original text, nothing is
dropped silently.

## From Claude Code

1. Save the approved Dutch script as UTF-8 text, or use the `nl` fields of `video/scripts/<slug>.json`.
2. Run the command above. 3. Read the `RESULT` line: path and duration. 4. Continue with `assemble.mjs`.

The intro and outro clips with Lisa's lip-sync still come from HeyGen (`media.mjs`), which needs its own
allowance. Chatterbox produces audio only.

## Troubleshooting

* `Reference recording not found`: put the WAV at `voice_engine/voices/lisa_reference.wav`.
* `no t3_model option`: you installed the PyPI release; install from the GitHub checkout.
* `--device cuda ... not available`: install a CUDA build of torch, or use `--device cpu`.
* Model download fails: `huggingface.co` must be reachable once; then the cache is used.
* Repeated or missing words: shorten the sentence, lower `--exaggeration` (0.3 to 0.4), try another `--seed`.
* Output is Dutch only (`language_id="nl"`); `media.mjs` refuses other languages with this backend.
* Chatterbox adds an inaudible Perth watermark to its audio; that is part of the model.
