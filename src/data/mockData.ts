import type { AppState } from "../types/domain";

const DEV_EVENT_SHARED_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export function createSeedState(): AppState {
  const now = new Date().toISOString();

  return {
    user: undefined,
    event: {
      id: "event-headliner-2026",
      name: "Concert Mesh",
      venueName: "Apollo Grounds",
      startedAt: now,
      meetupSpots: ["North Gate", "Sound Booth", "Merch Bar", "Food Court", "Exit C"],
      sharedKey: DEV_EVENT_SHARED_KEY,
    },
    friends: [],
    messages: [],
    transportPeers: [],
    queue: [],
    deliveryHealth: "degraded",
    relayStats: {
      forwardedEnvelopeCount: 0,
    },
    contacts: [],
    contactsPermissionState: "unknown",
    transportMode: "hybrid",
    relayServerUrl: "ws://192.168.1.10:8787/ws",
    transportConnectionState: "permission-required",
    nearbyPermissionState: "unknown",
    seenEnvelopeIds: [],
    selectedChatFriendId: undefined,
  };
}
