#!/usr/bin/env bash
# Contact sheet for comparing takes: one row per video, the same timestamps in every row, the label on each row.
#   usage: scripts/frames-sheet.sh out.png "label=video.mp4" ["label=video2.mp4" ...] [--fps=1]
set -euo pipefail
OUT="${1:?out.png}"; shift
FPS=1; ROWS=()
for arg in "$@"; do if [[ "$arg" == --fps=* ]]; then FPS="${arg#--fps=}"; else ROWS+=("$arg"); fi; done
[ "${#ROWS[@]}" -ge 1 ] || { echo "give at least one label=video.mp4"; exit 1; }
B="$(mktemp -d)"; trap 'rm -rf "$B"' EXIT
i=0; INPUTS=(); FILTER=""
for row in "${ROWS[@]}"; do
  label="${row%%=*}"; file="${row#*=}"; label="${label//:/\\:}"
  ffmpeg -nostdin -v error -y -i "$file" -vf "fps=$FPS,scale=320:-2,tile=6x1,drawbox=x=0:y=0:w=iw:h=22:color=black@0.6:t=fill,drawtext=text='$label':x=8:y=4:fontsize=16:fontcolor=white" -frames:v 1 "$B/row-$i.png"
  INPUTS+=(-i "$B/row-$i.png"); FILTER+="[$i:v]"; i=$((i+1))
done
if [ "$i" -gt 1 ]; then ffmpeg -nostdin -v error -y "${INPUTS[@]}" -filter_complex "${FILTER}vstack=inputs=$i" "$OUT"; else cp "$B/row-0.png" "$OUT"; fi
echo "$OUT"
