#!/usr/bin/env bash
# Vendor comms packages/call-core (the call logic shared with meeting-web) into the app.
#   scripts/sync-call-core.sh [comms checkout]     (default: $COMMS_DIR or ~/git/vertushka/comms)
#   scripts/sync-call-core.sh --check              (CI: the vendored files match the recorded hash)
# The files are copied byte for byte (tests excluded); VERSION records the comms commit and a
# sha256 over the vendored files. Never edit app/products/gomon/native/call_core/ by hand:
# change comms, then run this script.
set -euo pipefail
cd "$(dirname "$0")/.."
DST=app/products/gomon/native/call_core

hash_dir() {
    (cd "$DST" && LC_ALL=C ls *.ts | LC_ALL=C sort | xargs cat) | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1
}

if [ "${1:-}" = "--check" ]; then
    want=$(sed -n 's/^sha256 //p' "$DST/VERSION")
    got=$(hash_dir)
    if [ "$want" != "$got" ]; then
        echo "call_core: vendored files differ from VERSION ($got != $want); run scripts/sync-call-core.sh <comms>" >&2
        exit 1
    fi
    echo "call_core: ok ($(head -1 "$DST/VERSION"))"
    exit 0
fi

SRC="${1:-${COMMS_DIR:-$HOME/git/vertushka/comms}}"
[ -f "$SRC/packages/call-core/src/index.ts" ] || { echo "no packages/call-core in $SRC" >&2; exit 1; }
rev=$(git -C "$SRC" rev-parse --short HEAD)
dirty=$(git -C "$SRC" status --porcelain -- packages/call-core | head -1)
rm -rf "$DST"
mkdir -p "$DST"
for f in "$SRC"/packages/call-core/src/*.ts; do
    case "$f" in *.test.ts) continue ;; esac
    cp "$f" "$DST/"
done
{
    echo "comms ${rev}${dirty:+ (dirty)} packages/call-core $(git -C "$SRC" log -1 --format=%cs)"
    echo "sha256 $(hash_dir)"
} > "$DST/VERSION"
cat "$DST/VERSION"
