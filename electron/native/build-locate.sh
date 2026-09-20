#!/bin/bash
# 編譯 MapSkyLocate.app（universal：arm64 + x86_64），輸出到 native/dist/。
# 只在 macOS 上有作用；任何一步失敗都只警告、不中斷（exit 0），這樣就算編譯有問題，
# 整個桌面版還是建得出來，只是那一版不含定位小工具，App 會退回原本的行為。
cd "$(dirname "$0")" || exit 0
OUT="dist"
APP="$OUT/MapSkyLocate.app"
rm -rf "$OUT" build-arm64 build-x86_64
mkdir -p "$OUT"
touch "$OUT/.keep"

if [ "$(uname)" != "Darwin" ]; then
  echo "[locate] 目前不是 macOS，略過定位小工具的編譯"
  exit 0
fi

ok=1
for arch in arm64 x86_64; do
  echo "[locate] swiftc $arch"
  swiftc -O -target "$arch-apple-macos11.0" MapSkyLocate.swift -o "build-$arch" || ok=0
done

if [ "$ok" = "1" ]; then
  mkdir -p "$APP/Contents/MacOS"
  lipo -create build-arm64 build-x86_64 -output "$APP/Contents/MacOS/MapSkyLocate" || ok=0
fi

if [ "$ok" = "1" ]; then
  cp Info.plist "$APP/Contents/Info.plist"
  chmod 755 "$APP/Contents/MacOS/MapSkyLocate"
  echo "[locate] 定位小工具編譯完成：$(lipo -archs "$APP/Contents/MacOS/MapSkyLocate")"
else
  echo "[locate] 警告：定位小工具編譯失敗，這一版不含它（App 會退回原本的定位行為）"
  rm -rf "$APP"
fi

rm -f build-arm64 build-x86_64
exit 0
