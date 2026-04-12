import type { AppState } from "../types/domain";

const DEV_EVENT_SHARED_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export function createSeedState(): AppState {
  const now = new Date().toISOString();

  return {
    user: undefined,
    event: {
      id: "event-headliner-2026",
      name: "Headliner Night",
      venueName: "Apollo Grounds",
      startedAt: now,
      meetupSpots: ["North Gate", "Sound Booth", "Merch Bar", "Food Court", "Exit C"],
      sharedKey: DEV_EVENT_SHARED_KEY,
    },
    friends: [],
    messages: [],
    locationHints: {},
    transportPeers: [],
    queue: [],
    deliveryHealth: "degraded",
    activeMeetupSpot: "Sound Booth",
    transportMode: "nearby-android",
    relayServerUrl: "ws://192.168.1.10:8787",
    transportConnectionState: "permission-required",
    nearbyPermissionState: "unknown",
    nearbyEnabled: false,
    seenEnvelopeIds: [],
  };
}
