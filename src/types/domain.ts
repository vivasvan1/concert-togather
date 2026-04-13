// Shared domain model used by UI, storage, crypto, and transport code.
export type TransportKind =
  | "bluetooth"
  | "wifi-direct"
  | "internet-fallback"
  | "nearby";

export type TransportMode = "demo" | "relay-server" | "nearby-android" | "hybrid";

export type TransportConnectionState =
  | "disconnected"
  | "permission-required"
  | "connecting"
  | "connected"
  | "error";

export type NearbyPermissionState = "unknown" | "granted" | "denied";

export type ContactsPermissionState = "unknown" | "granted" | "denied";

export type DeliveryState = "sending" | "sent" | "delivered" | "read";

export type AvailabilityState = "online" | "degraded" | "offline";

export type ChatRequestStatus =
  | "accepted"
  | "outgoing-pending"
  | "incoming-pending"
  | "declined"
  | "invitable-unregistered";

export type MessageKind =
  | "friend-request"
  | "friend-approval"
  | "chat"
  | "delivery-receipt"
  | "read-receipt"
  | "sync-state";

export interface UserIdentity {
  id: string;
  phoneNumber: string;
  phoneNumberDisplay: string;
  displayName: string;
  publicKey: string;
  secretKey: string;
  encryptionPublicKey: string;
  encryptionSecretKey: string;
}

export interface FriendProfile {
  id: string;
  phoneNumber: string;
  phoneNumberDisplay: string;
  displayName: string;
  publicKey: string;
  encryptionPublicKey: string;
  chatStatus: ChatRequestStatus;
  lastSeenAt: string;
  requestedAt?: string;
  approvedAt?: string;
}

export interface DeviceContact {
  id: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberDisplay: string;
  matchStatus: "matched" | "invite";
  matchedFriendId?: string;
}

export interface EventRecord {
  id: string;
  name: string;
  venueName: string;
  startedAt: string;
  meetupSpots: string[];
  sharedKey: string;
}

export interface ChatMessage {
  id: string;
  kind: "chat";
  senderId: string;
  senderLabel: string;
  eventId: string;
  conversationId: string;
  messageId: string;
  recipientIds: string[];
  ciphertext: string;
  plaintextPreview: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  unread: boolean;
  deliveryState: DeliveryState;
  hopCount: number;
}

export interface RelayEnvelope {
  id: string;
  eventId: string;
  senderId: string;
  senderPublicKey: string;
  senderEncryptionPublicKey: string;
  recipientScope: "direct" | "group";
  encryptionMode: "event-shared" | "direct";
  recipientIds: string[];
  groupId?: string;
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
  phoneNumber?: string;
  phoneNumberDisplay?: string;
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
  transportPeers: TransportPeer[];
  queue: OutboundQueueItem[];
  deliveryHealth: AvailabilityState;
  relayStats: {
    forwardedEnvelopeCount: number;
  };
  contacts: DeviceContact[];
  contactsPermissionState: ContactsPermissionState;
  transportMode: TransportMode;
  relayServerUrl: string;
  transportConnectionState: TransportConnectionState;
  transportError?: string;
  nearbyPermissionState: NearbyPermissionState;
  seenEnvelopeIds: string[];
  selectedChatFriendId?: string;
}

export type EventPayload =
  | {
      kind: "friend-request";
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
      encryptionPublicKey: string;
    }
  | {
      kind: "friend-approval";
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
      approved: true;
      encryptionPublicKey: string;
    }
  | {
      kind: "chat";
      messageId: string;
      body: string;
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
    }
  | {
      kind: "delivery-receipt";
      messageId: string;
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
      deliveredAt: string;
    }
  | {
      kind: "read-receipt";
      messageId: string;
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
      readAt: string;
    }
  | {
      kind: "sync-state";
      senderPhoneNumber: string;
      senderPhoneNumberDisplay: string;
      senderLabel: string;
      sentAt: string;
      conversationId: string;
      messages: Array<{
        messageId: string;
        senderId: string;
        senderLabel: string;
        body: string;
        sentAt: string;
        deliveredAt?: string;
        readAt?: string;
      }>;
    };
