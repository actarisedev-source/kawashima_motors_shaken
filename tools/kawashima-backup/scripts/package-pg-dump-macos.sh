#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script packages pg_dump only for macOS arm64." >&2
  exit 1
fi

pg_root="$(brew --prefix postgresql@17)"
source_binary="$pg_root/bin/pg_dump"
destination="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/bin/macos-aarch64"

rm -rf "$destination"
mkdir -p "$destination/licenses"
cp "$source_binary" "$destination/pg_dump"

queue=("$source_binary")
seen=()
while [[ ${#queue[@]} -gt 0 ]]; do
  current="${queue[0]}"
  queue=("${queue[@]:1}")
  while IFS= read -r dependency; do
    [[ -z "$dependency" ]] && continue
    case "$dependency" in
      /usr/lib/*|/System/*) continue ;;
    esac
    resolved="$(realpath "$dependency")"
    basename="$(basename "$resolved")"
    already_seen=false
    for item in "${seen[@]:-}"; do
      [[ "$item" == "$resolved" ]] && already_seen=true
    done
    if [[ "$already_seen" == false ]]; then
      seen+=("$resolved")
      cp "$resolved" "$destination/$basename"
      queue+=("$resolved")
    fi
  done < <(otool -L "$current" | tail -n +2 | awk '{print $1}')
done

for binary in "$destination"/pg_dump "$destination"/*.dylib; do
  while IFS= read -r dependency; do
    [[ -z "$dependency" ]] && continue
    case "$dependency" in
      /usr/lib/*|/System/*|@loader_path/*) continue ;;
    esac
    install_name_tool -change "$dependency" "@loader_path/$(basename "$(realpath "$dependency")")" "$binary"
  done < <(otool -L "$binary" | tail -n +2 | awk '{print $1}')
  if [[ "$binary" == *.dylib ]]; then
    install_name_tool -id "@loader_path/$(basename "$binary")" "$binary"
  fi
  chmod 755 "$binary"
  codesign --force --sign - "$binary"
done

cp "$(brew --prefix postgresql@17)/COPYRIGHT" "$destination/licenses/PostgreSQL-COPYRIGHT.txt"
cp "$(brew --prefix openssl@3)/LICENSE.txt" "$destination/licenses/OpenSSL-LICENSE.txt"
cp "$(brew --prefix gettext)/COPYING" "$destination/licenses/gettext-COPYING.txt"
cp "$(brew --prefix zstd)/LICENSE" "$destination/licenses/zstd-LICENSE.txt"
cp "$(brew --prefix lz4)/LICENSE" "$destination/licenses/lz4-LICENSE.txt"
cp "$(brew --prefix krb5)/NOTICE" "$destination/licenses/krb5-NOTICE.txt"

"$destination/pg_dump" --version
echo "Packaged pg_dump and runtime libraries in $destination"
