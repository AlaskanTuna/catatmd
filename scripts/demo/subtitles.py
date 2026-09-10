#!/usr/bin/env python3
"""Build burned-in subtitles from the narration schedule and rendered WAV files."""

import json
import sys
import wave
from pathlib import Path

MAX_CHARS = 42
MAX_LINES = 2
MIN_CARD_MS = 900
NBSP = chr(0xA0)


def wav_duration_ms(path):
    with wave.open(str(path), 'rb') as audio:
        return round(audio.getnframes() * 1000 / audio.getframerate())


def balanced_lines(text):
    words = text.split()
    if not words:
        return []

    def pack(line_count):
        best = None

        def visit(word_index, lines_made, current, longest):
            nonlocal best
            if best is not None and longest >= best[0]:
                return
            if lines_made == line_count - 1:
                tail = ' '.join(words[word_index:])
                candidate = max(longest, len(tail))
                if candidate <= MAX_CHARS and (best is None or candidate < best[0]):
                    best = (candidate, [*current, tail])
                return
            for end in range(word_index + 1, len(words)):
                line = ' '.join(words[word_index:end])
                if len(line) > MAX_CHARS:
                    break
                visit(end, lines_made + 1, [*current, line], max(longest, len(line)))

        visit(0, 0, [], 0)
        return best

    for line_count in range(1, len(words) + 1):
        result = pack(line_count)
        if result:
            return result[1]
    return [' '.join(words)]


def cards(text):
    lines = balanced_lines(text)
    return ['\n'.join(lines[index : index + MAX_LINES]) for index in range(0, len(lines), MAX_LINES)]


def allocate_card_durations(total_ms, chunks):
    if not chunks:
        return []
    weights = [len(chunk) for chunk in chunks]
    minimum = MIN_CARD_MS if total_ms >= len(chunks) * MIN_CARD_MS else 0
    remaining = total_ms - minimum * len(chunks)
    weight_total = sum(weights) or 1
    durations = [minimum + (remaining * weight) // weight_total for weight in weights]
    for index in range(total_ms - sum(durations)):
        durations[index % len(durations)] += 1
    return durations


def timestamp(ms):
    safe_ms = max(0, int(ms))
    hours, remainder = divmod(safe_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}'


def build(demo_dir):
    lines = json.loads((demo_dir / 'lines.json').read_text(encoding='utf-8'))
    if not isinstance(lines, list) or not lines:
        raise ValueError('lines.json must contain at least one narration line')

    spans = []
    for index, line in enumerate(lines):
        if not isinstance(line, dict) or not isinstance(line.get('ms'), int) or not isinstance(line.get('text'), str):
            raise ValueError(f'narration line {index} is invalid')
        segment = demo_dir / 'narration-segments' / f'{index}.wav'
        if not segment.is_file():
            raise ValueError(f'missing narration segment {segment.name}')
        chunks = cards(line['text'])
        durations = allocate_card_durations(wav_duration_ms(segment), chunks)
        cursor = line['ms']
        for chunk, duration_ms in zip(chunks, durations, strict=True):
            spans.append([cursor, cursor + duration_ms, chunk])
            cursor += duration_ms

    spans.sort(key=lambda span: span[0])
    for current, following in zip(spans, spans[1:]):
        if current[1] > following[0]:
            current[1] = following[0]
    spans = [span for span in spans if span[1] - span[0] >= 200]

    bottom_blocks = []
    top_blocks = []
    for start, end, text in spans:
        caption_lines = text.split('\n')
        timing = f'{timestamp(start)} --> {timestamp(end)}'
        bottom_blocks.append(f'{len(bottom_blocks) + 1}\n{timing}\n{NBSP}{caption_lines[-1]}{NBSP}')
        if len(caption_lines) == MAX_LINES:
            top_blocks.append(f'{len(top_blocks) + 1}\n{timing}\n{NBSP}{caption_lines[0]}{NBSP}')

    output = demo_dir / 'narration.srt'
    bottom_content = '\n\n'.join(bottom_blocks)
    output.write_text(f'{bottom_content}\n', encoding='utf-8')
    top_output = demo_dir / 'narration-top.srt'
    top_content = '\n\n'.join(top_blocks)
    top_output.write_text(f'{top_content}\n' if top_content else '', encoding='utf-8')
    print(f'built {len(bottom_blocks)} subtitle cards from {len(lines)} narration lines')
    return output


def main(argv):
    if len(argv) != 2:
        print('usage: subtitles.py <demo-dir>', file=sys.stderr)
        return 2
    try:
        build(Path(argv[1]))
    except (FileNotFoundError, json.JSONDecodeError, ValueError, wave.Error) as error:
        print(f'subtitles failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
