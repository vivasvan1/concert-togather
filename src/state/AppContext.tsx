import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { createSeedState } from "../data/mockData";
import {
  AndroidNearbyTransport,
} from "../services/mesh/AndroidNearbyTransport";
import {
  createUserIdentity,
  decryptPayload,
  verifyEnvelopeSignature,
} from "../services/crypto/CryptoService";
import { DemoCompositeMeshTransport } from "../services/mesh/DemoCompositeMeshTransport";
import type { MeshTransport } from "../services/mesh/Transport";
import { createRelayEnvelope } from "../services/mesh/relay";
import { WebSocketRelayTransport } from "../services/mesh/WebSocketRelayTransport";
import type {
  AppState,
  ChatMessage,
  EventPayload,
  FriendProfile,
  FriendStatus,
  NearbyPermissionState,
  PeerLocationHint,
  RelayEnvelope,
  TransportConnectionState,
  TransportMode,
  UserIdentity,
} from "../types/domain";
import { createId } from "../utils/ids";

const STORAGE_KEY = "concert-togather/app-state-v2";
type AndroidPermissionValue =
  (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];

type AppAction =
  | { type: "hydrated"; payload: AppState }
  | { type: "set-user"; payload: UserIdentity }
  | { type: "add-friend-from-peer"; payload: AppState["transportPeers"][number] }
  | { type: "set-meetup"; payload: string }
  | { type: "set-location"; payload: PeerLocationHint }
  | { type: "queue-envelope"; payload: { envelope: RelayEnvelope; preview: string } }
  | { type: "confirm-envelope"; payload: { envelopeId: string } }
  | { type: "set-peers"; payload: AppState["transportPeers"] }
  | { type: "set-transport-mode"; payload: TransportMode }
  | { type: "set-relay-url"; payload: string }
  | { type: "set-nearby-enabled"; payload: boolean }
  | { type: "set-nearby-permission-state"; payload: NearbyPermissionState }
  | {
      type: "set-transport-connection";
      payload: { state: TransportConnectionState; error?: string };
    }
  | {
      type: "apply-remote-payload";
      payload: { envelope: RelayEnvelope; eventPayload: EventPayload };
    };

function upsertFriend(
  friends: FriendProfile[],
  payload: EventPayload,
  envelope: RelayEnvelope,
) {
  // Unknown senders do not become friends automatically; the UI only updates contacts
  // the user already accepted from the nearby list.
  const existing = friends.find((friend) => friend.id === envelope.senderId);
  const nextFriend: FriendProfile = {
    id: envelope.senderId,
    handle: payload.senderHandle,
    displayName: payload.senderLabel,
    publicKey: envelope.senderPublicKey,
    status: payload.status ?? existing?.status ?? "moving",
    lastSeenAt: payload.sentAt,
  };

  if (!existing) {
    return friends;
  }

  return friends.map((friend) =>
    friend.id === envelope.senderId ? nextFriend : friend,
  );
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "hydrated":
      return action.payload;
    case "set-user":
      return {
        ...state,
        user: action.payload,
      };
    case "add-friend-from-peer":
      if (state.friends.some((friend) => friend.id === action.payload.id)) {
        return state;
      }

      return {
        ...state,
        friends: [
          {
            id: action.payload.id,
            handle: action.payload.alias.startsWith("@")
              ? action.payload.alias
              : `@${action.payload.alias}`,
            displayName: action.payload.alias.replace(/^@/, ""),
            publicKey: "",
            status: "moving",
            lastSeenAt: action.payload.lastSeenAt,
          },
          ...state.friends,
        ],
      };
    case "set-meetup":
      return {
        ...state,
        activeMeetupSpot: action.payload,
      };
    case "set-location":
      return {
        ...state,
        locationHints: {
          ...state.locationHints,
          [action.payload.friendId]: action.payload,
        },
      };
    case "queue-envelope": {
      // Outbound messages appear immediately and stay queued until a transport
      // echoes them back or the app reconnects later.
      const message: ChatMessage = {
        id: createId("msg"),
        senderId: state.user?.id ?? "unknown",
        senderLabel: state.user?.displayName ?? "You",
        eventId: state.event?.id ?? "event",
        ciphertext: action.payload.envelope.ciphertext,
        plaintextPreview: action.payload.preview,
        createdAt: action.payload.envelope.createdAt,
        deliveryState: "local",
        hopCount: 0,
      };

      return {
        ...state,
        messages: [message, ...state.messages],
        queue: [
          {
            messageId: message.id,
            envelope: action.payload.envelope,
            createdAt: action.payload.envelope.createdAt,
          },
          ...state.queue,
        ],
        seenEnvelopeIds: [...state.seenEnvelopeIds, action.payload.envelope.id],
        deliveryHealth: "online",
      };
    }
    case "confirm-envelope":
      return {
        ...state,
        messages: state.messages.map((message) =>
          state.queue.find((item) => item.envelope.id === action.payload.envelopeId)
            ?.messageId === message.id
            ? {
                ...message,
                deliveryState: "confirmed",
                hopCount: 1,
              }
            : message,
        ),
        queue: state.queue.filter(
          (item) => item.envelope.id !== action.payload.envelopeId,
        ),
      };
    case "set-peers":
      return {
        ...state,
        transportPeers: action.payload,
      };
    case "set-transport-mode":
      return {
        ...state,
        transportMode: action.payload,
        nearbyEnabled:
          action.payload === "nearby-android" ? state.nearbyEnabled : false,
        transportPeers: [],
        transportConnectionState:
          action.payload === "nearby-android"
            ? "permission-required"
            : "disconnected",
        transportError:
          action.payload === "nearby-android"
            ? "Grant nearby permissions and tap Start Nearby."
            : undefined,
      };
    case "set-relay-url":
      return {
        ...state,
        relayServerUrl: action.payload,
      };
    case "set-nearby-enabled":
      return {
        ...state,
        nearbyEnabled: action.payload,
      };
    case "set-nearby-permission-state":
      return {
        ...state,
        nearbyPermissionState: action.payload,
      };
    case "set-transport-connection":
      return {
        ...state,
        transportConnectionState: action.payload.state,
        transportError: action.payload.error,
      };
    case "apply-remote-payload": {
      if (state.seenEnvelopeIds.includes(action.payload.envelope.id)) {
        return state;
      }

      // One verified envelope can update multiple slices of state depending on payload kind.
      const nextState: AppState = {
        ...state,
        friends: upsertFriend(
          state.friends,
          action.payload.eventPayload,
          action.payload.envelope,
        ),
        seenEnvelopeIds: [...state.seenEnvelopeIds, action.payload.envelope.id],
      };

      if (action.payload.eventPayload.kind === "chat") {
        nextState.messages = [
          {
            id: createId("msg"),
            senderId: action.payload.envelope.senderId,
            senderLabel: action.payload.eventPayload.senderLabel,
            eventId: action.payload.envelope.eventId,
            ciphertext: action.payload.envelope.ciphertext,
            plaintextPreview: action.payload.eventPayload.body,
            createdAt: action.payload.eventPayload.sentAt,
            deliveryState: "relayed",
            hopCount: action.payload.envelope.hopCount,
          },
          ...state.messages,
        ];
      }

      if (
        action.payload.eventPayload.kind === "meetup" ||
        action.payload.eventPayload.kind === "status"
      ) {
        nextState.locationHints = {
          ...state.locationHints,
          [action.payload.envelope.senderId]: {
            friendId: action.payload.envelope.senderId,
            updatedAt: action.payload.eventPayload.sentAt,
            meetupSpot: action.payload.eventPayload.meetupSpot,
            gps: action.payload.eventPayload.gps,
            proximity: action.payload.eventPayload.proximity,
          },
        };
      }

      return nextState;
    }
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  bootstrapIdentity: (handle: string) => void;
  addNearbyPeerAsFriend: (peerId: string) => void;
  sendChatMessage: (text: string) => Promise<void>;
  setTransportMode: (mode: TransportMode) => void;
  setRelayServerUrl: (url: string) => void;
  startNearbyTransport: () => Promise<void>;
  stopNearbyTransport: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function createTransport(mode: TransportMode): MeshTransport {
  if (mode === "nearby-android") {
    return new AndroidNearbyTransport();
  }

  if (mode === "relay-server") {
    return new WebSocketRelayTransport();
  }

  return new DemoCompositeMeshTransport();
}

function mergeHydratedState(base: AppState, persisted: AppState): AppState {
  return {
    ...base,
    ...persisted,
    event: persisted.event ?? base.event,
    friends: persisted.friends ?? base.friends,
    messages: persisted.messages ?? base.messages,
    locationHints: {
      ...base.locationHints,
      ...persisted.locationHints,
    },
    transportPeers: persisted.transportPeers ?? [],
    queue: persisted.queue ?? [],
    nearbyPermissionState: persisted.nearbyPermissionState ?? base.nearbyPermissionState,
    nearbyEnabled: persisted.nearbyEnabled ?? base.nearbyEnabled,
    seenEnvelopeIds: persisted.seenEnvelopeIds ?? [],
  };
}

async function requestNearbyPermissions() {
  if (Platform.OS !== "android") {
    return {
      granted: false,
      state: "denied" as NearbyPermissionState,
      missing: ["android-only"],
    };
  }

  // NEARBY_WIFI_DEVICES is only a runtime permission on newer Android releases.
  const apiLevel =
    typeof Platform.Version === "number"
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10);

  const permissions: AndroidPermissionValue[] = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];

  if (apiLevel >= 31) {
    permissions.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    );
  }

  if (apiLevel >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  }

  const results = (await PermissionsAndroid.requestMultiple(
    permissions,
  )) as Record<AndroidPermissionValue, string>;
  const missing = permissions.filter(
    (permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED,
  );

  return {
    granted: missing.length === 0,
    state: missing.length === 0 ? ("granted" as NearbyPermissionState) : ("denied" as NearbyPermissionState),
    missing,
  };
}

function buildPayload(
  state: AppState,
  user: UserIdentity,
  kind: EventPayload["kind"],
  body: string,
): EventPayload {
  // Chat and location-style updates all reuse the same event payload shape so
  // the transport and crypto layers do not need to care about feature-specific semantics.
  return {
    kind,
    body,
    senderHandle: user.handle,
    senderLabel: user.displayName,
    sentAt: new Date().toISOString(),
    meetupSpot: state.activeMeetupSpot,
    gps: state.locationHints[user.id]?.gps,
    proximity: state.locationHints[user.id]?.proximity,
    status: kind === "status" ? (body as FriendStatus) : undefined,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState);
  const transportRef = useRef<MeshTransport>(createTransport("demo"));
  const stateRef = useRef(state);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value) {
          const persisted = JSON.parse(value) as AppState;
          dispatch({
            type: "hydrated",
            payload: mergeHydratedState(createSeedState(), persisted),
          });
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!state.user || !state.event) {
      return;
    }

    if (state.transportMode === "nearby-android" && !state.nearbyEnabled) {
      dispatch({
        type: "set-transport-connection",
        payload: {
          state: "permission-required",
          error: "Grant nearby permissions and tap Start Nearby.",
        },
      });
      return;
    }

    // The provider is the coordinator between persisted app state and the active transport adapter.
    const transport = createTransport(state.transportMode);
    transportRef.current = transport;

    const unsubscribeEnvelope = transport.onEnvelope((envelope) => {
      console.info("[ConcertMesh] envelope received", envelope.id, envelope.senderId);
      const currentState = stateRef.current;
      if (!currentState.event) {
        return;
      }

      if (!verifyEnvelopeSignature(envelope, envelope.senderPublicKey)) {
        console.warn("[ConcertMesh] invalid envelope signature", envelope.id);
        return;
      }

      if (envelope.senderId === currentState.user?.id) {
        dispatch({
          type: "confirm-envelope",
          payload: {
            envelopeId: envelope.id,
          },
        });
        return;
      }

      if (currentState.seenEnvelopeIds.includes(envelope.id)) {
        console.info("[ConcertMesh] duplicate envelope ignored", envelope.id);
        return;
      }

      try {
        // Verify before decrypting so bogus relay traffic is dropped cheaply.
        const plaintext = decryptPayload(
          envelope.ciphertext,
          envelope.nonce,
          currentState.event.sharedKey,
        );
        const eventPayload = JSON.parse(plaintext) as EventPayload;

        dispatch({
          type: "apply-remote-payload",
          payload: {
            envelope,
            eventPayload,
          },
        });
      } catch {
        console.warn("[ConcertMesh] envelope decrypt failed", envelope.id);
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "error",
            error:
              "Received an envelope that could not be decrypted with the event key.",
          },
        });
      }
    });

    const unsubscribePeers = transport.onPeersChanged((peers) => {
      const currentState = stateRef.current;
      console.info("[ConcertMesh] peers changed", peers.length);
      dispatch({
        type: "set-peers",
        payload: peers.filter((peer) => peer.id !== currentState.user?.id),
      });
    });

    const unsubscribeConnection = transport.onConnectionStateChanged(
      (connectionState, error) => {
        console.info("[ConcertMesh] connection state", connectionState, error ?? "");
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: connectionState,
            error,
          },
        });
      },
    );

    transport
      .start({
        event: state.event,
        user: state.user,
        relayServerUrl: state.relayServerUrl,
      })
      .catch((error: Error) => {
        console.warn("[ConcertMesh] transport start failed", error.message);
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "error",
            error: error.message,
          },
        });
      });

    return () => {
      unsubscribeEnvelope();
      unsubscribePeers();
      unsubscribeConnection();
      transport.stop().catch(() => undefined);
    };
  }, [state.event, state.nearbyEnabled, state.relayServerUrl, state.transportMode, state.user]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      bootstrapIdentity(handle) {
        dispatch({
          type: "set-user",
          payload: createUserIdentity(handle.startsWith("@") ? handle : `@${handle}`),
        });
      },
      addNearbyPeerAsFriend(peerId) {
        const peer = state.transportPeers.find((item) => item.id === peerId);
        if (!peer) {
          return;
        }

        dispatch({
          type: "add-friend-from-peer",
          payload: peer,
        });
      },
      async sendChatMessage(text) {
        if (!state.user || !state.event || !text.trim()) {
          return;
        }

        // Sending is a three-step flow: build app payload -> wrap/sign relay envelope -> hand to transport.
        const payload = buildPayload(state, state.user, "chat", text.trim());
        const envelope = createRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
        );

        dispatch({
          type: "queue-envelope",
          payload: {
            envelope,
            preview: text.trim(),
          },
        });

        await transportRef.current.send(envelope);
      },
      async shareMeetupSpot(spot: string) {
        if (!state.user || !state.event) {
          return;
        }

        dispatch({
          type: "set-meetup",
          payload: spot,
        });

        const locationHint: PeerLocationHint = {
          friendId: state.user.id,
          meetupSpot: spot,
          updatedAt: new Date().toISOString(),
          gps: state.locationHints[state.user.id]?.gps,
          proximity: state.locationHints[state.user.id]?.proximity,
        };

        dispatch({
          type: "set-location",
          payload: locationHint,
        });

        const payload = buildPayload(
          {
            ...state,
            activeMeetupSpot: spot,
            locationHints: {
              ...state.locationHints,
              [state.user.id]: locationHint,
            },
          },
          state.user,
          "meetup",
          spot,
        );
        const envelope = createRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
        );

        dispatch({
          type: "queue-envelope",
          payload: {
            envelope,
            preview: `Meet me at ${spot}`,
          },
        });

        await transportRef.current.send(envelope);
      },
      async refreshGpsHint() {
        if (!state.user) {
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        dispatch({
          type: "set-location",
          payload: {
            friendId: state.user.id,
            updatedAt: new Date().toISOString(),
            meetupSpot: state.activeMeetupSpot,
            gps: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: position.coords.accuracy ?? 25,
            },
            proximity: {
              estimate: "nearby",
              confidence: 0.67,
            },
          },
        });
      },
      async setStatus(status: FriendStatus) {
        if (!state.user || !state.event) {
          return;
        }

        const locationHint: PeerLocationHint = {
          friendId: state.user.id,
          updatedAt: new Date().toISOString(),
          meetupSpot: state.activeMeetupSpot,
          gps: state.locationHints[state.user.id]?.gps,
          proximity: {
            estimate: "same-zone",
            confidence: 0.58,
          },
        };

        dispatch({
          type: "set-location",
          payload: locationHint,
        });

        const payload = buildPayload(
          {
            ...state,
            locationHints: {
              ...state.locationHints,
              [state.user.id]: locationHint,
            },
          },
          state.user,
          "status",
          status,
        );
        const envelope = createRelayEnvelope(
          JSON.stringify(payload),
          state.user,
          state.event,
        );

        dispatch({
          type: "queue-envelope",
          payload: {
            envelope,
            preview: `Status: ${status}`,
          },
        });

        await transportRef.current.send(envelope);
      },
      setTransportMode(mode) {
        dispatch({
          type: "set-transport-mode",
          payload: mode,
        });
      },
      setRelayServerUrl(url) {
        dispatch({
          type: "set-relay-url",
          payload: url,
        });
      },
      async startNearbyTransport() {
        console.info("[ConcertMesh] request nearby permissions");
        const result = await requestNearbyPermissions();
        console.info(
          "[ConcertMesh] nearby permission result",
          result.state,
          result.missing.join(",") || "none",
        );

        dispatch({
          type: "set-nearby-permission-state",
          payload: result.state,
        });

        if (!result.granted) {
          const error = `Missing permissions: ${result.missing.join(", ")}`;
          console.warn("[ConcertMesh] nearby permission denied", error);
          dispatch({
            type: "set-nearby-enabled",
            payload: false,
          });
          dispatch({
            type: "set-transport-connection",
            payload: {
              state: "permission-required",
              error,
            },
          });
          return;
        }

        dispatch({
          type: "set-nearby-enabled",
          payload: true,
        });
        console.info("[ConcertMesh] nearby transport enabled");
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "connecting",
            error: undefined,
          },
        });
      },
      async stopNearbyTransport() {
        console.info("[ConcertMesh] stop nearby transport");
        dispatch({
          type: "set-nearby-enabled",
          payload: false,
        });
        dispatch({
          type: "set-transport-connection",
          payload: {
            state: "disconnected",
            error: undefined,
          },
        });
        await transportRef.current.stop();
      },
    }),
    [state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useAppState must be used inside AppProvider");
  }

  return value;
}
