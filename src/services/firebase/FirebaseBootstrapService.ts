import functions from "@react-native-firebase/functions";
import firestore from "@react-native-firebase/firestore";

import type { UserIdentity } from "../../types/domain";
import { normalizePhoneNumber } from "../../utils/phone";

type LookupUserResponse = {
  found: boolean;
  user?: {
    uid: string;
    displayName: string;
    phoneNumber: string;
    phoneNumberDisplay: string;
    publicKey?: string;
    encryptionPublicKey?: string;
  };
};

type CreateFriendRequestResponse = {
  requestId?: string;
};

export type PendingFirebaseFriendRequest = {
  id: string;
  fromUid: string;
  toUid: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

export type FirebaseUserProfile = {
  uid: string;
  phoneNumber: string;
  phoneNumberDisplay: string;
  displayName: string;
  publicKey?: string;
  encryptionPublicKey?: string;
};

export async function upsertFirebaseUserProfile(user: UserIdentity) {
  await functions().httpsCallable("upsertUserProfile")({
    phoneNumber: user.phoneNumber,
    phoneNumberDisplay: user.phoneNumberDisplay,
    displayName: user.displayName,
    publicKey: user.publicKey,
    encryptionPublicKey: user.encryptionPublicKey,
  });
}

export async function lookupFirebaseUserByPhone(phoneNumber: string) {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) {
    return undefined;
  }

  const response = await functions().httpsCallable("lookupUserByPhone")({
    phoneNumber: normalizedPhoneNumber,
  }) as { data: LookupUserResponse };

  return response.data?.found ? response.data.user : undefined;
}

export async function createFirebaseFriendRequest(targetUid: string) {
  const response = await functions().httpsCallable("createFriendRequest")({
    targetUid,
  }) as { data: CreateFriendRequestResponse };

  return response.data?.requestId as string | undefined;
}

export async function respondToFirebaseFriendRequest(
  requestId: string,
  action: "accept" | "decline",
) {
  await functions().httpsCallable("respondToFriendRequest")({
    requestId,
    action,
  });
}

export async function loadPendingFirebaseFriendRequests(currentUid: string) {
  const snapshot = await firestore()
    .collection("friendRequests")
    .where("toUid", "==", currentUid)
    .where("status", "==", "pending")
    .orderBy("updatedAt", "desc")
    .get();

  return snapshot.docs.map(
    (doc) =>
      ({
        id: doc.id,
        ...(doc.data() as Omit<PendingFirebaseFriendRequest, "id">),
      }) satisfies PendingFirebaseFriendRequest,
  );
}

export async function loadFirebaseUsersByIds(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const snapshots = await Promise.all(
    uniqueUserIds.map((userId) => firestore().collection("users").doc(userId).get()),
  );

  return snapshots
    .filter((snapshot) => snapshot.exists)
    .map(
      (snapshot) =>
        ({
          uid: snapshot.id,
          ...(snapshot.data() as Omit<FirebaseUserProfile, "uid">),
        }) satisfies FirebaseUserProfile,
    );
}
