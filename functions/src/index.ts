import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";

initializeApp();

setGlobalOptions({ maxInstances: 10, region: "asia-south1" });

const db = getFirestore();

type CallableContext = {
  auth?: {
    uid: string;
  };
  data: any;
};

function requireAuth(request: CallableContext) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  return request.auth.uid;
}

function normalizePhoneNumber(raw: string) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return `+${digits}`;
}

// function conversationIdFor(leftId: string, rightId: string) {
//   return [leftId, rightId].sort().join(":");
// }

export const lookupUserByPhone = onCall(async (request) => {
  requireAuth(request as CallableContext);
  const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);

  if (!phoneNumber) {
    throw new HttpsError("invalid-argument", "A phone number is required.");
  }

  const snapshot = await db
    .collection("users")
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { found: false };
  }

  const user = snapshot.docs[0].data();
  return {
    found: true,
    user: {
      uid: snapshot.docs[0].id,
      displayName: user.displayName,
      phoneNumber: user.phoneNumber,
      phoneNumberDisplay: user.phoneNumberDisplay,
      publicKey: user.publicKey ?? "",
      encryptionPublicKey: user.encryptionPublicKey ?? "",
    },
  };
});

export const upsertUserProfile = onCall(async (request) => {
  const uid = requireAuth(request as CallableContext);
  const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);

  if (!phoneNumber) {
    throw new HttpsError("invalid-argument", "A phone number is required.");
  }

  const payload = {
    displayName: String(request.data?.displayName ?? "").trim() || phoneNumber,
    phoneNumber,
    phoneNumberDisplay: String(request.data?.phoneNumberDisplay ?? phoneNumber),
    publicKey: String(request.data?.publicKey ?? ""),
    encryptionPublicKey: String(request.data?.encryptionPublicKey ?? ""),
    updatedAt: new Date().toISOString(),
  };

  await db.collection("users").doc(uid).set(
    {
      ...payload,
      createdAt: request.data?.createdAt ?? new Date().toISOString(),
    },
    { merge: true },
  );

  return { ok: true };
});

export const syncContacts = onCall(async (request) => {
  requireAuth(request as CallableContext);
  const phoneNumbers: string[] = request.data?.phoneNumbers || [];

  if (!Array.isArray(phoneNumbers)) {
    throw new HttpsError("invalid-argument", "phoneNumbers must be an array.");
  }

  const normalized = Array.from(new Set(phoneNumbers.map(normalizePhoneNumber).filter(Boolean)));
  if (normalized.length === 0) {
    return { users: [] };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < normalized.length; i += 30) {
    chunks.push(normalized.slice(i, i + 30));
  }

  const users: any[] = [];
  for (const chunk of chunks) {
    const snapshot = await db.collection("users").where("phoneNumber", "in", chunk).get();
    for (const doc of snapshot.docs) {
      const user = doc.data();
      users.push({
        uid: doc.id,
        displayName: user.displayName,
        phoneNumber: user.phoneNumber,
        phoneNumberDisplay: user.phoneNumberDisplay,
        publicKey: user.publicKey ?? "",
        encryptionPublicKey: user.encryptionPublicKey ?? "",
      });
    }
  }

  return { users };
});

export const createEventGroup = onCall(async (request) => {
  const uid = requireAuth(request as CallableContext);
  const name = String(request.data?.name ?? "").trim();
  const eventId = String(request.data?.eventId ?? "").trim();

  if (!name || !eventId) {
    throw new HttpsError("invalid-argument", "Event id and group name are required.");
  }

  const groupRef = db.collection("groups").doc();
  await groupRef.set({
    eventId,
    name,
    ownerUid: uid,
    memberUids: [uid],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { groupId: groupRef.id };
});
