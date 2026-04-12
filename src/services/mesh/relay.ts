import type { EventRecord, RelayEnvelope, UserIdentity } from "../../types/domain";

import { encryptPayload, signEnvelopePayload } from "../crypto/CryptoService";
import { createId } from "../../utils/ids";

const MAX_TTL = 4;

export function createRelayEnvelope(payload: string, user: UserIdentity, event: EventRecord): RelayEnvelope {
  // The envelope is the transport-level unit that moves through the mesh.
  const { ciphertext, nonce } = encryptPayload(payload, event.sharedKey);
  const createdAt = new Date().toISOString();
  const envelope = {
    id: createId("env"),
    eventId: event.id,
    senderId: user.id,
    senderPublicKey: user.publicKey,
    recipientScope: "event-group" as const,
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
