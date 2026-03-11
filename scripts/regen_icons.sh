#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG_DIR="$ROOT/com.jvhtec.lake-smaart.sdPlugin/images"
CYAN="#00D7FF"

cyanize() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -colorspace Gray -auto-level \
    -fill "$CYAN" -tint 100 \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Bottom-right list badge (Scene)
add_scene_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -stroke "$CYAN" -strokewidth 26 -fill none \
    -draw "line 700,790 920,790" \
    -draw "line 700,845 920,845" \
    -draw "line 700,900 920,900" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Top-left group badge (two rings)
add_group_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -stroke "$CYAN" -strokewidth 18 -fill none \
    -draw "circle 160,170 160,240" \
    -draw "circle 270,260 270,330" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Bottom-right delay badge (two vertical bars + tiny dot)
add_delay_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -stroke "$CYAN" -strokewidth 30 -fill none \
    -draw "line 770,740 770,930" \
    -draw "line 860,700 860,930" \
    -fill "$CYAN" -stroke none \
    -draw "circle 900,740 900,760" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Bottom-right trace badges
add_trace_off_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -stroke "$CYAN" -strokewidth 12 -fill none \
    -draw "rectangle 760,760 940,940" \
    "$tmp"
  mv -f "$tmp" "$out"
}

add_trace_on_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -fill "$CYAN" -stroke none \
    -draw "rectangle 760,760 940,940" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# --- Base icons used by manifest/docs ---
for f in icon_dial icon_preset icon_mute icon_smaart_gen icon_smaart_gen_on icon_smaart_gen_off icon_smaart_capture pluginIcon; do
  if [[ -f "$IMG_DIR/${f}.png" ]]; then
    cyanize "$IMG_DIR/${f}.png" "$IMG_DIR/${f}.png"
  fi
done

# --- Derived unique action icons ---
cyanize "$IMG_DIR/icon_preset.png" "$IMG_DIR/icon_scene.png"
add_scene_badge "$IMG_DIR/icon_scene.png" "$IMG_DIR/icon_scene.png"

cyanize "$IMG_DIR/icon_mute.png" "$IMG_DIR/icon_multimute.png"
add_group_badge "$IMG_DIR/icon_multimute.png" "$IMG_DIR/icon_multimute.png"

cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_delay.png"
add_delay_badge "$IMG_DIR/icon_smaart_delay.png" "$IMG_DIR/icon_smaart_delay.png"

cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_trace_off.png"
add_trace_off_badge "$IMG_DIR/icon_smaart_trace_off.png" "$IMG_DIR/icon_smaart_trace_off.png"

cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_trace_on.png"
add_trace_on_badge "$IMG_DIR/icon_smaart_trace_on.png" "$IMG_DIR/icon_smaart_trace_on.png"

echo "OK"
