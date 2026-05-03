import { describe, expect, it } from "bun:test";

import { createSeedState } from "../data/mockData";
import type { AppState, EventPayload, FriendProfile, RelayEnvelope, UserIdentity } from "../types/domain";
import { createReadReceiptForOpenIncomingChat } from "./readReceipts";

const user: UserIdentity = {
  id: "user-1",
  phoneNumber: "+919876543210",
  phoneNumberDisplay: "+91 987 654 3210",
  displayName: "You",
  publicKey: "user-public",
  secretKey: "user-secret",
  encryptionPublicKey: "user-encryption-public",
  encryptionSecretKey: "user-encryption-secret",
};

const friend: FriendProfile = {
  id: "friend-1",
  phoneNumber: "+14155552671",
  phoneNumberDisplay: "+1 415 555 2671",
  displayName: "Sam",
  publicKey: "friend-public",
  encryptionPublicKey: "friend-encryption-public",
  chatStatus: "accepted",
  lastSeenAt: "2026-05-01T09:00:00.000Z",
};

const incomingEnvelope: RelayEnvelope = {
  id: "env-chat-1",
  eventId: "event-headliner-2026",
  senderId: friend.id,
  senderPublicKey: friend.publicKey,
  senderEncryptionPublicKey: friend.encryptionPublicKey,
  recipientScope: "direct",
  encryptionMode: "direct",
  recipientIds: [user.id],
  ciphertext: "ciphertext",
  signature: "signature",
  nonce: "nonce",
  hopCount: 0,
  ttl: 6,
  dedupeKey: "dedupe-chat-1",
  createdAt: "2026-05-01T09:05:00.000Z",
};

const incomingChat: Extract<EventPayload, { kind: "chat" }> = {
  kind: "chat",
  messageId: "chat-1",
  body: "meet at north gate",
  senderPhoneNumber: friend.phoneNumber,
  senderPhoneNumberDisplay: friend.phoneNumberDisplay,
  senderLabel: friend.displayName,
  sentAt: "2026-05-01T09:05:00.000Z",
};

function openChatState(): AppState {
  return {
    ...createSeedState(),
    user,
    friends: [friend],
    selectedChatFriendId: friend.id,
  };
}

describe("read receipts for visible chats", () => {
  it("creates a read receipt when a new message arrives in the already-open chat", () => {
    const receipt = createReadReceiptForOpenIncomingChat({
      state: openChatState(),
      envelope: incomingEnvelope,
      eventPayload: incomingChat,
      readAt: "2026-05-01T09:05:01.000Z",
      createEnvelope: (payload, recipient) => ({
        ...incomingEnvelope,
        id: "env-read-1",
        senderId: user.id,
        recipientIds: [recipient.id],
        encryptionMode: "direct",
        ciphertext: JSON.stringify(payload),
      }),
    });

    expect(receipt).toEqual({
      friendId: friend.id,
      messageId: incomingChat.messageId,
      readAt: "2026-05-01T09:05:01.000Z",
      envelope: {
        ...incomingEnvelope,
        id: "env-read-1",
        senderId: user.id,
        recipientIds: [friend.id],
        encryptionMode: "direct",
        ciphertext: JSON.stringify({
          kind: "read-receipt",
          senderPhoneNumber: user.phoneNumber,
          senderPhoneNumberDisplay: user.phoneNumberDisplay,
          senderLabel: user.displayName,
          messageId: incomingChat.messageId,
          sentAt: "2026-05-01T09:05:01.000Z",
          readAt: "2026-05-01T09:05:01.000Z",
        }),
      },
    });
  });

  it("does not create a read receipt when the incoming chat is not visible", () => {
    const receipt = createReadReceiptForOpenIncomingChat({
      state: {
        ...openChatState(),
        selectedChatFriendId: undefined,
      },
      envelope: incomingEnvelope,
      eventPayload: incomingChat,
      readAt: "2026-05-01T09:05:01.000Z",
      createEnvelope: () => {
        throw new Error("should not create an envelope");
      },
    });

    expect(receipt).toBeUndefined();
  });
});
