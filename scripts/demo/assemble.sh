#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
demo_dir="${DEMO_DIR:?Set DEMO_DIR to a successful take directory}"
[ -f "$demo_dir/take-ok" ] && [ "$(<"$demo_dir/take-ok")" = 'catatmd-demo-v1' ] || { echo 'successful take-ok marker required' >&2; exit 1; }
deck="${DEMO_DECK:-}"

[ -n "$deck" ] || { echo 'DEMO_DECK is required: the path to an operator-supplied slide deck PDF' >&2; exit 1; }
ffmpeg="${DEMO_FFMPEG:-$(command -v ffmpeg || true)}"
ffprobe="${DEMO_FFPROBE:-$(command -v ffprobe || true)}"
pdfinfo="${DEMO_PDFINFO:-$(command -v pdfinfo || true)}"
pdftoppm="${DEMO_PDFTOPPM:-$(command -v pdftoppm || true)}"
target_seconds="${DEMO_TOTAL_SECONDS:-285}"
fps="${DEMO_FPS:-25}"
preset="${DEMO_PRESET:-veryfast}"
capture="$demo_dir/capture.webm"
work_dir="$demo_dir/assembly"
joined="$demo_dir/capture-joined.mp4"

for command_path in "$ffmpeg" "$ffprobe" "$pdfinfo" "$pdftoppm"; do
  [ -x "$command_path" ] || { echo "missing required media command" >&2; exit 1; }
done
for input in "$capture" "$demo_dir/beats.json" "$deck"; do
  [ -f "$input" ] || { echo "missing: $input" >&2; exit 1; }
done

mkdir -p "$demo_dir" "$work_dir"

capture_ms="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$capture" \
  | python3 -c 'import sys; print(round(float(sys.stdin.read().strip()) * 1000))')"
page_count="$("$pdfinfo" "$deck" | awk '/^Pages:/ { print $2; exit }')"
target_ms="$(python3 - "$target_seconds" <<'PY'
import sys

print(round(float(sys.argv[1]) * 1000))
PY
)"

python3 "$script_dir/schedule.py" plan-slides "$demo_dir" "$capture_ms" "$page_count" "$target_ms"

video_filter="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#F5F7F5,fps=$fps,format=yuv420p"
"$ffmpeg" -y -loglevel error -i "$capture" -vf "$video_filter" -an -c:v libx264 -preset "$preset" -crf 20 \
  "$work_dir/segment-capture.mp4"

: > "$work_dir/concat.txt"
printf "file 'segment-capture.mp4'\n" >> "$work_dir/concat.txt"

while IFS='|' read -r name duration_seconds <&3; do
  page="${name#slide-}"
  frame="$work_dir/$name.png"
  segment="$work_dir/segment-$name.mp4"
  "$pdftoppm" -png -f "$page" -l "$page" -singlefile -scale-to-x 1920 -scale-to-y 1080 "$deck" \
    "$work_dir/$name"
  "$ffmpeg" -y -loglevel error -loop 1 -framerate "$fps" -i "$frame" -t "$duration_seconds" \
    -vf "fps=$fps,format=yuv420p" -an -c:v libx264 -preset "$preset" -crf 20 "$segment"
  printf "file 'segment-%s.mp4'\n" "$name" >> "$work_dir/concat.txt"
done 3< <(python3 - "$demo_dir/slides.json" <<'PY'
import json
import sys
from pathlib import Path

for slide in json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')):
    print(f'{slide["name"]}|{slide["duration_ms"] / 1000:.3f}')
PY
)

(
  cd "$work_dir"
  "$ffmpeg" -y -loglevel error -f concat -safe 0 -i concat.txt -c copy joined.mp4
)
mv -f "$work_dir/joined.mp4" "$joined"
python3 "$script_dir/schedule.py" apply-slides "$demo_dir"

actual_seconds="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$joined")"
python3 - "$actual_seconds" "$target_seconds" <<'PY'
import sys

actual, target = (float(value) for value in sys.argv[1:])
if abs(actual - target) > 0.25:
    raise SystemExit(f'joined duration {actual:.3f}s differs from target {target:.3f}s')
print(f'joined: {actual:.1f}s at 1920x1080')
PY
printf 'output: %s\n' "$joined"
