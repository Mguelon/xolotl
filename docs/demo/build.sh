#!/usr/bin/env bash
# Assembles the ≤2 min demo from a segment list: one line per segment, "path<TAB>seconds<TAB>start" (seconds and start optional for videos).
# Every input is normalised to 1920×1080, 30 fps, with an audio track (silence when the source has none), then concatenated.
#   usage: docs/demo/build.sh docs/demo/segments.tsv docs/demo/xolotl-demo.mp4
set -euo pipefail
LIST="${1:?segments.tsv}"; OUT="${2:?output.mp4}"
B="$(dirname "$OUT")/build"; mkdir -p "$B"; : > "$B/concat.txt"
i=0
while IFS=$'\t' read -r src secs from; do
  [ -n "${src:-}" ] || continue; [[ "$src" == \#* ]] && continue
  i=$((i+1)); seg="$B/seg-$(printf '%02d' $i).ts"
  case "$src" in
    *.png|*.jpg)
      ffmpeg -v error -y -loop 1 -t "${secs:-3}" -i "$src" -f lavfi -t "${secs:-3}" -i anullsrc=r=48000:cl=stereo \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b100e,fps=30,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=$(python3 -c "print(max(0,float('${secs:-3}')-0.4))"):d=0.4" \
        -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -shortest -f mpegts "$seg" ;;
    *)
      extra=(); [ -n "${secs:-}" ] && extra=(-t "$secs")
      seek=(); [ -n "${from:-}" ] && seek=(-ss "$from")
      ffmpeg -v error -y "${seek[@]}" -i "$src" -f lavfi -i anullsrc=r=48000:cl=stereo "${extra[@]}" \
        -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b100e,fps=30,format=yuv420p[v];[0:a]aresample=48000[a0]" \
        -map "[v]" -map "[a0]?" -map "1:a" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -shortest -f mpegts "$seg" 2>/dev/null \
      || ffmpeg -v error -y "${seek[@]}" -i "$src" -f lavfi -i anullsrc=r=48000:cl=stereo "${extra[@]}" \
        -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b100e,fps=30,format=yuv420p[v]" \
        -map "[v]" -map "1:a" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -shortest -f mpegts "$seg" ;;
  esac
  echo "file '$seg'" >> "$B/concat.txt"
done < "$LIST"
ffmpeg -v error -y -f concat -safe 0 -i "$B/concat.txt" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | xargs printf 'demo: %s s → %s\n' 
