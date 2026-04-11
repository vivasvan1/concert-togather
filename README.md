# Concert Togather

Concert Togather is a React Native MVP for helping friends reconnect at large concerts when cellular networks are unreliable. It combines:

- event-scoped encrypted group chat
- store-and-forward relay envelopes designed for nearby peer transport
- meetup pins, status updates, and opportunistic GPS hints
- a transport abstraction so Android and iOS radio capabilities can differ without changing app logic

## Current State

This repo implements the application shell, domain model, local persistence, message encryption, relay envelope flow, and a demo transport simulator. It does **not** yet include the native Bluetooth/Wi-Fi mesh modules required for real device-to-device relay.

## Setup

```bash
bun install
bun run typecheck
bun run start
```

## Architecture

- `src/app`: app shell and top-level screen composition
- `src/state`: app reducer, persistence, and mesh coordinator
- `src/services/crypto`: end-to-end payload encryption and signed relay envelopes
- `src/services/mesh`: transport interfaces and a demo composite transport
- `src/services/platform`: platform capability matrix for Android/iOS
- `src/types`: shared domain types for users, events, messages, and location hints

## Native Next Steps

1. Replace `DemoCompositeMeshTransport` with platform-native adapters.
2. Implement Android Bluetooth LE + Wi-Fi Direct discovery and data channels.
3. Implement an iOS-capable nearby transport with explicit foreground/limited-background constraints.
4. Add a minimal coordination backend for accounts, event join, key bundles, and online bootstrap.

