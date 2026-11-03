#!/usr/bin/env bash
# Assembles the ≤2 min demo from a segment list, one segment per line:
#   path<TAB>seconds<TAB>start<TAB>speed<TAB>crop<TAB>blur
# For a picture, seconds is how long it shows. For a video, seconds and start pick the part of the source (optional);
# speed > 1 plays it faster, silent and marked with "N×" in a corner, so a wait is never passed off as real time;
# crop (w:h:x:y, in the source's pixels) zooms into a part of the screen; blur (w:h:x:y, the source's pixels too)
# hides one, such as a strip of test takes. Empty fields collapse in a tab-split line, so a later field needs the ones
# before it: 1 for real time, - for no crop.
# Every input is normalised to 1920×1080, 30 fps, with an audio track (silence when the source has none), then
# concatenated.
#   usage: docs/demo/build.sh docs/demo/segments.tsv docs/demo/xolotl-demo.mp4
set -euo pipefail
LIST="${1:?segments.tsv}"; OUT="${2:?output.mp4}"
B="$(dirname "$OUT")/build"; mkdir -p "$B"; : > "$B/concat.txt"
FIT="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b100e,fps=30,format=yuv420p"
FONT="${DEMO_FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
ENC=(-c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -ar 48000 -ac 2 -shortest -f mpegts)
i=0
while IFS=$'\t' read -r src secs from speed crop blur; do
  [ -n "${src:-}" ] || continue; [[ "$src" == \#* ]] && continue
  i=$((i+1)); seg="$B/seg-$(printf '%02d' $i).ts"
  case "$src" in
    *.png|*.jpg)
      d="${secs:-3}"
      ffmpeg -nostdin -v error -y -loop 1 -t "$d" -i "$src" -f lavfi -t "$d" -i anullsrc=r=48000:cl=stereo \
        -vf "$FIT,fade=t=in:st=0:d=0.4,fade=t=out:st=$(python3 -I -c "print(max(0,float('$d')-0.4))"):d=0.4" \
        "${ENC[@]}" "$seg" ;;
    *)
      part=(); [ -n "${from:-}" ] && part+=(-ss "$from"); [ -n "${secs:-}" ] && part+=(-t "$secs")
      sp="${speed:-1}"; pre=""; [ -n "${crop:-}" ] && [ "$crop" != "-" ] && pre="crop=$crop,"
      vf="[0:v]"
      if [ -n "${blur:-}" ]; then
        IFS=: read -r bw bh bx by <<< "$blur"
        vf="[0:v]split[s0][s1];[s1]crop=$bw:$bh:$bx:$by,boxblur=28:3[hid];[s0][hid]overlay=$bx:$by,"
      fi
      vf="$vf${pre}setpts=PTS/$sp,$FIT"
      if [ "$sp" != "1" ]; then
        vf="$vf,drawtext=fontfile=$FONT:text='${sp}×':x=w-tw-40:y=34:fontsize=34:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=14"
      fi
      if [ "$sp" = "1" ] && ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$src" | grep -q .; then
        ffmpeg -nostdin -v error -y "${part[@]}" -i "$src" -f lavfi -i anullsrc=r=48000:cl=stereo \
          -filter_complex "$vf[v];[0:a]aresample=48000[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$seg"
      else
        ffmpeg -nostdin -v error -y "${part[@]}" -i "$src" -f lavfi -i anullsrc=r=48000:cl=stereo \
          -filter_complex "$vf[v]" -map "[v]" -map "1:a" "${ENC[@]}" "$seg"
      fi ;;
  esac
  printf '%-48s %6.2f s\n' "$(basename "$src") ${from:+@$from}${speed:+ ×$speed}" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$seg")"
  echo "file '$(basename "$seg")'" >> "$B/concat.txt"
done < "$LIST"
ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$B/concat.txt" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart "$OUT"
printf 'demo: %s s → %s\n' "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")" "$OUT"
