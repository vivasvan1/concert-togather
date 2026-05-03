import { signEnvelopePayload } from "../crypto/CryptoService";
import type { EventRecord, RelayEnvelope, UserIdentity } from "../../types/domain";
import { createId } from "../../utils/ids";
import { MAX_TTL } from "./relay";
import { RELAY_ACK_TTL_MS } from "./relayConfig";

export function createRelayAckEnvelope(
  originalDedupeKey: string,
  user: UserIdentity,
  event: EventRecord,
): RelayEnvelope {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const relayAckExpiresAt = new Date(now + RELAY_ACK_TTL_MS).toISOString();

  const envelope = {
    id: createId("env"),
    eventId: event.id,
    senderId: user.id,
    senderPublicKey: user.publicKey,
    senderEncryptionPublicKey: user.encryptionPublicKey,
    recipientScope: "group" as const,
    encryptionMode: "event-shared" as const,
    recipientIds: [],
    ciphertext: "",
    nonce: "",
    hopCount: 0,
    ttl: MAX_TTL,
    dedupeKey: createId("dedupe"),
    createdAt,
    relayAckKey: originalDedupeKey,
    relayAckExpiresAt,
  };

  return {
    ...envelope,
    signature: signEnvelopePayload(envelope, user.secretKey),
  };
}
