#!/usr/bin/env python3
"""Render one neutral English narration line with local Kokoro TTS."""

import os
import sys
from pathlib import Path


def kokoro_home():
    data_home = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local' / 'share'))
    return Path(os.environ.get('KOKORO_HOME', data_home / 'catatmd-demo' / 'kokoro'))


def main(argv):
    if len(argv) != 2:
        print('usage: speak.py <out.wav> (text on stdin)', file=sys.stderr)
        return 2
    text = sys.stdin.read().strip()
    if not text:
        print('no narration text on stdin', file=sys.stderr)
        return 2

    home = kokoro_home()
    model = home / 'kokoro-v1.0.onnx'
    voices = home / 'voices-v1.0.bin'
    if not model.is_file():
        print(f'missing Kokoro model: {model}', file=sys.stderr)
        return 1
    if not voices.is_file():
        print(f'missing Kokoro voices: {voices}', file=sys.stderr)
        return 1

    try:
        speed = float(os.environ.get('DEMO_SPEED', '1.0'))
    except ValueError:
        print('DEMO_SPEED must be a number', file=sys.stderr)
        return 2
    if speed <= 0:
        print('DEMO_SPEED must be positive', file=sys.stderr)
        return 2

    try:
        import soundfile
        from kokoro_onnx import Kokoro
    except ModuleNotFoundError as error:
        print(f'missing Kokoro Python dependency: {error.name}', file=sys.stderr)
        return 1

    voice = os.environ.get('DEMO_VOICE', 'af_heart')
    language = os.environ.get('DEMO_LANGUAGE', 'en-us')
    audio, sample_rate = Kokoro(str(model), str(voices)).create(
        text,
        voice=voice,
        speed=speed,
        lang=language,
    )
    soundfile.write(argv[1], audio, sample_rate, subtype='PCM_16')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
