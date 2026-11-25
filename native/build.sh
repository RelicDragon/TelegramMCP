#!/bin/sh
# Builds the universal (arm64 + x86_64) viber-ax helper into bin/. Run before `npm publish`.
set -e
cd "$(dirname "$0")/.."
mkdir -p bin
tmp=$(mktemp -d)
swiftc -O -target arm64-apple-macos13 -o "$tmp/arm64" native/viber-ax.swift
swiftc -O -target x86_64-apple-macos13 -o "$tmp/x86_64" native/viber-ax.swift
lipo -create -output bin/viber-ax "$tmp/arm64" "$tmp/x86_64"
codesign --force --sign - bin/viber-ax 2>/dev/null || true
rm -rf "$tmp"
lipo -info bin/viber-ax
