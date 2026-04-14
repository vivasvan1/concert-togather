import type { UserIdentity } from "../../types/domain";
import { normalizePhoneNumber } from "../../utils/phone";

type RegisteredUser = {
  userId: string;
  phoneNumber: string;
  phoneNumberDisplay: string;
  displayName: string;
  publicKey: string;
  encryptionPublicKey: string;
};

function toHttpUrl(relayServerUrl: string) {
  const trimmed = relayServerUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice(5)}`;
  }

  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice(6)}`;
  }

  return trimmed;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Backend request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function registerBackendUser(
  relayServerUrl: string,
  user: UserIdentity,
): Promise<RegisteredUser | undefined> {
  const baseUrl = toHttpUrl(relayServerUrl);
  if (!baseUrl) {
    return undefined;
  }

  return postJson<RegisteredUser>(`${baseUrl}/users/register`, {
    userId: user.id,
    phoneNumber: user.phoneNumber,
    phoneNumberDisplay: user.phoneNumberDisplay,
    displayName: user.displayName,
    publicKey: user.publicKey,
    encryptionPublicKey: user.encryptionPublicKey,
  });
}

export async function lookupBackendUserByPhone(
  relayServerUrl: string,
  phoneNumber: string,
): Promise<RegisteredUser | undefined> {
  const baseUrl = toHttpUrl(relayServerUrl);
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  if (!baseUrl || !normalizedPhoneNumber) {
    return undefined;
  }

  const response = await fetch(`${baseUrl}/users/lookup-by-phone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumber: normalizedPhoneNumber,
    }),
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Backend lookup failed with ${response.status}`);
  }

  return (await response.json()) as RegisteredUser;
}
