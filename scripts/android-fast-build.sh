#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APK_PATH="${1:-$ROOT_DIR/concert-togather-release.apk}"

cd "$ROOT_DIR"

if [ ! -d android ]; then
  echo "Generating native Android project with Expo prebuild..."
  bunx expo prebuild --platform android
fi

echo "Building release APK with Gradle..."
(
  cd android
  ./gradlew assembleRelease
)

cp "$ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk" "$APK_PATH"
echo "APK copied to $APK_PATH"
