#!/usr/bin/env bash
# Compares this grammar with the Che4z HLASM language server on z390's assembler sources,
# which include the IMS MFS screen sources of MVS 3.8J (mvs/maclib/BNGIS*.MAC).
#
#   nix develop -c test/che4z/run.sh [--update]
#
# Downloads the Che4z language server release and z390 at pinned versions into
# test/che4z/.work, records Che4z's syntax verdict per file and hands both parsers'
# verdicts to compare.mjs, which checks them against test/che4z/baseline.tsv.
set -euo pipefail

CHE4Z_RELEASE=1.23.1
Z390_COMMIT=08bdefee8d368c9e2c75c3c1f55a5a26667d16d8
here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work
server=$work/hlasm-language-support-linux-x64-$CHE4Z_RELEASE
z390=$work/z390
files=$work/files

if [ ! -x "$server" ]; then
	echo "run: downloading the Che4z HLASM language server $CHE4Z_RELEASE"
	mkdir -p "$work"
	curl -fsSL -o "$server" \
		"https://github.com/eclipse-che4z/che-che4z-lsp-for-hlasm/releases/download/$CHE4Z_RELEASE/hlasm-language-support-linux-x64-$CHE4Z_RELEASE"
	chmod +x "$server"
fi

if [ "$(git -C "$z390" rev-parse HEAD 2>/dev/null || true)" != "$Z390_COMMIT" ]; then
	echo "run: fetching z390 $Z390_COMMIT"
	mkdir -p "$z390"
	git -C "$z390" init -q
	git -C "$z390" remote add origin https://github.com/z390development/z390.git 2>/dev/null || true
	git -C "$z390" sparse-checkout set mvs/maclib mac rt/test zopcheck
	git -C "$z390" fetch -q --depth 1 --filter=blob:none origin "$Z390_COMMIT"
	git -C "$z390" checkout -q FETCH_HEAD
fi

# One flat directory, named <dir>__<file>, so every file has a unique id in the baseline.
rm -rf "$files"
mkdir -p "$files"
for dir in mvs/maclib mac rt/test zopcheck; do
	for f in "$z390/$dir"/*; do
		case "$f" in *.MAC | *.MLC | *.CPY) cp "$f" "$files/${dir//\//_}__$(basename "$f")" ;; esac
	done
done
ls "$files"/* >"$work/paths.txt"

echo "run: Che4z analyses $(wc -l <"$work/paths.txt") files"
node "$here/verdicts.mjs" "$server" "$work/paths.txt" >"$work/che4z-verdicts.tsv"

node "$here/../compare.mjs" "$work/che4z-verdicts.tsv" "$here/baseline.tsv" "$@"
