#!/usr/bin/env bash
# Contact sheet for comparing takes: one row per video, the same timestamps in every row, the label on each row.
#   usage: scripts/frames-sheet.sh out.png "label=video.mp4" ["label=video2.mp4" ...] [--fps=1] [--frames=84,98,112]
# --frames picks those frame numbers instead of one frame a second; --height=360 makes each frame that tall instead of
# 320 wide; --crop=0.6 keeps the top 60 % of each frame, for faces and hands up close.
set -euo pipefail
OUT="${1:?out.png}"; shift
FPS=1; FRAMES=""; SIZE="scale=320:-2"; CROP=""; ROWS=()
for arg in "$@"; do
  case "$arg" in
    --fps=*) FPS="${arg#--fps=}" ;;
    --frames=*) FRAMES="${arg#--frames=}" ;;
    --height=*) SIZE="scale=-2:${arg#--height=}" ;;
    --crop=*) CROP="crop=iw:ih*${arg#--crop=}:0:0," ;;
    *) ROWS+=("$arg") ;;
  esac
done
PICK="fps=$FPS"; COLS=6
if [ -n "$FRAMES" ]; then
  PICK="select='$(tr ',' '\n' <<<"$FRAMES" | sed 's/.*/eq(n\\,&)/' | paste -sd+)'"; COLS=$(tr ',' '\n' <<<"$FRAMES" | wc -l)
fi
[ "${#ROWS[@]}" -ge 1 ] || { echo "give at least one label=video.mp4"; exit 1; }
B="$(mktemp -d)"; trap 'rm -rf "$B"' EXIT
i=0; INPUTS=(); FILTER=""
for row in "${ROWS[@]}"; do
  label="${row%%=*}"; file="${row#*=}"; label="${label//:/\\:}"; label="${label//\%/\\\\%}"
  ffmpeg -nostdin -v error -y -i "$file" -vf "$PICK,$CROP$SIZE,tile=${COLS}x1,drawbox=x=0:y=0:w=iw:h=22:color=black@0.6:t=fill,drawtext=text='$label':x=8:y=4:fontsize=16:fontcolor=white" -frames:v 1 "$B/row-$i.png"
  INPUTS+=(-i "$B/row-$i.png"); FILTER+="[$i:v]"; i=$((i+1))
done
if [ "$i" -gt 1 ]; then ffmpeg -nostdin -v error -y "${INPUTS[@]}" -filter_complex "${FILTER}vstack=inputs=$i" "$OUT"; else cp "$B/row-0.png" "$OUT"; fi
echo "$OUT"
