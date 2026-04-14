import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions/v2/options";

initializeApp();

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

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

function conversationIdFor(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join(":");
}

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
    return {found: false};
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
    {merge: true},
  );

  return {ok: true};
});

export const createFriendRequest = onCall(async (request) => {
  const uid = requireAuth(request as CallableContext);
  const targetUid = String(request.data?.targetUid ?? "").trim();

  if (!targetUid || targetUid === uid) {
    throw new HttpsError("invalid-argument", "A valid target user is required.");
  }

  const requestRef = db.collection("friendRequests").doc();
  await requestRef.set({
    fromUid: uid,
    toUid: targetUid,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {requestId: requestRef.id};
});

export const respondToFriendRequest = onCall(async (request) => {
  const uid = requireAuth(request as CallableContext);
  const requestId = String(request.data?.requestId ?? "").trim();
  const action = String(request.data?.action ?? "").trim();

  if (!requestId || (action !== "accept" && action !== "decline")) {
    throw new HttpsError("invalid-argument", "A valid request response is required.");
  }

  const requestRef = db.collection("friendRequests").doc(requestId);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) {
    throw new HttpsError("not-found", "Friend request not found.");
  }

  const friendRequest = requestSnap.data()!;
  if (friendRequest.toUid !== uid) {
    throw new HttpsError("permission-denied", "Only the recipient may respond.");
  }

  const nextStatus = action === "accept" ? "accepted" : "declined";
  await requestRef.set(
    {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    },
    {merge: true},
  );

  if (nextStatus === "accepted") {
    const friendshipId = conversationIdFor(friendRequest.fromUid, friendRequest.toUid);
    await db.collection("friendships").doc(friendshipId).set({
      members: [friendRequest.fromUid, friendRequest.toUid],
      createdAt: new Date().toISOString(),
    });
  }

  return {ok: true};
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

  return {groupId: groupRef.id};
});
