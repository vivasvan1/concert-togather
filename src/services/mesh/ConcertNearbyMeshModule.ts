import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type ConnectionEvent = {
  state: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
};

type PeersEvent = {
  peers: Array<{
    id: string;
    alias: string;
    lastSeenAt: string;
    via: "nearby";
  }>;
};

type EnvelopeEvent = {
  envelopeJson: string;
};

export type ConcertNearbyMeshNativeModule = {
  isAvailable(): boolean;
  startSession(eventId: string, userId: string, alias: string): Promise<void>;
  stopSession(): Promise<void>;
  sendEnvelope(envelopeJson: string): Promise<void>;
  addListener(
    eventName: "onConnectionStateChanged",
    listener: (event: ConnectionEvent) => void,
  ): { remove(): void };
  addListener(
    eventName: "onPeersChanged",
    listener: (event: PeersEvent) => void,
  ): { remove(): void };
  addListener(
    eventName: "onEnvelope",
    listener: (event: EnvelopeEvent) => void,
  ): { remove(): void };
};

const nativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<ConcertNearbyMeshNativeModule>("ConcertNearbyMesh")
    : null;

export function getConcertNearbyMeshModule() {
  return nativeModule;
}

export function isConcertNearbyMeshAvailable() {
  return Boolean(nativeModule?.isAvailable());
}

