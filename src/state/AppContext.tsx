import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";

import { createSeedState } from "../data/mockData";
import { createUserIdentity, verifyEnvelopeSignature } from "../services/crypto/CryptoService";
import { DemoCompositeMeshTransport } from "../services/mesh/DemoCompositeMeshTransport";
import { createRelayEnvelope } from "../services/mesh/relay";
import type { AppState, ChatMessage, FriendStatus, PeerLocationHint, RelayEnvelope, UserIdentity } from "../types/domain";
import { createId } from "../utils/ids";

const STORAGE_KEY = "concert-togather/app-state";

type AppAction =
  | { type: "hydrated"; payload: AppState }
  | { type: "set-user"; payload: UserIdentity }
  | { type: "set-meetup"; payload: string }
  | { type: "set-location"; payload: PeerLocationHint }
  | { type: "queue-envelope"; payload: { envelope: RelayEnvelope; preview: string } }
  | { type: "confirm-envelope"; payload: { envelopeId: string } }
  | { type: "set-peers"; payload: AppState["transportPeers"] };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "hydrated":
      return action.payload;
    case "set-user":
      return {
        ...state,
        user: action.payload,
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
        deliveryHealth: "online",
      };
    }
    case "confirm-envelope":
      return {
        ...state,
        messages: state.messages.map((message) =>
          state.queue.find((item) => item.envelope.id === action.payload.envelopeId)?.messageId === message.id
            ? {
                ...message,
                deliveryState: "confirmed",
                hopCount: 1,
              }
            : message,
        ),
        queue: state.queue.filter((item) => item.envelope.id !== action.payload.envelopeId),
      };
    case "set-peers":
      return {
        ...state,
        transportPeers: action.payload,
      };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  bootstrapIdentity: (handle: string) => void;
  sendChatMessage: (text: string) => Promise<void>;
  shareMeetupSpot: (spot: string) => Promise<void>;
  refreshGpsHint: () => Promise<void>;
  setStatus: (status: FriendStatus) => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const transport = new DemoCompositeMeshTransport();

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value) {
          dispatch({
            type: "hydrated",
            payload: JSON.parse(value) as AppState,
          });
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    transport.start().catch(() => undefined);
    dispatch({
      type: "set-peers",
      payload: transport.getPeers(),
    });

    const unsubscribe = transport.onEnvelope((envelope) => {
      if (!state.event || !state.user) {
        return;
      }

      if (envelope.senderId !== state.user.id) {
        return;
      }

      if (!verifyEnvelopeSignature(envelope, state.user.publicKey)) {
        return;
      }

      dispatch({
        type: "confirm-envelope",
        payload: {
          envelopeId: envelope.id,
        },
      });
    });

    return () => {
      unsubscribe();
      transport.stop().catch(() => undefined);
    };
  }, [state.event, state.user]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      bootstrapIdentity(handle) {
        dispatch({
          type: "set-user",
          payload: createUserIdentity(handle.startsWith("@") ? handle : `@${handle}`),
        });
      },
      async sendChatMessage(text) {
        if (!state.user || !state.event || !text.trim()) {
          return;
        }

        const envelope = createRelayEnvelope(
          JSON.stringify({
            kind: "chat",
            body: text.trim(),
          }),
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

        await transport.send(envelope);
      },
      async shareMeetupSpot(spot) {
        if (!state.user || !state.event) {
          return;
        }

        dispatch({
          type: "set-meetup",
          payload: spot,
        });

        dispatch({
          type: "set-location",
          payload: {
            friendId: state.user.id,
            meetupSpot: spot,
            updatedAt: new Date().toISOString(),
          },
        });

        const envelope = createRelayEnvelope(
          JSON.stringify({
            kind: "meetup",
            body: spot,
          }),
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

        await transport.send(envelope);
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
      async setStatus(status) {
        if (!state.user || !state.event) {
          return;
        }

        dispatch({
          type: "set-location",
          payload: {
            friendId: state.user.id,
            updatedAt: new Date().toISOString(),
            meetupSpot: state.activeMeetupSpot,
            proximity: {
              estimate: "same-zone",
              confidence: 0.58,
            },
          },
        });

        const envelope = createRelayEnvelope(
          JSON.stringify({
            kind: "status",
            body: status,
          }),
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

        await transport.send(envelope);
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
