#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG_DIR="$ROOT/com.jvhtec.lake-smaart.sdPlugin/images"
FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
CYAN="#00D7FF"

# Create consistent cyan style from any icon, preserve alpha.
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

# Overlay simple badge lines (bottom-right)
add_list_badge() {
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

# Overlay group badge (two circles top-left)
add_group_badge() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -stroke "$CYAN" -strokewidth 18 -fill none \
    -draw "circle 165,165 165,235" \
    -draw "circle 265,245 265,315" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Overlay text badge bottom-right
add_text_badge() {
  local in="$1" out="$2" text="$3"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -font "$FONT" -pointsize 180 \
    -fill "$CYAN" -stroke "#001418" -strokewidth 8 \
    -gravity southeast -annotate +60+40 "$text" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# Overlay trace ON indicator box
add_on_box() {
  local in="$1" out="$2"
  local tmp
  tmp="$(mktemp -t icon.XXXXXX).png"
  magick "$in" \
    -fill "$CYAN" -stroke none \
    -draw "rectangle 760,760 940,940" \
    "$tmp"
  mv -f "$tmp" "$out"
}

# --- Base icons (canonical names used by manifest/docs) ---
for f in icon_dial icon_preset icon_mute icon_smaart_gen icon_smaart_gen_on icon_smaart_gen_off icon_smaart_capture pluginIcon; do
  if [[ -f "$IMG_DIR/${f}.png" ]]; then
    cyanize "$IMG_DIR/${f}.png" "$IMG_DIR/${f}.png"
  fi
done

# --- Derived unique action icons ---
# Scene/Macro
cyanize "$IMG_DIR/icon_preset.png" "$IMG_DIR/icon_scene.png"
add_list_badge "$IMG_DIR/icon_scene.png" "$IMG_DIR/icon_scene.png"

# Multi-mute
cyanize "$IMG_DIR/icon_mute.png" "$IMG_DIR/icon_multimute.png"
add_group_badge "$IMG_DIR/icon_multimute.png" "$IMG_DIR/icon_multimute.png"

# Smaart Delay
cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_delay.png"
add_text_badge "$IMG_DIR/icon_smaart_delay.png" "$IMG_DIR/icon_smaart_delay.png" "DT"

# Smaart Trace off/on
cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_trace_off.png"
add_text_badge "$IMG_DIR/icon_smaart_trace_off.png" "$IMG_DIR/icon_smaart_trace_off.png" "TR"

cyanize "$IMG_DIR/icon_smaart_capture.png" "$IMG_DIR/icon_smaart_trace_on.png"
add_text_badge "$IMG_DIR/icon_smaart_trace_on.png" "$IMG_DIR/icon_smaart_trace_on.png" "TR"
add_on_box "$IMG_DIR/icon_smaart_trace_on.png" "$IMG_DIR/icon_smaart_trace_on.png"

echo "OK"
