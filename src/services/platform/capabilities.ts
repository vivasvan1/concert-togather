import { Platform } from "react-native";

import type { MeshCapability } from "../../types/domain";
import { isConcertNearbyMeshAvailable } from "../mesh/ConcertNearbyMeshModule";

export function getPlatformCapabilities(): MeshCapability[] {
  const isAndroid = Platform.OS === "android";

  return [
    {
      kind: "nearby",
      label: "Direct nearby mesh",
      available: isAndroid && isConcertNearbyMeshAvailable(),
      canRelayInBackground: false,
      note: isAndroid
        ? "Android APK/dev build only. Uses native nearby discovery without a relay server."
        : "Unavailable on iOS in the current implementation.",
    },
    {
      kind: "bluetooth",
      label: "Bluetooth relay",
      available: true,
      canRelayInBackground: isAndroid,
      note: isAndroid
        ? "Primary nearby transport for dense crowds."
        : "Available, but practical background relay is limited on iOS.",
    },
    {
      kind: "wifi-direct",
      label: "Wi-Fi direct",
      available: isAndroid,
      canRelayInBackground: isAndroid,
      note: isAndroid
        ? "Higher-bandwidth peer channel on Android."
        : "Unavailable as a first-class transport on iOS.",
    },
    {
      kind: "internet-fallback",
      label: "Internet assist",
      available: true,
      canRelayInBackground: true,
      note: "Optional bootstrap and catch-up path when service returns.",
    },
  ];
}
