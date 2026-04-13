import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { loadDeviceContacts, requestContactsPermission } from "../services/contacts/ContactsService";
import {
  createUserIdentity,
  decryptFromSender,
  decryptWithEventSharedKey,
  verifyEnvelopeSignature,
} from "../services/crypto/CryptoService";
import { AndroidNearbyTransport } from "../services/mesh/AndroidNearbyTransport";
import { DemoCompositeMeshTransport } from "../services/mesh/DemoCompositeMeshTransport";
import {
  createControlRelayEnvelope,
  createDirectRelayEnvelope,
  forwardRelayEnvelope,
} from "../services/mesh/relay";
import type { MeshTransport } from "../services/mesh/Transport";
import { WebSocketRelayTransport } from "../services/mesh/WebSocketRelayTransport";
import { createSeedState } from "../data/mockData";
import type {
  AppState,
  ChatMessage,
  ContactsPermissionState,
  DeliveryState,
  DeviceContact,
  EventPayload,
  FriendProfile,
  NearbyPermissionState,
  RelayEnvelope,
  TransportConnectionState,
  TransportMode,
  TransportPeer,
  UserIdentity,
} from "../types/domain";
import { createId } from "../utils/ids";
import { formatPhoneNumber, isLikelyPhoneNumber, normalizePhoneNumber } from "../utils/phone";

const STORAGE_KEY = "concert-togather/app-state-v5";
type AndroidPermissionValue =
  (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];

type AppAction =
  | { type: "hydrated"; payload: AppState }
  | { type: "set-user"; payload: UserIdentity }
  | { type: "set-contacts-permission"; payload: ContactsPermissionState }
  | { type: "set-contacts"; payload: DeviceContact[] }
  | { type: "mark-seen-envelope"; payload: { envelopeId: string } }
  | {
      type: "queue-chat-envelope";
      payload: {
        envelope: RelayEnvelope;
        messageId: string;
        conversationId: string;
        preview: string;
      };
    }
  | { type: "ack-outbound-send"; payload: { envelopeId: string } }
  | { type: "set-peers"; payload: TransportPeer[] }
  | { type: "set-transport-mode"; payload: TransportMode }
  | { type: "set-relay-url"; payload: string }
  | { type: "set-nearby-enabled"; payload: boolean }
  | { type: "set-nearby-permission-state"; payload: NearbyPermissionState }
  | {
      type: "set-transport-connection";
      payload: { state: TransportConnectionState; error?: string };
    }
  | { type: "increment-relay-forwarded" }
  | { type: "add-outgoing-request"; payload: FriendProfile }
  | {
      type: "create-invite-placeholder";
      payload: { phoneNumber: string; displayName: string };
    }
  | {
      type: "receive-friend-request";
      payload: {
        envelope: RelayEnvelope;
        eventPayload: Extract<EventPayload, { kind: "friend-request" }>;
      };
    }
  | {
      type: "approve-friend-local";
      payload: { friendId: string; approvedAt: string };
    }
  | { type: "decline-friend-local"; payload: { friendId: string } }
  | {
      type: "receive-friend-approval";
      payload: {
        envelope: RelayEnvelope;
        eventPayload: Extract<EventPayload, { kind: "friend-approval" }>;
      };
    }
  | {
      type: "receive-chat";
      payload: {
        envelope: RelayEnvelope;
        eventPayload: Extract<EventPayload, { kind: "chat" }>;
      };
    }
  | {
      type: "apply-delivery-receipt";
      payload: {
        eventPayload: Extract<EventPayload, { kind: "delivery-receipt" }>;
      };
    }
  | {
      type: "apply-read-receipt";
      payload: {
        eventPayload: Extract<EventPayload, { kind: "read-receipt" }>;
      };
    }
  | {
      type: "merge-sync-state";
      payload: {
        friendId: string;
        eventPayload: Extract<EventPayload, { kind: "sync-state" }>;
      };
    }
  | {
      type: "mark-conversation-read";
      payload: { friendId: string; readAt: string };
    }
  | { type: "set-selected-chat-friend"; payload?: string };

function conversationIdFor(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join(":");
}

function compareMessages(left: ChatMessage, right: ChatMessage) {
  const byTime =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return left.messageId.localeCompare(right.messageId);
}

function computeDeliveryState(
  message: Pick<ChatMessage, "readAt" | "deliveredAt">,
): DeliveryState {
  if (message.readAt) {
    return "read";
  }
  if (message.deliveredAt) {
    return "delivered";
  }
  return "sent";
}

function mergeMessages(messages: ChatMessage[], incoming: ChatMessage) {
  const existing = messages.find((message) => message.messageId === incoming.messageId);
  if (!existing) {
    return [...messages, incoming].sort(compareMessages);
  }

  return messages
    .map((message) =>
      message.messageId === incoming.messageId
        ? {
            ...message,
            ...incoming,
            deliveredAt: incoming.deliveredAt ?? message.deliveredAt,
            readAt: incoming.readAt ?? message.readAt,
            unread: incoming.unread || message.unread,
            deliveryState: computeDeliveryState({
              deliveredAt: incoming.deliveredAt ?? message.deliveredAt,
              readAt: incoming.readAt ?? message.readAt,
            }),
          }
        : message,
    )
    .sort(compareMessages);
}

function updateMessageById(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
) {
  return messages.map((message) =>
    message.messageId === messageId ? updater(message) : message,
  );
}

function getConversationMessages(messages: ChatMessage[], leftId: string, rightId: string) {
  const conversationId = conversationIdFor(leftId, rightId);
  return messages.filter((message) => message.conversationId === conversationId);
}

function getLatestConversationTimestamp(
  messages: ChatMessage[],
  friendId: string,
  currentUserId?: string,
) {
  if (!currentUserId) {
    return 0;
  }

  return getConversationMessages(messages, currentUserId, friendId).reduce(
    (latest, message) => Math.max(latest, new Date(message.createdAt).getTime()),
    0,
  );
}

function normalizePeer(peer: TransportPeer): TransportPeer {
  const phoneNumber = normalizePhoneNumber(peer.phoneNumber ?? peer.alias);
  return {
    ...peer,
    phoneNumber: phoneNumber || undefined,
    phoneNumberDisplay: phoneNumber ? formatPhoneNumber(phoneNumber) : peer.alias,
  };
}

function matchContacts(contacts: DeviceContact[], friends: FriendProfile[]) {
  return contacts.map((contact) => {
    const matchedFriend = friends.find((friend) => friend.phoneNumber === contact.phoneNumber);
    return {
      ...contact,
      matchStatus: matchedFriend ? ("matched" as const) : ("invite" as const),
      matchedFriendId: matchedFriend?.id,
    };
  });
}

function upsertFriend(friends: FriendProfile[], nextFriend: FriendProfile): FriendProfile[] {
  const existing = friends.find((friend) => friend.id === nextFriend.id);
  if (!existing) {
    return [nextFriend, ...friends];
  }

  return friends.map((friend) =>
    friend.id === nextFriend.id
      ? {
          ...friend,
          ...nextFriend,
          displayName: nextFriend.displayName || friend.displayName,
          phoneNumber: nextFriend.phoneNumber || friend.phoneNumber,
          phoneNumberDisplay: nextFriend.phoneNumberDisplay || friend.phoneNumberDisplay,
          publicKey: nextFriend.publicKey || friend.publicKey,
          encryptionPublicKey:
            nextFriend.encryptionPublicKey || friend.encryptionPublicKey,
          requestedAt: nextFriend.requestedAt ?? friend.requestedAt,
          approvedAt: nextFriend.approvedAt ?? friend.approvedAt,
        }
      : friend,
  );
}

function applyFriendUpsert(state: AppState, nextFriend: FriendProfile) {
  const friends = upsertFriend(state.friends, nextFriend);
  return {
    ...state,
    friends,
    contacts: matchContacts(state.contacts, friends),
  };
}

function migrateUser(rawUser: any): UserIdentity | undefined {
  if (!rawUser) {
    return undefined;
  }

  const phoneNumber = normalizePhoneNumber(rawUser.phoneNumber ?? rawUser.handle ?? "");
  return {
    ...rawUser,
    phoneNumber,
    phoneNumberDisplay:
      rawUser.phoneNumberDisplay || formatPhoneNumber(phoneNumber) || rawUser.displayName || "You",
    displayName:
      rawUser.displayName || rawUser.phoneNumberDisplay || formatPhoneNumber(phoneNumber) || "You",
  };
}

function mapLegacyStatus(status: string | undefined): FriendProfile["chatStatus"] {
  if (status === "approved") {
    return "accepted";
  }
  if (status === "incoming-pending") {
    return "incoming-pending";
  }
  if (status === "outgoing-pending") {
    return "outgoing-pending";
  }
  if (status === "rejected") {
    return "declined";
  }
  return "invitable-unregistered";
}

function migrateFriend(rawFriend: any): FriendProfile {
  const phoneNumber = normalizePhoneNumber(rawFriend.phoneNumber ?? rawFriend.handle ?? "");
  return {
    id: rawFriend.id,
    phoneNumber,
    phoneNumberDisplay:
      rawFriend.phoneNumberDisplay || formatPhoneNumber(phoneNumber) || rawFriend.displayName || "",
    displayName:
      rawFriend.displayName || rawFriend.phoneNumberDisplay || formatPhoneNumber(phoneNumber) || "",
    publicKey: rawFriend.publicKey ?? "",
    encryptionPublicKey: rawFriend.encryptionPublicKey ?? "",
    chatStatus: rawFriend.chatStatus ?? mapLegacyStatus(rawFriend.friendshipStatus),
    lastSeenAt: rawFriend.lastSeenAt ?? new Date().toISOString(),
    requestedAt: rawFriend.requestedAt,
    approvedAt: rawFriend.approvedAt,
  };
}

function mergeHydratedState(base: AppState, persisted: any): AppState {
  const user = migrateUser(persisted?.user) ?? base.user;
  const friends = Array.isArray(persisted?.friends)
    ? persisted.friends.map(migrateFriend)
    : base.friends;
  const contacts = Array.isArray(persisted?.contacts) ? persisted.contacts : base.contacts;

  return {
    ...base,
    ...persisted,
    user,
    event: persisted?.event ?? base.event,
    friends,
    messages: [...(persisted?.messages ?? base.messages)].sort(compareMessages),
    transportPeers: (persisted?.transportPeers ?? []).map(normalizePeer),
    queue: persisted?.queue ?? [],
    relayStats: persisted?.relayStats ?? base.relayStats,
    contacts: matchContacts(contacts, friends),
    contactsPermissionState:
      persisted?.contactsPermissionState ?? base.contactsPermissionState,
    nearbyPermissionState:
      persisted?.nearbyPermissionState ?? base.nearbyPermissionState,
    nearbyEnabled: persisted?.nearbyEnabled ?? base.nearbyEnabled,
    seenEnvelopeIds: persisted?.seenEnvelopeIds ?? [],
    selectedChatFriendId:
      persisted?.selectedChatFriendId ?? base.selectedChatFriendId,
  };
}

async function requestNearbyPermissions() {
  if (Platform.OS !== "android") {
    return {
      granted: false,
      state: "denied" as NearbyPermissionState,
      missing: ["android-only"],
    };
  }

  const apiLevel =
    typeof Platform.Version === "number"
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10);

  const permissions: AndroidPermissionValue[] = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];

  if (apiLevel >= 31) {
    permissions.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    );
  }

  if (apiLevel >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  }

  const results = (await PermissionsAndroid.requestMultiple(
    permissions,
  )) as Record<AndroidPermissionValue, string>;
  const missing = permissions.filter(
    (permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED,
  );

  return {
    granted: missing.length === 0,
    state:
      missing.length === 0
        ? ("granted" as NearbyPermissionState)
        : ("denied" as NearbyPermissionState),
    missing,
  };
}

function buildPayload(
  user: UserIdentity,
  payload:
    | { kind: "friend-request"; sentAt: string }
    | { kind: "friend-approval"; sentAt: string }
    | { kind: "chat"; sentAt: string; body: string; messageId: string }
    | { kind: "delivery-receipt"; sentAt: string; messageId: string; deliveredAt: string }
    | { kind: "read-receipt"; sentAt: string; messageId: string; readAt: string }
    | {
        kind: "sync-state";
        sentAt: string;
        conversationId: string;
        messages: Extract<EventPayload, { kind: "sync-state" }>["messages"];
      },
): EventPayload {
  const base = {
    senderPhoneNumber: user.phoneNumber,
    senderPhoneNumberDisplay: user.phoneNumberDisplay,
    senderLabel: user.displayName,
  };

  if (payload.kind === "friend-request") {
    return {
      kind: "friend-request",
      ...base,
      sentAt: payload.sentAt,
      encryptionPublicKey: user.encryptionPublicKey,
    };
  }

  if (payload.kind === "friend-approval") {
    return {
      kind: "friend-approval",
      ...base,
      sentAt: payload.sentAt,
      approved: true,
      encryptionPublicKey: user.encryptionPublicKey,
    };
  }

  if (payload.kind === "chat") {
    return {
      kind: "chat",
      ...base,
      messageId: payload.messageId,
      body: payload.body,
      sentAt: payload.sentAt,
    };
  }

  if (payload.kind === "delivery-receipt") {
    return {
      kind: "delivery-receipt",
      ...base,
      messageId: payload.messageId,
      sentAt: payload.sentAt,
      deliveredAt: payload.deliveredAt,
    };
  }

  if (payload.kind === "read-receipt") {
    return {
      kind: "read-receipt",
      ...base,
      messageId: payload.messageId,
      sentAt: payload.sentAt,
      readAt: payload.readAt,
    };
  }

  return {
    kind: "sync-state",
    ...base,
    sentAt: payload.sentAt,
    conversationId: payload.conversationId,
    messages: payload.messages,
  };
}

function isEnvelopeForCurrentUser(envelope: RelayEnvelope, currentUserId: string) {
  return envelope.recipientIds.includes(currentUserId);
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "hydrated":
      return action.payload;
    case "set-user":
      return {
        ...state,
        user: action.payload,
      };
    case "set-contacts-permission":
      return {
        ...state,
        contactsPermissionState: action.payload,
      };
    case "set-contacts":
      return {
        ...state,
        contacts: matchContacts(action.payload, state.friends),
      };
    case "mark-seen-envelope":
      if (state.seenEnvelopeIds.includes(action.payload.envelopeId)) {
        return state;
      }
      return {
        ...state,
        seenEnvelopeIds: [...state.seenEnvelopeIds, action.payload.envelopeId],
      };
    case "queue-chat-envelope": {
      const recipientId = action.payload.envelope.recipientIds[0] ?? "unknown";
      const message: ChatMessage = {
        id: action.payload.messageId,
        kind: "chat",
        senderId: state.user?.id ?? "unknown",
        senderLabel: state.user?.displayName ?? "You",
        eventId: state.event?.id ?? "event",
        conversationId: action.payload.conversationId,
        messageId: action.payload.messageId,
        recipientIds: action.payload.envelope.recipientIds,
        ciphertext: action.payload.envelope.ciphertext,
        plaintextPreview: action.payload.preview,
        createdAt: action.payload.envelope.createdAt,
        unread: false,
        deliveryState: "sending",
        hopCount: 0,
      };

      return {
        ...state,
        messages: mergeMessages(state.messages, message),
        queue: [
          {
            messageId: message.messageId,
            envelope: action.payload.envelope,
            createdAt: action.payload.envelope.createdAt,
          },
          ...state.queue.filter((item) => item.messageId !== message.messageId),
        ],
        seenEnvelopeIds: [...state.seenEnvelopeIds, action.payload.envelope.id],
        selectedChatFriendId: recipientId,
        deliveryHealth: "online",
      };
    }
    case "ack-outbound-send": {
      const queueItem = state.queue.find(
        (item) => item.envelope.id === action.payload.envelopeId,
      );
      if (!queueItem) {
        return state;
      }

      return {
        ...state,
        messages: updateMessageById(state.messages, queueItem.messageId, (message) => ({
          ...message,
          deliveryState:
            message.deliveryState === "sending" ? "sent" : message.deliveryState,
        })),
      };
    }
    case "set-peers":
      return {
        ...state,
        transportPeers: action.payload.map(normalizePeer),
      };
    case "set-transport-mode":
      return {
        ...state,
        transportMode: action.payload,
        nearbyEnabled:
          action.payload === "nearby-android" ? state.nearbyEnabled : false,
        transportPeers: [],
        transportConnectionState:
          action.payload === "nearby-android"
            ? "permission-required"
            : "disconnected",
        transportError:
          action.payload === "nearby-android"
            ? "Grant nearby permissions and tap Start Nearby."
            : undefined,
      };
    case "set-relay-url":
      return {
        ...state,
        relayServerUrl: action.payload,
      };
    case "set-nearby-enabled":
      return {
        ...state,
        nearbyEnabled: action.payload,
      };
    case "set-nearby-permission-state":
      return {
        ...state,
        nearbyPermissionState: action.payload,
      };
    case "set-transport-connection":
      return {
        ...state,
        transportConnectionState: action.payload.state,
        transportError: action.payload.error,
      };
    case "increment-relay-forwarded":
      return {
        ...state,
        relayStats: {
          forwardedEnvelopeCount: state.relayStats.forwardedEnvelopeCount + 1,
        },
      };
    case "add-outgoing-request":
      return applyFriendUpsert(state, action.payload);
    case "create-invite-placeholder": {
      const existing = state.friends.find(
        (friend) => friend.phoneNumber === action.payload.phoneNumber,
      );
      if (existing) {
        return {
          ...state,
          selectedChatFriendId: existing.id,
        };
      }

      const nextFriend: FriendProfile = {
        id: createId("invite"),
        phoneNumber: action.payload.phoneNumber,
        phoneNumberDisplay: formatPhoneNumber(action.payload.phoneNumber),
        displayName: action.payload.displayName,
        publicKey: "",
        encryptionPublicKey: "",
        chatStatus: "invitable-unregistered",
        lastSeenAt: new Date().toISOString(),
      };
      const friends = upsertFriend(state.friends, nextFriend);
      return {
        ...state,
        friends,
        contacts: matchContacts(state.contacts, friends),
        selectedChatFriendId: nextFriend.id,
      };
    }
    case "receive-friend-request":
      return applyFriendUpsert(state, {
        id: action.payload.envelope.senderId,
        phoneNumber: action.payload.eventPayload.senderPhoneNumber,
        phoneNumberDisplay: action.payload.eventPayload.senderPhoneNumberDisplay,
        displayName: action.payload.eventPayload.senderLabel,
        publicKey: action.payload.envelope.senderPublicKey,
        encryptionPublicKey: action.payload.eventPayload.encryptionPublicKey,
        chatStatus: "incoming-pending",
        lastSeenAt: action.payload.eventPayload.sentAt,
        requestedAt: action.payload.eventPayload.sentAt,
      });
    case "approve-friend-local": {
      const friends = state.friends.map((friend) =>
        friend.id === action.payload.friendId
          ? {
              ...friend,
              chatStatus: "accepted" as const,
              approvedAt: action.payload.approvedAt,
              lastSeenAt: action.payload.approvedAt,
            }
          : friend,
      );

      return {
        ...state,
        friends,
        contacts: matchContacts(state.contacts, friends),
        selectedChatFriendId: action.payload.friendId,
      };
    }
    case "decline-friend-local": {
      const friends = state.friends.map((friend) =>
        friend.id === action.payload.friendId
          ? {
              ...friend,
              chatStatus: "declined" as const,
            }
          : friend,
      );

      return {
        ...state,
        friends,
        contacts: matchContacts(state.contacts, friends),
      };
    }
    case "receive-friend-approval":
      return applyFriendUpsert(state, {
        id: action.payload.envelope.senderId,
        phoneNumber: action.payload.eventPayload.senderPhoneNumber,
        phoneNumberDisplay: action.payload.eventPayload.senderPhoneNumberDisplay,
        displayName: action.payload.eventPayload.senderLabel,
        publicKey: action.payload.envelope.senderPublicKey,
        encryptionPublicKey: action.payload.eventPayload.encryptionPublicKey,
        chatStatus: "accepted",
        lastSeenAt: action.payload.eventPayload.sentAt,
        approvedAt: action.payload.eventPayload.sentAt,
      });
    case "receive-chat": {
      const currentUserId = state.user?.id ?? "";
      const conversationId = conversationIdFor(
        action.payload.envelope.senderId,
        currentUserId,
      );
      const message: ChatMessage = {
        id: action.payload.eventPayload.messageId,
        kind: "chat",
        senderId: action.payload.envelope.senderId,
        senderLabel: action.payload.eventPayload.senderLabel,
        eventId: action.payload.envelope.eventId,
        conversationId,
        messageId: action.payload.eventPayload.messageId,
        recipientIds: action.payload.envelope.recipientIds,
        ciphertext: action.payload.envelope.ciphertext,
        plaintextPreview: action.payload.eventPayload.body,
        createdAt: action.payload.eventPayload.sentAt,
        unread: state.selectedChatFriendId !== action.payload.envelope.senderId,
        deliveryState: "delivered",
        deliveredAt: action.payload.eventPayload.sentAt,
        hopCount: action.payload.envelope.hopCount,
      };

      return {
        ...state,
        messages: mergeMessages(state.messages, message),
      };
    }
    case "apply-delivery-receipt":
      return {
        ...state,
        messages: updateMessageById(
          state.messages,
          action.payload.eventPayload.messageId,
          (message) => {
            const deliveredAt =
              message.deliveredAt &&
              message.deliveredAt > action.payload.eventPayload.deliveredAt
                ? message.deliveredAt
                : action.payload.eventPayload.deliveredAt;
            return {
              ...message,
              deliveredAt,
              deliveryState: computeDeliveryState({
                deliveredAt,
                readAt: message.readAt,
              }),
            };
          },
        ),
        queue: state.queue.filter(
          (item) => item.messageId !== action.payload.eventPayload.messageId,
        ),
      };
    case "apply-read-receipt":
      return {
        ...state,
        messages: updateMessageById(
          state.messages,
          action.payload.eventPayload.messageId,
          (message) => {
            const readAt =
              message.readAt && message.readAt > action.payload.eventPayload.readAt
                ? message.readAt
                : action.payload.eventPayload.readAt;
            return {
              ...message,
              readAt,
              deliveredAt: message.deliveredAt ?? action.payload.eventPayload.readAt,
              deliveryState: "read",
            };
          },
        ),
      };
    case "merge-sync-state": {
      const currentUserId = state.user?.id;
      if (!currentUserId) {
        return state;
      }

      const mergedMessages = action.payload.eventPayload.messages.reduce(
        (acc, item) =>
          mergeMessages(acc, {
            id: item.messageId,
            kind: "chat",
            senderId: item.senderId,
            senderLabel: item.senderLabel,
            eventId: state.event?.id ?? "event",
            conversationId: action.payload.eventPayload.conversationId,
            messageId: item.messageId,
            recipientIds:
              item.senderId === currentUserId
                ? [action.payload.friendId]
                : [currentUserId],
            ciphertext: "",
            plaintextPreview: item.body,
            createdAt: item.sentAt,
            deliveredAt: item.deliveredAt,
            readAt: item.readAt,
            unread:
              item.senderId !== currentUserId &&
              !item.readAt &&
              state.selectedChatFriendId !== action.payload.friendId,
            deliveryState: computeDeliveryState({
              deliveredAt: item.deliveredAt,
              readAt: item.readAt,
            }),
            hopCount: 0,
          }),
        state.messages,
      );

      return {
        ...state,
        messages: mergedMessages,
      };
    }
    case "mark-conversation-read":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.conversationId ===
            conversationIdFor(state.user?.id ?? "", action.payload.friendId) &&
          message.senderId === action.payload.friendId
            ? {
                ...message,
                unread: false,
                readAt: message.readAt ?? action.payload.readAt,
                deliveredAt: message.deliveredAt ?? action.payload.readAt,
                deliveryState: computeDeliveryState({
                  deliveredAt: message.deliveredAt ?? action.payload.readAt,
                  readAt: message.readAt ?? action.payload.readAt,
                }),
              }
            : message,
        ),
      };
    case "set-selected-chat-friend":
      return {
        ...state,
        selectedChatFriendId: action.payload,
      };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  bootstrapIdentity: (phoneNumber: string, displayName?: string) => void;
  syncContacts: () => Promise<void>;
  sendChatRequest: (phoneNumber: string, displayName?: string) => Promise<void>;
  approveFriendRequest: (friendId: string) => Promise<void>;
  declineFriendRequest: (friendId: string) => void;
  sendChatMessage: (friendId: string, text: string) => Promise<void>;
  setSelectedChatFriend: (friendId?: string) => Promise<void>;
  setTransportMode: (mode: TransportMode) => void;
  setRelayServerUrl: (url: string) => void;
  startNearbyTransport: () => Promise<void>;
  stopNearbyTransport: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function createTransport(mode: TransportMode): MeshTransport {
  if (mode === "nearby-android") {
    return new AndroidNearbyTransport();
  }

  if (mode === "relay-server") {
    return new WebSocketRelayTransport();
  }

  return new DemoCompositeMeshTransport();
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState);
  const transportRef = useRef<MeshTransport>(createTransport("demo"));
  const stateRef = useRef(state);
  const syncSentAtRef = useRef<Record<string, number>>({});
  const queueAttemptedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!value) {
          return;
        }

        dispatch({
          type: "hydrated",
          payload: mergeHydratedState(createSeedState(), JSON.parse(value)),
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!state.user || !state.event) {
      return;
    }

    if (state.transportMode === "nearby-android" && !state.nearbyEnabled) {
      dispatch({
        type: "set-transport-connection",
        payload: {
          state: "permission-required",
          error: "Grant nearby permissions and tap Start Nearby.",
        },
      });
      return;
    }

    const transport = createTransport(state.transportMode);
    transportRef.current = transport;

    const unsubscribeEnvelope = transport.onEnvelope((envelope) => {
      const currentState = stateRef.current;
      if (!currentState.user || !currentState.event) {
        return;
      }

      if (!verifyEnvelopeSignature(envelope, envelope.senderPublicKey)) {
        return;
      }

      if (currentState.seenEnvelopeIds.includes(envelope.id)) {
        return;
      }

      dispatch({
        type: "mark-seen-envelope",
        payload: { envelopeId: envelope.id },
      });

      if (!isEnvelopeForCurrentUser(envelope, currentState.user.id)) {
        if (envelope.ttl > 0) {
          transportRef.current
            .send(forwardRelayEnvelope(envelope))
            .then(() => {
              dispatch({ type: "increment-relay-forwarded" });
            })
            .catch(() => undefined);
        }
        return;
      }

      try {
        const plaintext =
          envelope.encryptionMode === "event-shared"
            ? decryptWithEventSharedKey(
                envelope.ciphertext,
                envelope.nonce,
                currentState.event.sharedKey,
              )
            : decryptFromSender(
                envelope.ciphertext,
                envelope.nonce,
                envelope.senderEncryptionPublicKey,
                currentState.user.encryptionSecretKey,
              );

        const eventPayload = JSON.parse(plaintext) as EventPayload;

        if (eventPayload.kind === "friend-request") {
          dispatch({
            type: "receive-friend-request",
            payload: { envelope, eventPayload },
          });
          return;
        }

        if (eventPayload.kind === "friend-approval") {
          dispatch({
            type: "receive-friend-approval",
            payload: { envelope, eventPayload },
          });
          return;
        }

        if (eventPayload.kind === "chat") {
          dispatch({
            type: "receive-chat",
            payload: { envelope, eventPayload },
          });

          const friend = currentState.friends.find((item) => item.id === envelope.senderId);
          if (friend?.encryptionPublicKey) {
            const sentAt = new Date().toISOString();
            const receiptPayload = buildPayload(currentState.user, {
              kind: "delivery-receipt",
              sentAt,
              messageId: eventPayload.messageId,
              deliveredAt: sentAt,
            });
            const receiptEnvelope = createDirectRelayEnvelope(
              JSON.stringify(receiptPayload),
              currentState.user,
              currentState.event,
              [friend.id],
              friend.encryptionPublicKey,
            );
            dispatch({
              type: "mark-seen-envelope",
              payload: { envelopeId: receiptEnvelope.id },
            });
            transportRef.current.send(receiptEnvelope).catch(() => undefined);
          }
          return;
        }

        if (eventPayload.kind === "delivery-receipt") {
          dispatch({
            type: "apply-delivery-receipt",
            payload: { eventPayload },
          });
          return;
        }

        if (eventPayload.kind === "read-receipt") {
          dispatch({
            type: "apply-read-receipt",
            payload: { eventPayload },
          });
          return;
        }

        if (eventPayload.kind === "sync-state") {
          dispatch({
            type: "merge-sync-state",
            payload: {
              friendId: envelope.senderId,
              eventPayload,
            },
          });
        }
      } catch {
        return;
      }
    });

    const unsubscribePeers = transport.onPeersChanged((peers) => {
      const currentState = stateRef.current;
      dispatch({
        type: "set-peers",
        payload: peers.filter((peer) => peer.id !== currentState.user?.id),
      });
    });

    const unsubscribeConnection = transport.onConnectionStateChanged(
      (connectionState, error) => {
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: connectionState,
            error,
          },
        });
      },
    );

    transport
      .start({
        event: state.event,
        user: state.user,
        relayServerUrl: state.relayServerUrl,
      })
      .catch((error: Error) => {
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "error",
            error: error.message,
          },
        });
      });

    return () => {
      unsubscribeEnvelope();
      unsubscribePeers();
      unsubscribeConnection();
      transport.stop().catch(() => undefined);
    };
  }, [state.event, state.nearbyEnabled, state.relayServerUrl, state.transportMode, state.user]);

  useEffect(() => {
    const currentState = stateRef.current;
    if (!currentState.user || currentState.transportConnectionState !== "connected") {
      return;
    }

    const now = Date.now();
    for (const item of currentState.queue) {
      const lastAttempt = queueAttemptedAtRef.current[item.envelope.id] ?? 0;
      if (now - lastAttempt < 3000) {
        continue;
      }

      queueAttemptedAtRef.current[item.envelope.id] = now;
      transportRef.current
        .send(item.envelope)
        .then(() => {
          dispatch({
            type: "ack-outbound-send",
            payload: { envelopeId: item.envelope.id },
          });
        })
        .catch(() => undefined);
    }
  }, [state.queue, state.transportConnectionState]);

  useEffect(() => {
    const currentState = stateRef.current;
    if (!currentState.user || !currentState.event) {
      return;
    }

    const now = Date.now();
    for (const peer of currentState.transportPeers) {
      const friend = currentState.friends.find(
        (item) =>
          item.id === peer.id &&
          item.chatStatus === "accepted" &&
          item.encryptionPublicKey,
      );
      if (!friend) {
        continue;
      }

      const lastSync = syncSentAtRef.current[friend.id] ?? 0;
      if (now - lastSync < 5000) {
        continue;
      }

      syncSentAtRef.current[friend.id] = now;
      const conversationId = conversationIdFor(currentState.user.id, friend.id);
      const messages = getConversationMessages(
        currentState.messages,
        currentState.user.id,
        friend.id,
      ).map((message) => ({
        messageId: message.messageId,
        senderId: message.senderId,
        senderLabel: message.senderLabel,
        body: message.plaintextPreview,
        sentAt: message.createdAt,
        deliveredAt: message.deliveredAt,
        readAt: message.readAt,
      }));
      const payload = buildPayload(currentState.user, {
        kind: "sync-state",
        sentAt: new Date().toISOString(),
        conversationId,
        messages,
      });
      const envelope = createDirectRelayEnvelope(
        JSON.stringify(payload),
        currentState.user,
        currentState.event,
        [friend.id],
        friend.encryptionPublicKey,
      );
      dispatch({
        type: "mark-seen-envelope",
        payload: { envelopeId: envelope.id },
      });
      transportRef.current.send(envelope).catch(() => undefined);
    }
  }, [state.transportPeers, state.friends, state.messages, state.user, state.event]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      bootstrapIdentity(phoneNumber, displayName) {
        const normalized = normalizePhoneNumber(phoneNumber);
        if (!isLikelyPhoneNumber(normalized)) {
          return;
        }

        dispatch({
          type: "set-user",
          payload: createUserIdentity(normalized, displayName),
        });
      },
      async syncContacts() {
        const permission = await requestContactsPermission();
        dispatch({
          type: "set-contacts-permission",
          payload: permission,
        });

        if (permission !== "granted") {
          dispatch({
            type: "set-contacts",
            payload: [],
          });
          return;
        }

        const contacts = await loadDeviceContacts(stateRef.current.friends);
        dispatch({
          type: "set-contacts",
          payload: contacts,
        });
      },
      async sendChatRequest(phoneNumber, displayName) {
        const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
        if (!state.user || !state.event || !isLikelyPhoneNumber(normalizedPhoneNumber)) {
          return;
        }

        const existingFriend = state.friends.find(
          (friend) => friend.phoneNumber === normalizedPhoneNumber,
        );
        const peer = state.transportPeers.find(
          (item) =>
            item.phoneNumber === normalizedPhoneNumber ||
            normalizePhoneNumber(item.alias) === normalizedPhoneNumber,
        );

        if (!peer) {
          dispatch({
            type: "create-invite-placeholder",
            payload: {
              phoneNumber: normalizedPhoneNumber,
              displayName: displayName?.trim() || formatPhoneNumber(normalizedPhoneNumber),
            },
          });
          return;
        }

        const sentAt = new Date().toISOString();
        const payload = buildPayload(state.user, {
          kind: "friend-request",
          sentAt,
        });
        const envelope = createControlRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
          [peer.id],
        );

        dispatch({
          type: "add-outgoing-request",
          payload: {
            id: peer.id,
            phoneNumber: normalizedPhoneNumber,
            phoneNumberDisplay:
              peer.phoneNumberDisplay || formatPhoneNumber(normalizedPhoneNumber),
            displayName:
              existingFriend?.displayName ||
              displayName?.trim() ||
              peer.phoneNumberDisplay ||
              formatPhoneNumber(normalizedPhoneNumber),
            publicKey: existingFriend?.publicKey ?? "",
            encryptionPublicKey: existingFriend?.encryptionPublicKey ?? "",
            chatStatus: "outgoing-pending",
            lastSeenAt: peer.lastSeenAt,
            requestedAt: sentAt,
            approvedAt: existingFriend?.approvedAt,
          },
        });
        dispatch({
          type: "mark-seen-envelope",
          payload: { envelopeId: envelope.id },
        });

        await transportRef.current.send(envelope);
      },
      async approveFriendRequest(friendId) {
        const friend = state.friends.find((item) => item.id === friendId);
        if (
          !friend ||
          !state.user ||
          !state.event ||
          !friend.encryptionPublicKey ||
          friend.chatStatus !== "incoming-pending"
        ) {
          return;
        }

        const approvedAt = new Date().toISOString();
        const payload = buildPayload(state.user, {
          kind: "friend-approval",
          sentAt: approvedAt,
        });
        const envelope = createDirectRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
          [friend.id],
          friend.encryptionPublicKey,
        );

        dispatch({
          type: "approve-friend-local",
          payload: { friendId, approvedAt },
        });
        dispatch({
          type: "mark-seen-envelope",
          payload: { envelopeId: envelope.id },
        });

        await transportRef.current.send(envelope);
      },
      declineFriendRequest(friendId) {
        dispatch({
          type: "decline-friend-local",
          payload: { friendId },
        });
      },
      async sendChatMessage(friendId, text) {
        const friend = state.friends.find((item) => item.id === friendId);
        if (
          !state.user ||
          !state.event ||
          !text.trim() ||
          !friend ||
          friend.chatStatus !== "accepted" ||
          !friend.encryptionPublicKey
        ) {
          return;
        }

        const messageId = createId("chat");
        const sentAt = new Date().toISOString();
        const payload = buildPayload(state.user, {
          kind: "chat",
          sentAt,
          body: text.trim(),
          messageId,
        });
        const envelope = createDirectRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
          [friend.id],
          friend.encryptionPublicKey,
        );

        dispatch({
          type: "queue-chat-envelope",
          payload: {
            envelope,
            messageId,
            conversationId: conversationIdFor(state.user.id, friend.id),
            preview: text.trim(),
          },
        });

        try {
          await transportRef.current.send(envelope);
          dispatch({
            type: "ack-outbound-send",
            payload: { envelopeId: envelope.id },
          });
        } catch {
          return;
        }
      },
      async setSelectedChatFriend(friendId) {
        dispatch({
          type: "set-selected-chat-friend",
          payload: friendId,
        });

        if (!friendId || !state.user || !state.event) {
          return;
        }

        const friend = state.friends.find(
          (item) => item.id === friendId && item.encryptionPublicKey,
        );
        if (!friend) {
          return;
        }

        const unreadMessages = getConversationMessages(
          state.messages,
          state.user.id,
          friendId,
        ).filter((message) => message.senderId === friendId && message.unread);

        if (unreadMessages.length === 0) {
          return;
        }

        const readAt = new Date().toISOString();
        dispatch({
          type: "mark-conversation-read",
          payload: { friendId, readAt },
        });

        for (const message of unreadMessages) {
          const payload = buildPayload(state.user, {
            kind: "read-receipt",
            sentAt: readAt,
            messageId: message.messageId,
            readAt,
          });
          const envelope = createDirectRelayEnvelope(
            JSON.stringify(payload),
            state.user,
            state.event,
            [friend.id],
            friend.encryptionPublicKey,
          );
          dispatch({
            type: "mark-seen-envelope",
            payload: { envelopeId: envelope.id },
          });
          transportRef.current.send(envelope).catch(() => undefined);
        }
      },
      setTransportMode(mode) {
        dispatch({
          type: "set-transport-mode",
          payload: mode,
        });
      },
      setRelayServerUrl(url) {
        dispatch({
          type: "set-relay-url",
          payload: url,
        });
      },
      async startNearbyTransport() {
        const result = await requestNearbyPermissions();

        dispatch({
          type: "set-nearby-permission-state",
          payload: result.state,
        });

        if (!result.granted) {
          dispatch({
            type: "set-transport-connection",
            payload: {
              state: "permission-required",
              error: "Nearby permissions are required before scanning can start.",
            },
          });
          return;
        }

        dispatch({
          type: "set-nearby-enabled",
          payload: true,
        });
      },
      async stopNearbyTransport() {
        dispatch({
          type: "set-nearby-enabled",
          payload: false,
        });
        dispatch({
          type: "set-peers",
          payload: [],
        });
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "permission-required",
            error: "Grant nearby permissions and tap Start Nearby.",
          },
        });
      },
    }),
    [state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
