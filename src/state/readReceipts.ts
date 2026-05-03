import type { AppState, EventPayload, FriendProfile, RelayEnvelope } from "../types/domain";

type IncomingChatPayload = Extract<EventPayload, { kind: "chat" }>;
type ReadReceiptPayload = Extract<EventPayload, { kind: "read-receipt" }>;

interface CreateReadReceiptInput {
  state: AppState;
  envelope: RelayEnvelope;
  eventPayload: IncomingChatPayload;
  readAt: string;
  createEnvelope: (payload: ReadReceiptPayload, friend: FriendProfile) => RelayEnvelope;
}

export function createReadReceiptForOpenIncomingChat({
  state,
  envelope,
  eventPayload,
  readAt,
  createEnvelope,
}: CreateReadReceiptInput) {
  if (!state.user || !state.event) {
    return undefined;
  }

  if (state.selectedChatFriendId !== envelope.senderId) {
    return undefined;
  }

  const friend = state.friends.find(
    (item) =>
      item.id === envelope.senderId &&
      item.chatStatus === "accepted" &&
      item.encryptionPublicKey,
  );
  if (!friend) {
    return undefined;
  }

  const payload: ReadReceiptPayload = {
    kind: "read-receipt",
    senderPhoneNumber: state.user.phoneNumber,
    senderPhoneNumberDisplay: state.user.phoneNumberDisplay,
    senderLabel: state.user.displayName,
    messageId: eventPayload.messageId,
    sentAt: readAt,
    readAt,
  };

  return {
    friendId: friend.id,
    messageId: eventPayload.messageId,
    readAt,
    envelope: createEnvelope(payload, friend),
  };
}
