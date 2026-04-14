import nacl from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";

import type { RelayEnvelope, UserIdentity } from "../../types/domain";

import { formatPhoneNumber, normalizePhoneNumber } from "../../utils/phone";

export function createUserIdentity(phoneNumber: string, displayName?: string): UserIdentity {
  // For this prototype, a user identity carries one keypair for signatures and
  // one keypair for direct-recipient encryption.
  const signingKeyPair = nacl.sign.keyPair();
  const encryptionKeyPair = nacl.box.keyPair();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const phoneNumberDisplay = formatPhoneNumber(normalizedPhoneNumber);

  return {
    id: normalizedPhoneNumber,
    phoneNumber: normalizedPhoneNumber,
    phoneNumberDisplay,
    displayName: displayName?.trim() || phoneNumberDisplay,
    publicKey: encodeBase64(signingKeyPair.publicKey),
    secretKey: encodeBase64(signingKeyPair.secretKey),
    encryptionPublicKey: encodeBase64(encryptionKeyPair.publicKey),
    encryptionSecretKey: encodeBase64(encryptionKeyPair.secretKey),
  };
}

export function createEventSharedKey() {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export function encryptWithEventSharedKey(message: string, sharedKey: string) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(decodeUTF8(message), nonce, decodeBase64(sharedKey));

  return {
    ciphertext: encodeBase64(box),
    nonce: encodeBase64(nonce),
  };
}

export function decryptWithEventSharedKey(
  ciphertext: string,
  nonce: string,
  sharedKey: string,
) {
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

export function encryptForRecipient(
  message: string,
  recipientEncryptionPublicKey: string,
  senderEncryptionSecretKey: string,
) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    decodeUTF8(message),
    nonce,
    decodeBase64(recipientEncryptionPublicKey),
    decodeBase64(senderEncryptionSecretKey),
  );

  return {
    ciphertext: encodeBase64(box),
    nonce: encodeBase64(nonce),
  };
}

export function decryptFromSender(
  ciphertext: string,
  nonce: string,
  senderEncryptionPublicKey: string,
  recipientEncryptionSecretKey: string,
) {
  const opened = nacl.box.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    decodeBase64(senderEncryptionPublicKey),
    decodeBase64(recipientEncryptionSecretKey),
  );

  if (!opened) {
    throw new Error("Unable to decrypt payload");
  }

  return encodeUTF8(opened);
}

export function signEnvelopePayload(
  envelope: Pick<
    RelayEnvelope,
    | "ciphertext"
    | "nonce"
    | "dedupeKey"
    | "eventId"
    | "createdAt"
    | "senderId"
    | "senderPublicKey"
    | "senderEncryptionPublicKey"
    | "recipientScope"
    | "encryptionMode"
    | "recipientIds"
    | "groupId"
  >,
  secretKey: string,
) {
  // Sign the routing metadata too so relay nodes cannot tamper with who the
  // message is for while keeping the ciphertext intact.
  const payload = [
    envelope.eventId,
    envelope.senderId,
    envelope.senderPublicKey,
    envelope.senderEncryptionPublicKey,
    envelope.recipientScope,
    envelope.encryptionMode,
    envelope.recipientIds.join(","),
    envelope.groupId ?? "",
    envelope.dedupeKey,
    envelope.nonce,
    envelope.ciphertext,
    envelope.createdAt,
  ].join(":");
  const signature = nacl.sign.detached(decodeUTF8(payload), decodeBase64(secretKey));

  return encodeBase64(signature);
}

export function verifyEnvelopeSignature(
  envelope: Pick<
    RelayEnvelope,
    | "ciphertext"
    | "nonce"
    | "dedupeKey"
    | "eventId"
    | "createdAt"
    | "signature"
    | "senderId"
    | "senderPublicKey"
    | "senderEncryptionPublicKey"
    | "recipientScope"
    | "encryptionMode"
    | "recipientIds"
    | "groupId"
  >,
  publicKey: string,
) {
  const payload = [
    envelope.eventId,
    envelope.senderId,
    envelope.senderPublicKey,
    envelope.senderEncryptionPublicKey,
    envelope.recipientScope,
    envelope.encryptionMode,
    envelope.recipientIds.join(","),
    envelope.groupId ?? "",
    envelope.dedupeKey,
    envelope.nonce,
    envelope.ciphertext,
    envelope.createdAt,
  ].join(":");

  return nacl.sign.detached.verify(
    decodeUTF8(payload),
    decodeBase64(envelope.signature),
    decodeBase64(publicKey),
  );
}
