export type TransportKind =
  | "bluetooth"
  | "wifi-direct"
  | "internet-fallback"
  | "nearby";

export type TransportMode = "demo" | "relay-server" | "nearby-android";

export type TransportConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type DeliveryState = "local" | "relayed" | "confirmed" | "stale";

export type AvailabilityState = "online" | "degraded" | "offline";

export type FriendStatus = "safe" | "moving" | "at-stage" | "at-exit" | "at-merch" | "need-help";

export interface UserIdentity {
  id: string;
  handle: string;
  displayName: string;
  publicKey: string;
  secretKey: string;
}

export interface FriendProfile {
  id: string;
  handle: string;
  displayName: string;
  publicKey: string;
  status: FriendStatus;
  lastSeenAt: string;
}

export interface EventRecord {
  id: string;
  name: string;
  venueName: string;
  startedAt: string;
  meetupSpots: string[];
  sharedKey: string;
}

export interface PeerLocationHint {
  friendId: string;
  updatedAt: string;
  meetupSpot?: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  };
  proximity?: {
    estimate: "adjacent" | "nearby" | "same-zone";
    confidence: number;
  };
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderLabel: string;
  eventId: string;
  ciphertext: string;
  plaintextPreview: string;
  createdAt: string;
  deliveryState: DeliveryState;
  hopCount: number;
}

export interface RelayEnvelope {
  id: string;
  eventId: string;
  senderId: string;
  senderPublicKey: string;
  recipientScope: "event-group";
  ciphertext: string;
  signature: string;
  nonce: string;
  hopCount: number;
  ttl: number;
  dedupeKey: string;
  createdAt: string;
}

export interface MeshCapability {
  kind: TransportKind;
  label: string;
  available: boolean;
  canRelayInBackground: boolean;
  note: string;
}

export interface TransportPeer {
  id: string;
  alias: string;
  lastSeenAt: string;
  via: TransportKind;
}

export interface OutboundQueueItem {
  messageId: string;
  envelope: RelayEnvelope;
  createdAt: string;
}

export interface AppState {
  user?: UserIdentity;
  event?: EventRecord;
  friends: FriendProfile[];
  messages: ChatMessage[];
  locationHints: Record<string, PeerLocationHint>;
  transportPeers: TransportPeer[];
  queue: OutboundQueueItem[];
  deliveryHealth: AvailabilityState;
  activeMeetupSpot: string;
  transportMode: TransportMode;
  relayServerUrl: string;
  transportConnectionState: TransportConnectionState;
  transportError?: string;
  seenEnvelopeIds: string[];
}

export interface EventPayload {
  kind: "chat" | "meetup" | "status";
  body: string;
  senderHandle: string;
  senderLabel: string;
  sentAt: string;
  meetupSpot?: string;
  status?: FriendStatus;
  gps?: PeerLocationHint["gps"];
  proximity?: PeerLocationHint["proximity"];
}
