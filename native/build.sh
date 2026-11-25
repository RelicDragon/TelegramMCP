#!/bin/sh
# Builds bin/telegramcp.app: the universal (arm64 + x86_64) viber-ax helper inside an app bundle, so macOS lists
# its Accessibility and Screen Recording permissions as "telegramcp" with its icon. Run before `npm publish`.
#
# Signing: $TELEGRAMCP_SIGN_IDENTITY, else the first "Developer ID Application" identity in the keychain.
# A stable Developer ID signature keeps the permissions across updates; the ad-hoc fallback works, but every
# rebuild then needs them granted again.
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
app=bin/telegramcp.app
rm -rf "$app" bin/viber-ax
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
tmp=$(mktemp -d)
swiftc -O -target arm64-apple-macos13 -o "$tmp/arm64" native/viber-ax.swift
swiftc -O -target x86_64-apple-macos13 -o "$tmp/x86_64" native/viber-ax.swift
lipo -create -output "$app/Contents/MacOS/viber-ax" "$tmp/arm64" "$tmp/x86_64"
rm -rf "$tmp"
sed "s/__VERSION__/$version/g" native/Info.plist > "$app/Contents/Info.plist"
cp native/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"

identity=${TELEGRAMCP_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null |
  sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)}
if [ -n "$identity" ]; then
  codesign --force --options runtime --timestamp --sign "$identity" "$app"
else
  echo "warning: no Developer ID Application identity found; signing ad-hoc" >&2
  codesign --force --sign - "$app"
fi
codesign --verify --strict "$app"
lipo -info "$app/Contents/MacOS/viber-ax"
