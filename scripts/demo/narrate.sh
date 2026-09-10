#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
demo_dir="${DEMO_DIR:?Set DEMO_DIR to a successful take directory}"
[ -f "$demo_dir/take-ok" ] && [ "$(<"$demo_dir/take-ok")" = 'catatmd-demo-v1' ] || { echo 'successful take-ok marker required' >&2; exit 1; }
kokoro_home="${KOKORO_HOME:-$data_home/catatmd-demo/kokoro}"
export KOKORO_HOME="$kokoro_home"
python="${DEMO_PYTHON:-$kokoro_home/.venv/bin/python}"
speak="${DEMO_SPEAK:-$script_dir/speak.py}"
script="${DEMO_SCRIPT:-$script_dir/narration.txt}"
source="${DEMO_SOURCE:-$demo_dir/capture.webm}"
output="${DEMO_OUT:-$demo_dir/CatatMD-Demo.mp4}"
ffmpeg="${DEMO_FFMPEG:-$(command -v ffmpeg || true)}"
ffprobe="${DEMO_FFPROBE:-$(command -v ffprobe || true)}"
fps="${DEMO_FPS:-25}"
preset="${DEMO_PRESET:-veryfast}"
segments="$demo_dir/narration-segments"
music="${DEMO_MUSIC:-}"
music_start="${DEMO_MUSIC_START:-0}"
music_duck="${DEMO_MUSIC_DUCK:-20}"
music_fade_in="${DEMO_MUSIC_FADE_IN:-4}"
music_fade_out="${DEMO_MUSIC_FADE_OUT:-7}"
music_credit="${DEMO_MUSIC_CREDIT:-}"
# A finished film can be run faster than it was shot. Picture and voice move together, so what is on screen still
# matches what is being said, and the burned subtitles ride the same setpts rather than needing a second pass over
# the SRT. The bed is deliberately not sped up: it is music rather than performance, and a lofi loop at 1.5x is a
# different piece of music. atempo covers 0.5 to 2.0 in one pass, which is the range this accepts.
#
# NOT DEMO_SPEED. That name was already taken by speak.py, where it is Kokoro's own speaking rate, and this script
# hands its whole environment to speak.py -- so a single DEMO_SPEED=1.5 made the voice synthesise 1.5x fast and then
# atempo it 1.5x again, about 2.3x on the speech against 1.5x on the picture. Measured: one line runs 3.33s at
# DEMO_SPEED=1 and 2.15s at 1.5, before this script touches it.
speed="${DEMO_FILM_SPEED:-1}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || [ -x "$1" ] || { echo "missing command: $1" >&2; exit 1; }
}

require_command "$python"
require_command "$ffmpeg"
require_command "$ffprobe"
for input in "$source" "$demo_dir/beats.json" "$script" "$speak"; do
  [ -f "$input" ] || { echo "missing: $input" >&2; exit 1; }
done
[ "$source" != "$output" ] || { echo "DEMO_OUT must differ from DEMO_SOURCE" >&2; exit 1; }
python3 - "$speed" <<'PY' || { echo "DEMO_FILM_SPEED must be between 0.5 and 2.0" >&2; exit 1; }
import sys

value = float(sys.argv[1])
raise SystemExit(0 if 0.5 <= value <= 2.0 else 1)
PY
if [ -n "$music" ]; then
  [ -f "$music" ] || { echo "missing music: $music" >&2; exit 1; }
  # Checked here rather than at the mux, because the failure it guards against is a film that ships with an uncredited
  # bed and no way to tell from the file itself, and finding that out after the speech has been synthesised wastes the
  # expensive half of the run.
  [ -n "$music_credit" ] || { echo "DEMO_MUSIC needs DEMO_MUSIC_CREDIT: the bed has to be credited in the file" >&2; exit 1; }
fi

mkdir -p "$demo_dir" "$segments" "$(dirname -- "$output")"
python3 "$script_dir/schedule.py" resolve "$demo_dir" "$script"
line_count="$(python3 - "$demo_dir/lines.json" <<'PY'
import json
import sys
from pathlib import Path

print(len(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))))
PY
)"

for ((index = 0; index < line_count; index += 1)); do
  python3 - "$demo_dir/lines.json" "$index" <<'PY' | "$python" "$speak" "$segments/$index.wav"
import json
import sys
from pathlib import Path

lines = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
print(lines[int(sys.argv[2])]['text'])
PY
done

python3 "$script_dir/schedule.py" deconflict "$demo_dir"
python3 "$script_dir/subtitles.py" "$demo_dir"

inputs=()
filters=''
labels=''
for ((index = 0; index < line_count; index += 1)); do
  start_ms="$(python3 - "$demo_dir/lines.json" "$index" <<'PY'
import json
import sys
from pathlib import Path

lines = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
print(lines[int(sys.argv[2])]['ms'])
PY
)"
  inputs+=(-i "$segments/$index.wav")
  filters+="[$index:a]adelay=$start_ms:all=1[n$index];"
  labels+="[n$index]"
done

"$ffmpeg" -y -loglevel error "${inputs[@]}" \
  -filter_complex "${filters}${labels}amix=inputs=$line_count:normalize=0:dropout_transition=0[narration]" \
  -map '[narration]' -ar 48000 -c:a pcm_s16le "$demo_dir/narration.wav"

video_seconds="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$source")"
audio_seconds="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$demo_dir/narration.wav")"
tail_seconds="$(python3 - "$video_seconds" "$audio_seconds" <<'PY'
import sys

video, audio = (float(value) for value in sys.argv[1:])
print(f'{max(0, audio - video + 0.4):.3f}')
PY
)"

fit="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#F5F7F5,fps=$fps,format=yuv420p"
if python3 - "$tail_seconds" <<'PY'
import sys

raise SystemExit(0 if float(sys.argv[1]) > 0 else 1)
PY
then
  fit="tpad=stop_mode=clone:stop_duration=$tail_seconds,$fit"
fi
# Optional font overrides require a libass-compatible static font in DEMO_FONTSDIR.
subtitle_font="${DEMO_SUBTITLE_FONT:-DejaVu Sans}"
subtitle_size="${DEMO_SUBTITLE_SIZE:-12}"
fontsdir="${DEMO_FONTSDIR:-}"
subtitle_style="FontName=$subtitle_font,FontSize=$subtitle_size,PrimaryColour=&H00FFFFFF"
subtitle_style+=",OutlineColour=&H0D000000,BorderStyle=3,Outline=2,Shadow=0,Alignment=2"
subtitle_fonts=''
if [ -n "$fontsdir" ]; then
  subtitle_fonts=":fontsdir='$(realpath "$fontsdir")'"
fi
subtitle_filter="subtitles=filename=narration.srt$subtitle_fonts:force_style='$subtitle_style,MarginV=19'"
if [ -s "$demo_dir/narration-top.srt" ]; then
  subtitle_filter+=",subtitles=filename=narration-top.srt$subtitle_fonts:force_style='$subtitle_style,MarginV=37'"
fi
source_path="$(realpath "$source")"
audio_path="$(realpath "$demo_dir/narration.wav")"
output_path="$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")"

# A music bed is opt-in and has no default, so a run without DEMO_MUSIC is silent under the voice exactly as before.
# The level is derived rather than guessed: both the narration and the chosen slice of the bed are measured, and the
# bed is placed DEMO_MUSIC_DUCK decibels under the narration's mean. A fixed offset beats a guessed gain, because a
# quiet mix and a loud one need different numbers to sit in the same place.
video_seconds="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$source_path")"
out_seconds="$(python3 -c "print(round($video_seconds / $speed, 3))")"
speed_video=''
voice_tempo=''
speed_audio_map='1:a'
speed_audio_filter=''
if [ "$speed" != "1" ]; then
  # fps is re-applied after setpts because setpts compresses timestamps rather than dropping frames, so without it
  # the output carries the source rate multiplied by the speed.
  speed_video=",setpts=PTS/$speed,fps=$fps"
  voice_tempo="atempo=$speed,"
  speed_audio_map='[audio]'
  speed_audio_filter=";[1:a]${voice_tempo}apad=whole_dur=${out_seconds}[audio]"
  printf 'speed: %sx, %.1fs of picture becomes %.1fs\n' "$speed" "$video_seconds" "$out_seconds"
fi

audio_inputs=()
audio_map="$speed_audio_map"
audio_filter="$speed_audio_filter"
metadata=()
if [ -n "$music" ]; then
  metadata=(-metadata "comment=Music: $music_credit")
  music_path="$(realpath "$music")"
  mean_of() {
    "$ffmpeg" -hide_banner -nostats -i "$1" ${2:+-ss "$2"} -t "$3" -af volumedetect -f null /dev/null 2>&1 |
      sed -n 's/.*mean_volume: \(-\?[0-9.]*\) dB.*/\1/p' | tail -1
  }
  narration_mean="$(mean_of "$audio_path" "" "$out_seconds")"
  music_mean="$(mean_of "$music_path" "$music_start" "$out_seconds")"
  music_gain="$(python3 -c "print(round(($narration_mean - $music_duck) - ($music_mean), 2))")"
  fade_out_at="$(python3 -c "print(max(0, round($out_seconds - $music_fade_out, 3)))")"
  echo "music: bed ${music_duck}dB under narration (${narration_mean}dB), applying ${music_gain}dB from ${music_start}s"
  audio_inputs=(-ss "$music_start" -i "$music_path")
  audio_map='[audio]'
  # The narration ends before the picture does, and amix takes its first input's duration, so without padding the
  # voice out to the full video the mix stops early and the bed's fade-out is cut off partway through.
  audio_filter=";[1:a]${voice_tempo}apad=whole_dur=${out_seconds}[voice];[2:a]volume=${music_gain}dB,afade=t=in:st=0:d=${music_fade_in},afade=t=out:st=${fade_out_at}:d=${music_fade_out}[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0[audio]"
fi

# The two maps are ordered video first on purpose. ffmpeg lays the output streams down in the order it is given them,
# and a film whose stream 0 is audio is a gratuitous difference from every take before it.
mux() {
  local target="$1" filter="$2" amap="$3"
  shift 3
  (
    cd "$demo_dir"
    "$ffmpeg" -y -loglevel error -i "$source_path" -i "$audio_path" "$@" \
      -filter_complex "$filter" -map '[video]' -map "$amap" \
      -c:v libx264 -preset "$preset" -crf 20 -pix_fmt yuv420p \
      -c:a aac -b:a 160k -movflags +faststart "$target"
  )
}

mux "$output_path" "[0:v]$fit,$subtitle_filter$speed_video[video]$audio_filter" "$audio_map" \
  "${audio_inputs[@]}" "${metadata[@]}"

# A voice-only twin of every film that carries a bed, kept beside the take rather than next to the deliverable. The
# music is a judgement call made without a licence to point at, so if a platform mutes the upload the answer is a
# re-upload of a film that already exists, not a re-render against a deadline.
silent_path=''
if [ -n "$music" ]; then
  silent_path="$demo_dir/$(basename -- "${output_path%.mp4}")-silent.mp4"
  mux "$silent_path" "[0:v]$fit,$subtitle_filter$speed_video[video]$speed_audio_filter" "$speed_audio_map"
fi

final_seconds="$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$output_path")"
printf 'video: %.1fs  narration: %.1fs  tail pad: %.1fs\n' "$final_seconds" "$audio_seconds" "$tail_seconds"
printf 'output: %s\n' "$output_path"
if [ -n "$silent_path" ]; then
  printf 'silent twin: %s\n' "$silent_path"
fi
