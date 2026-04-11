import nacl from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";

import type { RelayEnvelope, UserIdentity } from "../../types/domain";

import { createId } from "../../utils/ids";

export function createUserIdentity(handle: string): UserIdentity {
  const keyPair = nacl.sign.keyPair();

  return {
    id: createId("user"),
    handle,
    displayName: handle,
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

export function createEventSharedKey() {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export function encryptPayload(message: string, sharedKey: string) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = decodeBase64(sharedKey);
  const box = nacl.secretbox(decodeUTF8(message), nonce, key);

  return {
    ciphertext: encodeBase64(box),
    nonce: encodeBase64(nonce),
  };
}

export function decryptPayload(ciphertext: string, nonce: string, sharedKey: string) {
  const opened = nacl.secretbox.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    decodeBase64(sharedKey),
  );

  if (!opened) {
    throw new Error("Unable to decrypt payload");
  }

  return encodeUTF8(opened);
}

export function signEnvelopePayload(
  envelope: Pick<RelayEnvelope, "ciphertext" | "nonce" | "dedupeKey" | "eventId" | "createdAt" | "senderId" | "senderPublicKey">,
  secretKey: string,
) {
  const payload = `${envelope.eventId}:${envelope.senderId}:${envelope.senderPublicKey}:${envelope.dedupeKey}:${envelope.nonce}:${envelope.ciphertext}:${envelope.createdAt}`;
  const signature = nacl.sign.detached(decodeUTF8(payload), decodeBase64(secretKey));

  return encodeBase64(signature);
}

export function verifyEnvelopeSignature(
  envelope: Pick<RelayEnvelope, "ciphertext" | "nonce" | "dedupeKey" | "eventId" | "createdAt" | "signature" | "senderId" | "senderPublicKey">,
  publicKey: string,
) {
  const payload = `${envelope.eventId}:${envelope.senderId}:${envelope.senderPublicKey}:${envelope.dedupeKey}:${envelope.nonce}:${envelope.ciphertext}:${envelope.createdAt}`;
  return nacl.sign.detached.verify(
    decodeUTF8(payload),
    decodeBase64(envelope.signature),
    decodeBase64(publicKey),
  );
}
