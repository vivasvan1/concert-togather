# Concert Togather

Concert Togather is a React Native MVP for helping friends reconnect at large concerts when cellular networks are unreliable. It combines:

- event-scoped encrypted group chat
- store-and-forward relay envelopes designed for nearby peer transport
- meetup pins, status updates, and opportunistic GPS hints
- a transport abstraction so Android and iOS radio capabilities can differ without changing app logic

## Current State

This repo implements the application shell, domain model, local persistence, message encryption, relay envelope flow, a demo transport simulator, a local WebSocket relay server fallback, and an Android native nearby transport built as a local Expo module.

## Setup

```bash
bun install
bun run typecheck
bun run start
```

## Native Firebase Files

This repo now loads Firebase native app files only when they exist locally. For native builds, add:

- `google-services.json` for Android
- `GoogleService-Info.plist` for iOS

Both files are ignored by Git in this repo and should be downloaded from the matching Firebase app settings before running native prebuilds or EAS builds.

For GitHub Actions Android release builds, add a repository secret named `GOOGLE_SERVICES_JSON` whose value is the full contents of your Android `google-services.json` file. The workflow writes that secret to the repo root before running `./gradlew assembleRelease`.

## Build Android APK

This project can already be packaged as an Android APK and installed on two phones.
The APK is suitable for:

- onboarding and handle creation
- meetup/status flows
- GPS permission flow
- encrypted messaging between two Android phones through direct nearby discovery
- fallback same-Wi-Fi messaging through the laptop relay server

The current native implementation is Android-only and optimized for the first direct two-phone milestone, not full crowd-tested multi-hop mesh yet.

### One-time prerequisites

```bash
npm install -g eas-cli
eas login
```

### Build the APK

```bash
cd /Users/vivasvan.patel/Work/concert-togather
eas build -p android --profile preview
```

When the build finishes, download the generated `.apk` and install it on both Android phones.

### Faster local rebuilds

For repeated device testing on the same machine, skip the full EAS local flow and reuse a generated native Android project:

```bash
cd /Users/vivasvan.patel/Work/concert-togather
bun run android:fast-build
```

This does:

- `expo prebuild --platform android` once, if `android/` does not exist yet
- `./gradlew assembleRelease` for subsequent APK rebuilds
- copies the final APK to `./concert-togather-release.apk`

This is usually much faster than rerunning `eas build --local` every time.

## Build for iPhone

The current iPhone milestone is relay-first. The shared app shell, Firebase flows, contacts, meetup/status updates, and encrypted messaging work on iOS, but direct nearby phone-to-phone mesh is still Android-only.

### One-time prerequisites

1. Create an iOS app for the same Firebase project and download `GoogleService-Info.plist`.
2. Place `GoogleService-Info.plist` in the repo root.
3. Generate the native iOS project:

```bash
cd /Users/vivasvan.patel/Work/concert-togather
bun run ios:prebuild
```

If `GoogleService-Info.plist` is missing, native iOS prebuilds will fail immediately. That file is required because `@react-native-firebase/app` wires it into the Xcode project during prebuild.

### Run on your iPhone

```bash
cd /Users/vivasvan.patel/Work/concert-togather
bun run ios
```

Use the relay server path for live cross-device messaging:

1. Start the local relay server with `bun run relay`.
2. Put both phones and your laptop on the same Wi-Fi network.
3. In the app on both phones, set transport to the relay server URL `ws://YOUR_LAN_IP:8787`.
4. Join the same event and send messages, meetup updates, and status changes.

If you want an installable cloud build instead of a direct Xcode/dev run:

```bash
eas build -p ios --profile preview
```

## GitHub Release APK

This repo now includes a GitHub Actions workflow that builds an Android APK and attaches it to a GitHub Release whenever you push a tag that starts with `v`.

### Publish a release

```bash
git add .
git commit -m "Prepare release"
git push origin main
git tag v0.1.0
git push origin v0.1.0
```

After the tag is pushed, GitHub Actions will:

- install dependencies
- run type-checking
- build `android/app/build/outputs/apk/release/app-release.apk`
- create a GitHub Release for the tag
- attach `concert-togather-v0.1.0.apk` to the release

Before using this workflow, add the repository secret `GOOGLE_SERVICES_JSON` in GitHub Settings -> Secrets and variables -> Actions. Paste the complete JSON contents from your Firebase Android app config file.

### Important note

The current Android `release` build is signed with the debug keystore in [android/app/build.gradle](./android/app/build.gradle). That is fine for internal testing and easy installs from GitHub Releases, but it is not appropriate for Play Store or long-term production distribution.

### Test with 2 phones

1. Install the APK on both devices.
2. Open the APK on both Android phones.
3. In the app on both phones:
   - create different handles
   - keep transport mode on `Nearby Android`
   - tap `Start Nearby`
   - grant nearby/Bluetooth/location permissions when prompted
   - join the same event
4. Keep both devices in the foreground and send messages between them.

### Focused adb logs

Use these commands to keep logs readable while testing nearby transport:

```bash
adb logcat -c
adb shell am force-stop com.vivasvan.concertmesh
adb shell am start -n com.vivasvan.concertmesh/.MainActivity
adb logcat -v time AndroidRuntime:E ReactNativeJS:I ConcertNearbyMesh:V *:S
```

If you are targeting a specific device:

```bash
adb -s DEVICE_ID logcat -v time AndroidRuntime:E ReactNativeJS:I ConcertNearbyMesh:V *:S
```

### Fallback relay test

If direct nearby transport is flaky on your devices, you can still use the relay fallback:

1. Put both phones and your laptop on the same Wi-Fi network.
2. Start the relay server on your laptop:

```bash
bun run relay
```

If `8787` is already in use:

```bash
PORT=19091 bun run relay
```

3. Find your laptop IP:

```bash
ipconfig getifaddr en0
```

or, if needed:

```bash
ipconfig getifaddr en1
```

4. In the app on both phones:
   - create different handles
   - switch transport mode to `Relay server`
   - enter `ws://YOUR_LAN_IP:PORT`
   - tap `Apply URL`
5. Send messages and meetup updates between the two phones.

## Two-Phone Test

1. Start the local relay server on your laptop:

```bash
bun run relay
```

If `8787` is already in use, pick another port:

```bash
PORT=19091 bun run relay
```

2. Find your laptop's LAN IP address and use `ws://YOUR_LAN_IP:PORT`.
3. Start Expo with `bun run start` and open the app on both phones with Expo Go.
4. On both phones:
   - create a different handle
   - switch transport mode to `Relay server`
   - enter the same relay URL
   - tap `Apply URL`
5. Send messages between the phones. Meetup/status updates should also propagate.

This fallback path is for real cross-device testing over Wi‑Fi with encrypted envelopes relayed by your laptop.

## Architecture

- `src/app`: app shell and top-level screen composition
- `src/state`: app reducer, persistence, and mesh coordinator
- `src/services/crypto`: end-to-end payload encryption and signed relay envelopes
- `src/services/mesh`: transport interfaces, demo transport, WebSocket relay transport, and Android nearby transport
- `modules/concert-nearby-mesh`: local Expo Android module backed by Google Nearby Connections
- `scripts/relay-server.ts`: local Bun relay server for two-phone testing
- `src/services/platform`: platform capability matrix for Android/iOS
- `src/types`: shared domain types for users, events, messages, and location hints

## Native Next Steps

1. Harden the Android nearby transport for reconnects, duplicate suppression, and background lifecycle.
2. Expand from direct nearby messaging to tested multi-hop forwarding.
3. Implement an iOS-capable nearby transport with `MultipeerConnectivity` and explicit foreground constraints.
4. Add a minimal coordination backend for accounts, event join, key bundles, and online bootstrap.

### Dual Device (With Pairing)
```sh
# Replace XXXXX with pairing ports, YYYYYY/ZZZZZZ with codes, and DEVICE1/2 with connection ports
DEVICE1="192.168.31.219:43183" PAIR_ADDR1="192.168.31.219:XXXXX" PAIR_CODE1="YYYYYY" DEVICE2="192.168.X.X:PORT" PAIR_ADDR2="192.168.X.X:XXXXX" PAIR_CODE2="ZZZZZZ" APK_PATH="$PWD/concert-togather-release.apk" && adb pair "$PAIR_ADDR1" "$PAIR_CODE1" && adb pair "$PAIR_ADDR2" "$PAIR_CODE2" && bun run android:fast-build && adb connect "$DEVICE1" && adb connect "$DEVICE2" && (adb -s "$DEVICE1" uninstall com.vivasvan.concertmesh || true) && (adb -s "$DEVICE2" uninstall com.vivasvan.concertmesh || true) && adb -s "$DEVICE1" install -r "$APK_PATH" && adb -s "$DEVICE2" install -r "$APK_PATH" && adb -s "$DEVICE1" logcat -c && adb -s "$DEVICE2" logcat -c && adb -s "$DEVICE1" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE2" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE1" shell am start -n com.vivasvan.concertmesh/.MainActivity && adb -s "$DEVICE2" shell am start -n com.vivasvan.concertmesh/.MainActivity && tmux new-window -n concert-logs "printf 'PHONE 1 %s\n\n' '$DEVICE1'; adb -s '$DEVICE1' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'" \; split-window -h "printf 'PHONE 2 %s\n\n' '$DEVICE2'; adb -s '$DEVICE2' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'" \; select-layout even-horizontal
```

### Dual Device (No Pairing)
```sh
DEVICE1="192.168.31.219:43183" DEVICE2="192.168.X.X:PORT" APK_PATH="$PWD/concert-togather-release.apk" && bun run android:fast-build && adb connect "$DEVICE1" && adb connect "$DEVICE2" && (adb -s "$DEVICE1" uninstall com.vivasvan.concertmesh || true) && (adb -s "$DEVICE2" uninstall com.vivasvan.concertmesh || true) && adb -s "$DEVICE1" install -r "$APK_PATH" && adb -s "$DEVICE2" install -r "$APK_PATH" && adb -s "$DEVICE1" logcat -c && adb -s "$DEVICE2" logcat -c && adb -s "$DEVICE1" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE2" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE1" shell am start -n com.vivasvan.concertmesh/.MainActivity && adb -s "$DEVICE2" shell am start -n com.vivasvan.concertmesh/.MainActivity && tmux new-window -n concert-logs "printf 'PHONE 1 %s\n\n' '$DEVICE1'; adb -s '$DEVICE1' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'" \; split-window -h "printf 'PHONE 2 %s\n\n' '$DEVICE2'; adb -s '$DEVICE2' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'" \; select-layout even-horizontal
```

### Single Device (With Pairing)
```sh
DEVICE1="192.168.31.219:43183" PAIR_ADDR="192.168.31.219:XXXXX" PAIR_CODE="YYYYYY" APK_PATH="$PWD/concert-togather-release.apk" && adb pair "$PAIR_ADDR" "$PAIR_CODE" && bun run android:fast-build && adb connect "$DEVICE1" && (adb -s "$DEVICE1" uninstall com.vivasvan.concertmesh || true) && adb -s "$DEVICE1" install -r "$APK_PATH" && adb -s "$DEVICE1" logcat -c && adb -s "$DEVICE1" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE1" shell am start -n com.vivasvan.concertmesh/.MainActivity && tmux new-window -n concert-logs "adb -s '$DEVICE1' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'"
```

### Single Device (No Pairing)
```sh
DEVICE1="192.168.31.219:43183" APK_PATH="$PWD/concert-togather-release.apk" && bun run android:fast-build && adb connect "$DEVICE1" && (adb -s "$DEVICE1" uninstall com.vivasvan.concertmesh || true) && adb -s "$DEVICE1" install -r "$APK_PATH" && adb -s "$DEVICE1" logcat -c && adb -s "$DEVICE1" shell am force-stop com.vivasvan.concertmesh && adb -s "$DEVICE1" shell am start -n com.vivasvan.concertmesh/.MainActivity && tmux new-window -n concert-logs "adb -s '$DEVICE1' logcat -v time ConcertNearbyMesh:V NearbyConnections:V AndroidRuntime:E '*:S'"
```