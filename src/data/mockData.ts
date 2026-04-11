import type { AppState, FriendProfile } from "../types/domain";

const DEV_EVENT_SHARED_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

function createFriend(id: string, handle: string, displayName: string): FriendProfile {
  return {
    id,
    handle,
    displayName,
    publicKey: "demo-public-key",
    status: "moving",
    lastSeenAt: new Date().toISOString(),
  };
}

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
    friends: [
      createFriend("friend-mira", "@mira", "Mira"),
      createFriend("friend-kabir", "@kabir", "Kabir"),
      createFriend("friend-jules", "@jules", "Jules"),
    ],
    messages: [],
    locationHints: {
      "friend-mira": {
        friendId: "friend-mira",
        updatedAt: now,
        meetupSpot: "Sound Booth",
        proximity: {
          estimate: "same-zone",
          confidence: 0.51,
        },
      },
      "friend-kabir": {
        friendId: "friend-kabir",
        updatedAt: now,
        gps: {
          latitude: 40.7505,
          longitude: -73.9934,
          accuracyMeters: 36,
        },
      },
    },
    transportPeers: [],
    queue: [],
    deliveryHealth: "degraded",
    activeMeetupSpot: "Sound Booth",
    transportMode: "nearby-android",
    relayServerUrl: "ws://192.168.1.10:8787",
    transportConnectionState: "disconnected",
    seenEnvelopeIds: [],
  };
}
