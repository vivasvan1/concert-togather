import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SectionCard } from "../components/SectionCard";
import { getPlatformCapabilities } from "../services/platform/capabilities";
import { useAppState } from "../state/AppContext";
import { formatTimeLabel, minutesAgo } from "../utils/date";

export function ConcertMeshApp() {
  const {
    state,
    bootstrapIdentity,
    addNearbyPeerAsFriend,
    sendChatMessage,
    setTransportMode,
    setRelayServerUrl,
    startNearbyTransport,
    stopNearbyTransport,
  } = useAppState();
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const [relayUrlDraft, setRelayUrlDraft] = useState(state.relayServerUrl);
  const capabilities = getPlatformCapabilities();

  useEffect(() => {
    setRelayUrlDraft(state.relayServerUrl);
  }, [state.relayServerUrl]);

  if (!state.user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Nearby friend finder</Text>
          <Text style={styles.headline}>
            Find nearby people and message them directly.
          </Text>
          <Text style={styles.copy}>
            Create a handle, start nearby discovery, add friends from the live peer
            list, and send messages once they are in range.
          </Text>
          <TextInput
            value={handle}
            onChangeText={setHandle}
            style={styles.input}
            placeholder="@yourhandle"
            placeholderTextColor="#6F7E90"
            autoCapitalize="none"
          />
          <Pressable
            onPress={() => bootstrapIdentity(handle || "@crowdlink")}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>Enter Headliner Night</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.banner}>
          <Text style={styles.kicker}>Live event</Text>
          <Text style={styles.headline}>{state.event?.name}</Text>
          <Text style={styles.copy}>
            {state.event?.venueName} · {state.transportPeers.length} nearby peers
            found
          </Text>
        </View>

        <SectionCard
          title="Mesh readiness"
          subtitle="The app shell is transport-aware. Android can carry more background relay load than iOS."
        >
          {capabilities.map((capability) => (
            <View key={capability.kind} style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>{capability.label}</Text>
                <Text style={styles.rowMeta}>{capability.note}</Text>
              </View>
              <Text
                style={[
                  styles.badge,
                  capability.available ? styles.goodBadge : styles.mutedBadge,
                ]}
              >
                {capability.available ? "ready" : "limited"}
              </Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard
          title="Transport"
          subtitle="Android APKs can use direct nearby discovery. The relay server remains a fallback for same-Wi-Fi testing."
        >
          <View style={styles.chipWrap}>
            {Platform.OS === "android" ? (
              <Pressable
                onPress={() => setTransportMode("nearby-android")}
                style={({ pressed }) => [
                  styles.chip,
                  state.transportMode === "nearby-android" && styles.chipActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.chipLabel}>Nearby Android</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setTransportMode("demo")}
              style={({ pressed }) => [
                styles.chip,
                state.transportMode === "demo" && styles.chipActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.chipLabel}>Demo transport</Text>
            </Pressable>
            <Pressable
              onPress={() => setTransportMode("relay-server")}
              style={({ pressed }) => [
                styles.chip,
                state.transportMode === "relay-server" && styles.chipActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.chipLabel}>Relay server</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.rowTitle}>Connection</Text>
              <Text style={styles.rowMeta}>
                {state.transportConnectionState}
                {state.transportError ? ` · ${state.transportError}` : ""}
              </Text>
            </View>
            {state.transportMode === "relay-server" ? (
              <Pressable
                onPress={() => setRelayServerUrl(relayUrlDraft.trim())}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryLabel}>Apply URL</Text>
              </Pressable>
            ) : null}
          </View>
          {state.transportMode === "relay-server" ? (
            <TextInput
              value={relayUrlDraft}
              onChangeText={setRelayUrlDraft}
              style={styles.input}
              placeholder="ws://192.168.x.x:8787"
              placeholderTextColor="#6F7E90"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          <Text style={styles.rowMeta}>
            Connected peers: {state.transportPeers.length} · Active mode:{" "}
            {state.transportMode}
          </Text>
          {state.transportMode === "nearby-android" ? (
            <View style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>Nearby permission</Text>
                <Text style={styles.rowMeta}>{state.nearbyPermissionState}</Text>
              </View>
              <Pressable
                onPress={
                  state.nearbyEnabled ? stopNearbyTransport : startNearbyTransport
                }
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryLabel}>
                  {state.nearbyEnabled ? "Stop Nearby" : "Start Nearby"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {state.transportMode === "nearby-android" ? (
            <Text style={styles.rowMeta}>
              Open the APK on both Android phones, join the same event, tap Start
              Nearby, grant the permission prompts, and keep both devices in the
              foreground for the first test.
            </Text>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Find Nearby"
          subtitle="Discover nearby phones, then explicitly add the ones you want to keep as friends."
        >
          {state.transportPeers.length === 0 ? (
            <Text style={styles.rowMeta}>
              No nearby peers yet. Start nearby on both devices and keep the apps in
              the foreground.
            </Text>
          ) : (
            state.transportPeers.map((peer) => {
              const alreadyAdded = state.friends.some((friend) => friend.id === peer.id);
              return (
                <View key={peer.id} style={styles.friendCard}>
                  <View>
                    <Text style={styles.rowTitle}>{peer.alias}</Text>
                    <Text style={styles.rowMeta}>
                      Nearby over {peer.via} · seen {minutesAgo(peer.lastSeenAt)}m ago
                    </Text>
                  </View>
                  {alreadyAdded ? (
                    <Text style={[styles.badge, styles.goodBadge]}>Added</Text>
                  ) : (
                    <Pressable
                      onPress={() => addNearbyPeerAsFriend(peer.id)}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.secondaryLabel}>Add Friend</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </SectionCard>

        <SectionCard
          title="Friends"
          subtitle="Only manually added nearby peers appear here."
        >
          {state.friends.length === 0 ? (
            <Text style={styles.rowMeta}>
              No friends added yet. Use Find Nearby to add one from a discovered
              device.
            </Text>
          ) : (
            state.friends.map((friend) => {
              const hint = state.locationHints[friend.id];
              const peer = state.transportPeers.find((item) => item.id === friend.id);
              const routeStatus = peer
                ? `Nearby and connected via ${peer.via}`
                : hint?.proximity
                  ? `Route status: ${hint.proximity.estimate.replace("-", " ")}`
                  : `Last seen ${minutesAgo(friend.lastSeenAt)}m ago`;
              return (
                <View key={friend.id} style={styles.friendCard}>
                  <View>
                    <Text style={styles.rowTitle}>{friend.displayName}</Text>
                    <Text style={styles.rowMeta}>
                      {routeStatus}
                    </Text>
                  </View>
                  <Text style={styles.badge}>{friend.handle}</Text>
                </View>
              );
            })
          )}
        </SectionCard>

        <SectionCard
          title="Send Message"
          subtitle="Messages are encrypted before they go over nearby transport."
        >
          <View style={styles.composeRow}>
            <Pressable
              onPress={async () => {
                await sendChatMessage(draft);
                setDraft("");
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.composeButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>Send</Text>
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              style={[styles.input, styles.composeInput]}
              placeholder="Message your crew"
              placeholderTextColor="#6F7E90"
            />
          </View>
          {state.messages.length === 0 ? (
            <Text style={styles.rowMeta}>
              No messages yet. Add a nearby friend and send a test message.
            </Text>
          ) : (
            state.messages.map((message) => (
              <View key={message.id} style={styles.messageBubble}>
                <View style={styles.row}>
                  <Text style={styles.rowTitle}>{message.senderLabel}</Text>
                  <Text style={styles.rowMeta}>
                    {formatTimeLabel(message.createdAt)} · {message.deliveryState} ·
                    hops {message.hopCount}
                  </Text>
                </View>
                <Text style={styles.messageText}>{message.plaintextPreview}</Text>
              </View>
            ))
          )}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0C1015",
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  hero: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0C1015",
    gap: 16,
  },
  banner: {
    gap: 10,
    paddingTop: 12,
    paddingBottom: 8,
  },
  kicker: {
    color: "#F1A34F",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
    fontSize: 12,
  },
  headline: {
    color: "#F7FAFC",
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "800",
  },
  copy: {
    color: "#A8B4C1",
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#171B22",
    borderWidth: 1,
    borderColor: "#2A3340",
    color: "#F4F7FB",
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1693C",
    paddingHorizontal: 18,
  },
  composeButton: {
    minWidth: 88,
  },
  primaryButtonLabel: {
    color: "#FDF3EE",
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1F2732",
    paddingHorizontal: 14,
  },
  secondaryLabel: {
    color: "#D8E0E8",
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.82,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  rowTitle: {
    color: "#F4F7FB",
    fontSize: 15,
    fontWeight: "700",
  },
  rowMeta: {
    color: "#95A1B0",
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 240,
  },
  badge: {
    color: "#D8E0E8",
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: "#222D38",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  goodBadge: {
    backgroundColor: "#19392E",
    color: "#9BE3B6",
  },
  mutedBadge: {
    backgroundColor: "#3B2621",
    color: "#F2B59E",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1E2630",
  },
  chipActive: {
    backgroundColor: "#264C53",
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#252132",
  },
  chipLabel: {
    color: "#F2F7FB",
    fontWeight: "700",
  },
  friendCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#121821",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  composeRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  composeInput: {
    flex: 1,
  },
  messageBubble: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#121821",
    gap: 10,
  },
  messageText: {
    color: "#F4F7FB",
    fontSize: 15,
    lineHeight: 20,
  },
});
