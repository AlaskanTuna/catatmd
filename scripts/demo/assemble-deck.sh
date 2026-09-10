#!/usr/bin/env bash
# Builds the deck half of the film on its own, for when the product walkthrough was recorded
# elsewhere and only the slides need making. assemble.sh is still the path when one run produces
# both halves; this one takes no capture and starts the timeline at the first slide.
#
# Inputs are operator-supplied stills and matching pre-rendered narration WAVs.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
demo_dir="${DEMO_DIR:?Set DEMO_DIR to a new deck-only output directory}"
[ ! -e "$demo_dir" ] || { echo 'deck output directory must not already exist' >&2; exit 1; }
shots="${DECK_SHOTS:?Set DECK_SHOTS to the slide PNG directory}"
segments="${DECK_SEGMENTS:?Set DECK_SEGMENTS to pre-rendered numbered WAVs}"
script="${DEMO_SCRIPT:?Set DEMO_SCRIPT to slide narration}"
deck_script="${DECK_SCRIPT:-$demo_dir/deck-narration.txt}"
ffmpeg="${DEMO_FFMPEG:-$(command -v ffmpeg || true)}"
ffprobe="${DEMO_FFPROBE:-$(command -v ffprobe || true)}"
target_ms="${DECK_TARGET_MS:-160000}"
min_tail_ms="${DECK_MIN_TAIL_MS:-1200}"
xfade="${DECK_XFADE:-0.45}"
fps="${DEMO_FPS:-25}"
preset="${DEMO_PRESET:-veryfast}"

for command_path in "$ffmpeg" "$ffprobe"; do
  [ -x "$command_path" ] || { echo "missing required media command" >&2; exit 1; }
done
[ -f "$script" ] || { echo "missing: $script" >&2; exit 1; }
[ -d "$shots" ] || { echo "missing slide stills: $shots (run shoot-deck.mjs first)" >&2; exit 1; }
mkdir -p "$demo_dir" "$segments"

# The shot lines belong to the recorded walkthrough, which already carries its own voice. Speaking
# them again over the slides would double the audio, so only the slide lines survive the filter.
grep -E '^slide-' "$script" > "$deck_script"
[ -s "$deck_script" ] || { echo "no slide narration lines in $script" >&2; exit 1; }

count="$(find "$shots" -name 'slide-*.png' | wc -l | tr -d ' ')"
[ "$count" -gt 0 ] || { echo "no slide stills in $shots" >&2; exit 1; }

# Slide length is derived from the narration each slide carries, never from a fixed weight table:
# a slide has to outlast its own sentences or the voice runs past the cut. Whatever is left over
# against the target is shared out evenly, which is what turns a tight read into a paced one.
python3 - "$deck_script" "$segments" "$demo_dir" "$target_ms" "$min_tail_ms" "$count" "$xfade" <<'PY'
import json
import sys
import wave
from pathlib import Path

script, segment_dir, demo_dir, target_ms, min_tail, pages, xfade = sys.argv[1:]
target_ms, min_tail, pages = int(target_ms), int(min_tail), int(pages)
xfade_ms = round(float(xfade) * 1000)
demo_dir, segment_dir = Path(demo_dir), Path(segment_dir)


def duration_ms(index):
    with wave.open(str(segment_dir / f'{index}.wav'), 'rb') as audio:
        return round(audio.getnframes() * 1000 / audio.getframerate())


lines = [line for line in Path(script).read_text(encoding='utf-8').splitlines() if line.strip()]
need = {page: 0 for page in range(1, pages + 1)}
for index, raw in enumerate(lines):
    name, offset, _ = (part.strip() for part in raw.split('|', 2))
    page = int(name.removeprefix('slide-'))
    if page > pages:
        raise SystemExit(f'{name} has no still in a {pages} slide deck')
    need[page] = max(need[page], int(offset) + duration_ms(index))

base = sum(need.values())
slack = target_ms - base
tail = max(min_tail, slack // pages) if slack > 0 else min_tail
plan = [{'name': f'slide-{page}', 'duration_ms': need[page] + tail} for page in range(1, pages + 1)]
(demo_dir / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')

# A crossfade overlaps each pair, so a slide stands alone earlier than a plain cumulative sum says.
# Each slide beat is the first frame where it is the only thing on screen, which is what the
# narration should be keyed to.
durations = [slide['duration_ms'] for slide in plan]
starts = [0 if i == 0 else sum(durations[:i]) - (i - 1) * xfade_ms for i in range(len(durations))]

beats = [{'name': slide['name'], 'ms': start} for slide, start in zip(plan, starts)]
total = sum(durations) - (len(durations) - 1) * xfade_ms
beats.append({'name': 'end', 'ms': total})
(demo_dir / 'deck-beats.json').write_text(json.dumps(beats, indent=2) + '\n', encoding='utf-8')

print(f'narration needs {base / 1000:.1f}s, tail {tail}ms per slide, deck {total / 1000:.1f}s')
PY

durations="$(python3 -c "
import json
print(' '.join(str(s['duration_ms'] / 1000) for s in json.load(open('$demo_dir/plan.json'))))
")"
read -r -a slide_seconds <<< "$durations"

inputs=(); filters=''; previous='0:v'; offset=0
for ((index = 0; index < count; index += 1)); do
  inputs+=(-loop 1 -t "${slide_seconds[$index]}" -i "$shots/slide-$((index + 1)).png")
done
for ((index = 1; index < count; index += 1)); do
  offset="$(python3 -c "print(round($offset + ${slide_seconds[$((index - 1))]} - $xfade, 3))")"
  filters+="[$previous][$index:v]xfade=transition=fade:duration=$xfade:offset=$offset[x$index];"
  previous="x$index"
done
filters+="[$previous]scale=1920:1080,fps=$fps,format=yuv420p[deck]"

"$ffmpeg" -y -loglevel error "${inputs[@]}" -filter_complex "$filters" -map '[deck]' \
  -c:v libx264 -preset "$preset" -crf 20 "$demo_dir/deck-silent.mp4"

actual="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$demo_dir/deck-silent.mp4")"
printf 'deck-silent.mp4: %.1fs at 1920x1080\n' "$actual"
printf 'catatmd-deck-v1\n' > "$demo_dir/deck-ok"
printf 'output: %s\n' "$demo_dir/deck-silent.mp4"
