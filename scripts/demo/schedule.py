#!/usr/bin/env python3
"""Build one narration timeline from browser beats and appended slide beats."""

import json
import sys
import wave
from pathlib import Path

GAP_MS = 260
MIN_SLIDE_MS = 5_000
SHOT_COUNT = 10
SHOT_NAMES = [f'shot-{index}' for index in range(1, SHOT_COUNT + 1)]
LAST_SHOT = SHOT_NAMES[-1]
SLIDE_WEIGHTS = [10, 14, 13, 11, 18, 10, 14, 17, 18, 17, 10]


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.write_text(f'{json.dumps(value, indent=2, ensure_ascii=False)}\n', encoding='utf-8')


def validate_beats(value):
    if not isinstance(value, list):
        raise ValueError('beats.json must contain an array')

    beats = []
    names = set()
    for index, beat in enumerate(value):
        if not isinstance(beat, dict) or not isinstance(beat.get('name'), str):
            raise ValueError(f'beat {index} must contain a string name')
        ms = beat.get('ms')
        if isinstance(ms, bool) or not isinstance(ms, int) or ms < 0:
            raise ValueError(f'beat {beat["name"]} must contain a non-negative integer ms')
        if beat['name'] in names:
            raise ValueError(f'duplicate beat {beat["name"]}')
        names.add(beat['name'])
        beats.append({'name': beat['name'], 'ms': ms})

    for previous, current in zip(beats, beats[1:]):
        if current['ms'] <= previous['ms']:
            raise ValueError('beats must be strictly increasing')
    for name in [*SHOT_NAMES, 'end']:
        if name not in names:
            raise ValueError(f'missing required beat {name}')

    positions = [next(index for index, beat in enumerate(beats) if beat['name'] == name) for name in SHOT_NAMES]
    if positions != sorted(positions):
        raise ValueError('shot beats must appear in recorder order')
    return beats


def allocate_durations(total_ms, page_count):
    if total_ms < page_count * MIN_SLIDE_MS:
        raise ValueError('target must leave at least 5 seconds per slide')
    weights = SLIDE_WEIGHTS if page_count == len(SLIDE_WEIGHTS) else [1] * page_count
    weight_total = sum(weights)
    durations = [(total_ms * weight) // weight_total for weight in weights]
    for index in range(total_ms - sum(durations)):
        durations[index] += 1
    return durations


def plan_slides(demo_dir, capture_ms, page_count, target_ms):
    beats = validate_beats(read_json(demo_dir / 'beats.json'))
    shots = {beat['name']: beat for beat in beats if beat['name'] in SHOT_NAMES}
    if capture_ms <= shots[LAST_SHOT]['ms']:
        raise ValueError(f'capture duration must end after {LAST_SHOT}')
    if page_count < 1:
        raise ValueError('deck must contain at least one slide')
    if target_ms <= capture_ms:
        raise ValueError('target duration must exceed capture duration')

    durations = allocate_durations(target_ms - capture_ms, page_count)
    slides = []
    cursor = capture_ms
    for index, duration_ms in enumerate(durations, 1):
        slides.append({'name': f'slide-{index}', 'ms': cursor, 'duration_ms': duration_ms})
        cursor += duration_ms
    write_json(demo_dir / 'slides.json', slides)
    return slides


def apply_slides(demo_dir):
    beats = validate_beats(read_json(demo_dir / 'beats.json'))
    slides = read_json(demo_dir / 'slides.json')
    if not isinstance(slides, list) or not slides:
        raise ValueError('slides.json must contain at least one slide')

    expected_start = None
    clean_slides = []
    for index, slide in enumerate(slides, 1):
        expected_name = f'slide-{index}'
        if not isinstance(slide, dict) or slide.get('name') != expected_name:
            raise ValueError(f'slide {index} must be named {expected_name}')
        ms = slide.get('ms')
        duration_ms = slide.get('duration_ms')
        if not isinstance(ms, int) or not isinstance(duration_ms, int) or duration_ms <= 0:
            raise ValueError(f'{expected_name} must contain integer ms and positive duration_ms')
        if expected_start is not None and ms != expected_start:
            raise ValueError('slide starts must be contiguous')
        clean_slides.append({'name': expected_name, 'ms': ms})
        expected_start = ms + duration_ms

    shots = {beat['name']: beat for beat in beats if beat['name'] in SHOT_NAMES}
    if clean_slides[0]['ms'] <= shots[LAST_SHOT]['ms']:
        raise ValueError(f'slide-1 must start after {LAST_SHOT}')
    # Every measured browser beat survives, not just the ten named shots: the recorder also emits framing beats around
    # them, and narration keyed to those would resolve against a beat this had thrown away.
    output = [beat for beat in beats if not beat['name'].startswith('slide-') and beat['name'] != 'end']
    output.extend(clean_slides)
    output.append({'name': 'end', 'ms': expected_start})
    write_json(demo_dir / 'beats.json', output)
    return output


def resolve_narration(demo_dir, script_path):
    beats = validate_beats(read_json(demo_dir / 'beats.json'))
    offsets = {beat['name']: beat['ms'] for beat in beats}
    end_ms = offsets['end']
    lines = []
    for line_number, raw in enumerate(script_path.read_text(encoding='utf-8').splitlines(), 1):
        source = raw.strip()
        if not source or source.startswith('#'):
            continue
        parts = [part.strip() for part in source.split('|', 2)]
        if len(parts) != 3:
            raise ValueError(f'narration line {line_number} must be beat | offset_ms | text')
        name, raw_offset, text = parts
        if name not in offsets:
            raise ValueError(f'unknown beat {name!r} on narration line {line_number}')
        try:
            offset_ms = int(raw_offset)
        except ValueError as error:
            raise ValueError(f'narration line {line_number} offset must be an integer') from error
        if offset_ms < 0:
            raise ValueError(f'narration line {line_number} offset must not be negative')
        if not text:
            raise ValueError(f'narration line {line_number} has no text')
        ms = offsets[name] + offset_ms
        if ms >= end_ms:
            raise ValueError(f'narration line {line_number} starts at or after end')
        lines.append({'beat': name, 'offset_ms': offset_ms, 'ms': ms, 'text': text})
    if not lines:
        raise ValueError('no narration lines resolved')
    lines.sort(key=lambda line: line['ms'])
    write_json(demo_dir / 'lines.json', lines)
    return lines


def wav_duration_ms(path):
    with wave.open(str(path), 'rb') as audio:
        if audio.getframerate() <= 0:
            raise ValueError(f'{path.name} has no sample rate')
        return round(audio.getnframes() * 1000 / audio.getframerate())


def deconflict(demo_dir, gap_ms=GAP_MS):
    lines = read_json(demo_dir / 'lines.json')
    if not isinstance(lines, list) or not lines:
        raise ValueError('lines.json must contain at least one narration line')
    previous_end = None
    shifted = 0
    for index, line in enumerate(lines):
        if not isinstance(line, dict) or not isinstance(line.get('ms'), int):
            raise ValueError(f'narration line {index} must contain integer ms')
        segment = demo_dir / 'narration-segments' / f'{index}.wav'
        if not segment.is_file():
            raise ValueError(f'missing narration segment {segment.name}')
        duration_ms = wav_duration_ms(segment)
        if duration_ms <= 0:
            raise ValueError(f'narration segment {segment.name} is empty')
        wanted_ms = line['ms']
        if previous_end is not None and wanted_ms < previous_end + gap_ms:
            line['ms'] = previous_end + gap_ms
            shifted += 1
        line['dur_ms'] = duration_ms
        previous_end = line['ms'] + duration_ms
    write_json(demo_dir / 'lines.json', lines)
    return lines, shifted


def parse_positive_int(value, label):
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f'{label} must be an integer') from error
    if parsed <= 0:
        raise ValueError(f'{label} must be positive')
    return parsed


def main(argv):
    if len(argv) < 3:
        print(
            'usage: schedule.py <plan-slides|apply-slides|resolve|deconflict> <demo-dir> [arguments]',
            file=sys.stderr,
        )
        return 2

    command = argv[1]
    demo_dir = Path(argv[2])
    try:
        if command == 'plan-slides':
            if len(argv) != 6:
                raise ValueError('plan-slides needs capture_ms, page_count and target_ms')
            slides = plan_slides(
                demo_dir,
                parse_positive_int(argv[3], 'capture_ms'),
                parse_positive_int(argv[4], 'page_count'),
                parse_positive_int(argv[5], 'target_ms'),
            )
            print(f'planned {len(slides)} slide beats from {slides[0]["ms"]}ms')
        elif command == 'apply-slides':
            if len(argv) != 3:
                raise ValueError('apply-slides takes only the demo directory')
            beats = apply_slides(demo_dir)
            print(f'extended beats.json to {beats[-1]["ms"]}ms')
        elif command == 'resolve':
            if len(argv) != 4:
                raise ValueError('resolve needs the narration script path')
            lines = resolve_narration(demo_dir, Path(argv[3]))
            print(f'resolved {len(lines)} narration lines against measured beats')
        elif command == 'deconflict':
            if len(argv) != 3:
                raise ValueError('deconflict takes only the demo directory')
            lines, shifted = deconflict(demo_dir)
            print(f'scheduled {len(lines)} narration lines; moved {shifted} to prevent overlap')
        else:
            raise ValueError(f'unknown command {command}')
    except (FileNotFoundError, json.JSONDecodeError, ValueError, wave.Error) as error:
        print(f'schedule failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
