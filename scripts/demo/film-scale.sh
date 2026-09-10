#!/usr/bin/env bash
set -euo pipefail

# Renders a screenshot the way the film does, so a design check is made against what the audience sees rather than
# against a 1440-wide editor pane. A 1440x900 capture becomes 1728x1080 inside a 1920x1080 frame, so everything is
# 1.2x larger than it looks in a browser -- and then h264 at CRF 20 takes some of the fine detail back.
#
# The two filter strings below are copied from narrate.sh and have to stay identical to it. If the film's fit or its
# encode settings change there, change them here in the same breath or this stops answering the question it is for.

ffmpeg="${DEMO_FFMPEG:-$(command -v ffmpeg || true)}"
[ -x "$ffmpeg" ] || command -v "$ffmpeg" >/dev/null 2>&1 || { echo "missing command: ffmpeg" >&2; exit 1; }

fit='scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#F5F7F5'
preset="${DEMO_PRESET:-veryfast}"

[ $# -gt 0 ] || { echo "usage: film-scale.sh <screenshot.png> [more.png ...]" >&2; exit 2; }

for source in "$@"; do
  [ -f "$source" ] || { echo "missing: $source" >&2; exit 1; }
  base="${source%.*}"
  "$ffmpeg" -nostdin -y -v error -i "$source" -vf "$fit" "$base-film.png"
  # Through the real encoder and back out, because the question is usually whether small type survives compression,
  # and scaling alone flatters it. One second at 25fps is enough for the encoder to settle on a quality.
  "$ffmpeg" -nostdin -y -v error -loop 1 -t 1 -i "$source" \
    -vf "$fit,fps=25,format=yuv420p" -c:v libx264 -preset "$preset" -crf 20 -f mp4 "$base-film.mp4"
  "$ffmpeg" -nostdin -y -v error -sseof -0.1 -i "$base-film.mp4" -frames:v 1 "$base-film-encoded.png"
  rm -f "$base-film.mp4"
  printf '%s\n  %s\n  %s\n' "$source" "$base-film.png" "$base-film-encoded.png"
done
