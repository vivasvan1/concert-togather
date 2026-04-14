import auth, { FirebaseAuthTypes } from "@react-native-firebase/auth";

export type PhoneConfirmationResult = FirebaseAuthTypes.ConfirmationResult;

export function getFirebaseAuth() {
  return auth();
}

export function observeFirebaseAuthState(
  listener: (user: FirebaseAuthTypes.User | null) => void,
) {
  return auth().onAuthStateChanged(listener);
}

export async function requestPhoneOtp(phoneNumber: string) {
  return auth().signInWithPhoneNumber(phoneNumber);
}

export async function confirmPhoneOtp(
  confirmation: PhoneConfirmationResult,
  code: string,
) {
  return confirmation.confirm(code);
}

export async function signOutFirebaseUser() {
  await auth().signOut();
}
