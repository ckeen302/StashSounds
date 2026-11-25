#!/usr/bin/env bash
# Fetches the CC0 sample libraries the loop library plays (only the instruments it uses) into
# .local/instruments (gitignored). Both are public domain (CC0 1.0):
#   VCSL, the Versilian Community Sample Library   https://github.com/sgossner/VCSL
#   VSCO 2 Community Edition                         https://github.com/sgossner/VSCO-2-CE
set -euo pipefail
dest="$(cd "$(dirname "$0")/../.." && pwd)/.local/instruments"
mkdir -p "$dest"
fetch() { # repo dir, then sparse patterns
  local repo=$1 dir=$2; shift 2
  [ -d "$dest/$dir/.git" ] || git clone --depth 1 --filter=blob:none --no-checkout "https://github.com/sgossner/$repo.git" "$dest/$dir"
  git -C "$dest/$dir" sparse-checkout init --no-cone
  printf '%s\n' "$@" > "$dest/$dir/.git/info/sparse-checkout"
  git -C "$dest/$dir" checkout -q HEAD
}
fetch VCSL vcsl /LICENSE \
  "/Chordophones/Zithers/Grand Piano, Steinway B/NoSus/*_vl2_*" "/Chordophones/Zithers/Grand Piano, Steinway B/NoSus/*_vl3_*" \
  "/Electrophones/TX81Z/FM Piano/" "/Electrophones/TX81Z/Clavisynth/" "/Idiophones/Struck Idiophones/Vibraphone/" \
  "/Idiophones/Struck Idiophones/Glockenspiel/" "/Idiophones/Struck Idiophones/Marimba/" "/Idiophones/Plucked Idiophones/Kalimba, Kenya/" \
  "/Idiophones/Struck Idiophones/Tubular Bells 2/" "/Idiophones/Struck Idiophones/Hand Chimes/" "/Aerophones/Edge-blown Aerophones/Pipe Organ/" \
  "/Idiophones/Struck Idiophones/Cowbells/" "/Idiophones/Struck Idiophones/Claps/" "/Idiophones/Struck Idiophones/Shaker, Small/" \
  "/Idiophones/Struck Idiophones/Tambourine 1/" "/Chordophones/Composite Chordophones/Concert Harp/" "/Aerophones/Reed Aerophones/Tenor Saxophone/"
fetch VSCO-2-CE vsco /LICENSE "/Strings/Violin Section/" "/Strings/Viola Section/" "/Strings/Cello Section/" "/Strings/Harp/" \
  "/Woodwinds/Flute/" "/Brass/F Horn/sus/" "/Brass/Tenor Trombone/sus/" "/Strings/Solo Contrabass/" "/Percussion/Timpani/"
echo "instruments in $dest"
