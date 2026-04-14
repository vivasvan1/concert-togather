import { Platform } from "react-native";

import type { MeshCapability } from "../../types/domain";
import { isConcertNearbyMeshAvailable } from "../mesh/ConcertNearbyMeshModule";

export function getPlatformCapabilities(): MeshCapability[] {
  const isAndroid = Platform.OS === "android";
  const isIos = Platform.OS === "ios";

  return [
    {
      kind: "nearby",
      label: "Direct nearby mesh",
      available: isAndroid && isConcertNearbyMeshAvailable(),
      canRelayInBackground: false,
      note: isAndroid
        ? "Android APK/dev build only. Uses native nearby discovery without a relay server."
        : "Not in the iPhone build yet. Use relay or internet assist for now.",
    },
    {
      kind: "bluetooth",
      label: "Bluetooth relay",
      available: isAndroid,
      canRelayInBackground: isAndroid,
      note: isAndroid
        ? "Primary nearby transport for dense crowds."
        : "Planned for a later iPhone nearby transport pass.",
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
      note: isIos
        ? "Primary iPhone transport today. Works with Firebase plus the relay server."
        : "Optional bootstrap and catch-up path when service returns.",
    },
  ];
}
