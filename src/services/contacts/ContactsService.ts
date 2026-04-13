import * as ExpoContacts from "expo-contacts";

import type { ContactsPermissionState, DeviceContact, FriendProfile } from "../../types/domain";
import { formatPhoneNumber, normalizePhoneNumber } from "../../utils/phone";

export async function requestContactsPermission(): Promise<ContactsPermissionState> {
  const existing = await ExpoContacts.getPermissionsAsync();
  if (existing.status === "granted") {
    return "granted";
  }

  const requested = await ExpoContacts.requestPermissionsAsync();
  return requested.status === "granted" ? "granted" : "denied";
}

export async function loadDeviceContacts(
  friends: FriendProfile[],
): Promise<DeviceContact[]> {
  const permission = await requestContactsPermission();
  if (permission !== "granted") {
    return [];
  }

  const response = await ExpoContacts.getContactsAsync({
    fields: [ExpoContacts.Fields.PhoneNumbers],
    sort: ExpoContacts.SortTypes.FirstName,
  });

  const seen = new Set<string>();
  const contacts: DeviceContact[] = [];

  for (const contact of response.data) {
    const label = contact.name?.trim() || "Unknown contact";
    for (const phone of contact.phoneNumbers ?? []) {
      const normalized = normalizePhoneNumber(phone.number ?? "");
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      const matchedFriend = friends.find((friend) => friend.phoneNumber === normalized);
      contacts.push({
        id: `${contact.id}:${normalized}`,
        displayName: label,
        phoneNumber: normalized,
        phoneNumberDisplay: formatPhoneNumber(normalized),
        matchStatus: matchedFriend ? "matched" : "invite",
        matchedFriendId: matchedFriend?.id,
      });
    }
  }

  return contacts.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
