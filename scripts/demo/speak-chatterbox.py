#!/usr/bin/env python3
"""Render one narration line with Chatterbox voice cloning, with a content-addressed cache."""

import hashlib
import json
import os
import shutil
import sys
import wave
from pathlib import Path


def parse_speed():
    try:
        speed = float(os.environ.get('DEMO_SPEED', '1.0'))
    except ValueError:
        print('DEMO_SPEED must be a number', file=sys.stderr)
        return None
    if speed <= 0:
        print('DEMO_SPEED must be positive', file=sys.stderr)
        return None
    return speed


def voice_path():
    voice = os.environ.get('CHATTERBOX_VOICE')
    if not voice:
        print('missing CHATTERBOX_VOICE', file=sys.stderr)
        return None
    path = Path(voice)
    if not path.is_file():
        print(f'missing reference voice: {path}', file=sys.stderr)
        return None
    return path


def device():
    return os.environ.get('CHATTERBOX_DEVICE', 'cpu')


def cache_root():
    if 'CHATTERBOX_CACHE' in os.environ:
        return Path(os.environ['CHATTERBOX_CACHE'])
    demo_dir = os.environ.get('DEMO_DIR')
    if demo_dir:
        return Path(demo_dir) / 'chatterbox-cache'
    return Path('.chatterbox-cache')


def cache_key(reference, speed, text):
    data = str(reference).encode() + b'\0' + str(speed).encode() + b'\0' + text.encode()
    return hashlib.sha256(data).hexdigest()


def cached_wav(cache, key):
    return cache / f'{key}.wav'


def ensure_1d(wav):
    import torch

    while wav.dim() > 1 and wav.shape[0] == 1:
        wav = wav.squeeze(0)
    if wav.dim() > 1:
        wav = wav[0]
    return wav


def write_wav(path, wav, sample_rate):
    import torch

    wav = ensure_1d(wav).cpu()
    samples = (wav * 32767).clamp(-32768, 32767).to(torch.int16).numpy()
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(samples.tobytes())


def apply_speed(wav, speed, sample_rate):
    import torch

    if speed == 1.0:
        return wav
    try:
        import torchaudio.functional as F

        return F.resample(wav, orig_freq=sample_rate, new_freq=int(sample_rate / speed))
    except ModuleNotFoundError:
        pass
    target_len = int(len(wav) / speed)
    if target_len == 0:
        return wav[:0]
    resized = torch.nn.functional.interpolate(
        wav.view(1, 1, -1),
        size=target_len,
        mode='linear',
        align_corners=False,
    )
    return resized.view(-1)


def generate(path, text, reference, speed, device_name):
    from chatterbox.tts import ChatterboxTTS

    try:
        model = ChatterboxTTS.from_pretrained(device=device_name)
    except Exception as error:
        print(f'failed to load Chatterbox: {error}', file=sys.stderr)
        return False
    try:
        wav = model.generate(text, audio_prompt_path=str(reference))
    except Exception as error:
        print(f'Chatterbox generation failed: {error}', file=sys.stderr)
        return False
    sample_rate = int(model.sr)
    wav = apply_speed(wav, speed, sample_rate)
    write_wav(path, wav, sample_rate)
    return True


def render_single(out_path, text):
    speed = parse_speed()
    if speed is None:
        return 2
    reference = voice_path()
    if reference is None:
        return 1

    cache = cache_root()
    cache.mkdir(parents=True, exist_ok=True)
    key = cache_key(reference, speed, text)
    cached = cached_wav(cache, key)
    if cached.is_file():
        shutil.copyfile(cached, out_path)
        return 0

    # Cache miss: heavy torch/chatterbox imports only happen here, never on the fast path.
    try:
        if not generate(cached, text, reference, speed, device()):
            return 1
    except ModuleNotFoundError as error:
        print(f'missing Chatterbox Python dependency: {error.name}', file=sys.stderr)
        return 1

    shutil.copyfile(cached, out_path)
    return 0


def render_batch(lines_path):
    lines_file = Path(lines_path)
    if not lines_file.is_file():
        print(f'missing lines file: {lines_file}', file=sys.stderr)
        return 1
    try:
        lines = json.loads(lines_file.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as error:
        print(f'failed to read lines: {error}', file=sys.stderr)
        return 1
    if not isinstance(lines, list):
        print('lines.json must contain an array', file=sys.stderr)
        return 2

    speed = parse_speed()
    if speed is None:
        return 2
    reference = voice_path()
    if reference is None:
        return 1

    cache = cache_root()
    cache.mkdir(parents=True, exist_ok=True)

    missing = []
    for line in lines:
        if not isinstance(line, dict) or not isinstance(line.get('text'), str):
            print('each line must be an object with a string text key', file=sys.stderr)
            return 2
        text = line['text'].strip()
        if not text:
            continue
        key = cache_key(reference, speed, text)
        cached = cached_wav(cache, key)
        if not cached.is_file():
            missing.append((text, cached))

    if not missing:
        return 0

    from chatterbox.tts import ChatterboxTTS

    try:
        model = ChatterboxTTS.from_pretrained(device=device())
    except ModuleNotFoundError as error:
        print(f'missing Chatterbox Python dependency: {error.name}', file=sys.stderr)
        return 1
    except Exception as error:
        print(f'failed to load Chatterbox: {error}', file=sys.stderr)
        return 1

    for text, cached in missing:
        try:
            wav = model.generate(text, audio_prompt_path=str(reference))
            sample_rate = int(model.sr)
            wav = apply_speed(wav, speed, sample_rate)
            write_wav(cached, wav, sample_rate)
            print(f'rendered: {text[:50]}', file=sys.stderr)
        except Exception as error:
            print(f'Chatterbox generation failed for {text[:50]}: {error}', file=sys.stderr)
            return 1
    return 0


def main(argv):
    if len(argv) >= 2 and argv[1] == '--batch':
        if len(argv) != 3:
            print('usage: speak-chatterbox.py --batch <lines.json>', file=sys.stderr)
            return 2
        return render_batch(argv[2])

    if len(argv) != 2:
        print('usage: speak-chatterbox.py <out.wav> (text on stdin)', file=sys.stderr)
        return 2

    text = sys.stdin.read().strip()
    if not text:
        print('no narration text on stdin', file=sys.stderr)
        return 2

    return render_single(Path(argv[1]), text)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
