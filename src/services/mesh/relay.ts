import type { EventRecord, RelayEnvelope, UserIdentity } from "../../types/domain";

import {
  encryptForRecipient,
  encryptWithEventSharedKey,
  signEnvelopePayload,
} from "../crypto/CryptoService";
import { createId } from "../../utils/ids";

const MAX_TTL = 6;

export function createDirectRelayEnvelope(
  payload: string,
  user: UserIdentity,
  event: EventRecord,
  recipientIds: string[],
  recipientEncryptionPublicKey: string,
): RelayEnvelope {
  const { ciphertext, nonce } = encryptForRecipient(
    payload,
    recipientEncryptionPublicKey,
    user.encryptionSecretKey,
  );
  const createdAt = new Date().toISOString();
  const envelope = {
    id: createId("env"),
    eventId: event.id,
    senderId: user.id,
    senderPublicKey: user.publicKey,
    senderEncryptionPublicKey: user.encryptionPublicKey,
    recipientScope: "direct" as const,
    encryptionMode: "direct" as const,
    recipientIds,
    ciphertext,
    nonce,
    hopCount: 0,
    ttl: MAX_TTL,
    dedupeKey: createId("dedupe"),
    createdAt,
  };

  return {
    ...envelope,
    signature: signEnvelopePayload(envelope, user.secretKey),
  };
}

export function createControlRelayEnvelope(
  payload: string,
  user: UserIdentity,
  event: EventRecord,
  recipientIds: string[],
): RelayEnvelope {
  const { ciphertext, nonce } = encryptWithEventSharedKey(payload, event.sharedKey);
  const createdAt = new Date().toISOString();
  const envelope = {
    id: createId("env"),
    eventId: event.id,
    senderId: user.id,
    senderPublicKey: user.publicKey,
    senderEncryptionPublicKey: user.encryptionPublicKey,
    recipientScope: "direct" as const,
    encryptionMode: "event-shared" as const,
    recipientIds,
    ciphertext,
    nonce,
    hopCount: 0,
    ttl: MAX_TTL,
    dedupeKey: createId("dedupe"),
    createdAt,
  };

  return {
    ...envelope,
    signature: signEnvelopePayload(envelope, user.secretKey),
  };
}

export function forwardRelayEnvelope(envelope: RelayEnvelope): RelayEnvelope {
  return {
    ...envelope,
    hopCount: envelope.hopCount + 1,
    ttl: Math.max(0, envelope.ttl - 1),
  };
}
