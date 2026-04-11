# Concert Togather

Concert Togather is a React Native MVP for helping friends reconnect at large concerts when cellular networks are unreliable. It combines:

- event-scoped encrypted group chat
- store-and-forward relay envelopes designed for nearby peer transport
- meetup pins, status updates, and opportunistic GPS hints
- a transport abstraction so Android and iOS radio capabilities can differ without changing app logic

## Current State

This repo implements the application shell, domain model, local persistence, message encryption, relay envelope flow, a demo transport simulator, and a local WebSocket relay server for two-phone testing on the same Wi‑Fi network. It does **not** yet include the native Bluetooth/Wi-Fi mesh modules required for true offline device-to-device relay.

## Setup

```bash
bun install
bun run typecheck
bun run start
```

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

This path is for real cross-device testing over Wi‑Fi with encrypted envelopes relayed by your laptop. It is not yet Bluetooth mesh.

## Architecture

- `src/app`: app shell and top-level screen composition
- `src/state`: app reducer, persistence, and mesh coordinator
- `src/services/crypto`: end-to-end payload encryption and signed relay envelopes
- `src/services/mesh`: transport interfaces, demo transport, and WebSocket relay transport
- `scripts/relay-server.ts`: local Bun relay server for two-phone testing
- `src/services/platform`: platform capability matrix for Android/iOS
- `src/types`: shared domain types for users, events, messages, and location hints

## Native Next Steps

1. Replace the relay-test transport path with platform-native peer adapters.
2. Implement Android Bluetooth LE + Wi-Fi Direct discovery and data channels.
3. Implement an iOS-capable nearby transport with explicit foreground/limited-background constraints.
4. Add a minimal coordination backend for accounts, event join, key bundles, and online bootstrap.
