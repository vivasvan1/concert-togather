import React, { useState } from "react";
import {
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
import type { FriendStatus } from "../types/domain";
import { formatTimeLabel, minutesAgo } from "../utils/date";
import { getFriendLocationSummary } from "../utils/location";

const STATUS_OPTIONS: FriendStatus[] = ["safe", "moving", "at-stage", "at-exit", "at-merch", "need-help"];

export function ConcertMeshApp() {
  const { state, bootstrapIdentity, sendChatMessage, shareMeetupSpot, refreshGpsHint, setStatus } = useAppState();
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const capabilities = getPlatformCapabilities();

  if (!state.user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Concert mesh MVP</Text>
          <Text style={styles.headline}>Stay connected when the venue network collapses.</Text>
          <Text style={styles.copy}>
            Create a handle, join the event, and use encrypted relay messaging plus meetup signals to recover your group.
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
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
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
            {state.event?.venueName} · {state.transportPeers.length} nearby relays · health {state.deliveryHealth}
          </Text>
        </View>

        <SectionCard title="Mesh readiness" subtitle="The app shell is transport-aware. Android can carry more background relay load than iOS.">
          {capabilities.map((capability) => (
            <View key={capability.kind} style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>{capability.label}</Text>
                <Text style={styles.rowMeta}>{capability.note}</Text>
              </View>
              <Text style={[styles.badge, capability.available ? styles.goodBadge : styles.mutedBadge]}>
                {capability.available ? "ready" : "limited"}
              </Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Find my group" subtitle="Combine meetup zones, last GPS hints, and nearby peer signals.">
          <View style={styles.chipWrap}>
            {state.event?.meetupSpots.map((spot) => (
              <Pressable
                key={spot}
                onPress={() => shareMeetupSpot(spot)}
                style={({ pressed }) => [
                  styles.chip,
                  state.activeMeetupSpot === spot && styles.chipActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.chipLabel}>{spot}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.rowTitle}>Your active rendezvous</Text>
              <Text style={styles.rowMeta}>{state.activeMeetupSpot}</Text>
            </View>
            <Pressable onPress={refreshGpsHint} style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
              <Text style={styles.secondaryLabel}>Refresh GPS</Text>
            </Pressable>
          </View>
        </SectionCard>

        <SectionCard title="Status beacon" subtitle="Short, high-signal updates relay better than long explanations in a crowded mesh.">
          <View style={styles.chipWrap}>
            {STATUS_OPTIONS.map((status) => (
              <Pressable key={status} onPress={() => setStatus(status)} style={({ pressed }) => [styles.statusChip, pressed && styles.buttonPressed]}>
                <Text style={styles.chipLabel}>{status}</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>

        <SectionCard title="Friends" subtitle="Freshness matters more than false precision indoors.">
          {state.friends.map((friend) => {
            const hint = state.locationHints[friend.id];
            return (
              <View key={friend.id} style={styles.friendCard}>
                <View>
                  <Text style={styles.rowTitle}>{friend.displayName}</Text>
                  <Text style={styles.rowMeta}>
                    {getFriendLocationSummary(hint)} · {minutesAgo(hint?.updatedAt ?? friend.lastSeenAt)}m ago
                  </Text>
                </View>
                <Text style={styles.badge}>{friend.handle}</Text>
              </View>
            );
          })}
        </SectionCard>

        <SectionCard title="Encrypted group relay" subtitle="Payloads are encrypted before they enter the relay envelope. The current transport is a simulator until native radio modules are added.">
          <View style={styles.composeRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              style={[styles.input, styles.composeInput]}
              placeholder="Message your crew"
              placeholderTextColor="#6F7E90"
            />
            <Pressable
              onPress={async () => {
                await sendChatMessage(draft);
                setDraft("");
              }}
              style={({ pressed }) => [styles.primaryButton, styles.composeButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonLabel}>Send</Text>
            </Pressable>
          </View>
          {state.messages.length === 0 ? (
            <Text style={styles.rowMeta}>No messages yet. Send a meetup instruction or quick check-in.</Text>
          ) : (
            state.messages.map((message) => (
              <View key={message.id} style={styles.messageBubble}>
                <View style={styles.row}>
                  <Text style={styles.rowTitle}>{message.senderLabel}</Text>
                  <Text style={styles.rowMeta}>
                    {formatTimeLabel(message.createdAt)} · {message.deliveryState}
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
