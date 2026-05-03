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

export async function syncContactsToBackend(phoneNumbers: string[]) {
  const response = await functions().httpsCallable("syncContacts")({
    phoneNumbers,
  }) as { data: { users: FirebaseUserProfile[] } };

  return response.data?.users || [];
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
