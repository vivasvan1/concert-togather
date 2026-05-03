import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { relayBroadcaster } from "../services/mesh/RelayBroadcaster";
import { relayStore, type RelayStoreEntry } from "../services/mesh/RelayStore";

function fmt(ms: number): string {
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(ms / 1000)}s`;
}

function short(key: string): string {
  return key.slice(-8);
}

interface Snapshot {
  entries: RelayStoreEntry[];
  recentAcks: string[];
  enabled: boolean;
  lastTickAt: number | null;
}

function poll(): Snapshot {
  return {
    entries: relayStore.getSnapshot(),
    recentAcks: [...relayStore.recentAcks],
    enabled: relayBroadcaster.isEnabled,
    lastTickAt: relayBroadcaster.lastTickAt,
  };
}

export function RelayDebugPanel() {
  const [snap, setSnap] = useState<Snapshot>(poll);

  useEffect(() => {
    if (!__DEV__) return;
    const id = setInterval(() => setSnap(poll()), 2000);
    return () => clearInterval(id);
  }, []);

  const handleForceTick = useCallback(() => {
    relayBroadcaster.forceTick().then(() => setSnap(poll()));
  }, []);

  const handleTogglePause = useCallback(() => {
    relayBroadcaster.setEnabled(!snap.enabled);
    setSnap(poll());
  }, [snap.enabled]);

  const handleClear = useCallback(() => {
    relayStore.clearAll().then(() => setSnap(poll()));
  }, []);

  if (!__DEV__) return null;

  const now = Date.now();

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Relay Debug</Text>
        <View style={[styles.badge, snap.enabled ? styles.activeBadge : styles.pausedBadge]}>
          <Text style={styles.badgeText}>{snap.enabled ? "ACTIVE" : "PAUSED"}</Text>
        </View>
      </View>

      {snap.lastTickAt !== null && (
        <Text style={styles.meta}>
          Last tick: {fmt(now - snap.lastTickAt)} ago
        </Text>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          onPress={handleForceTick}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>Force Tick</Text>
        </Pressable>
        <Pressable
          onPress={handleTogglePause}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{snap.enabled ? "Pause" : "Resume"}</Text>
        </Pressable>
        <Pressable
          onPress={handleClear}
          style={({ pressed }) => [styles.button, styles.destructive, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>Clear</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>
        Relay store — {snap.entries.length} envelopes
      </Text>
      {snap.entries.length === 0 ? (
        <Text style={styles.empty}>Empty</Text>
      ) : (
        snap.entries.map((e) => (
          <View key={e.dedupeKey} style={styles.row}>
            <Text style={styles.rowKey}>…{short(e.dedupeKey)}</Text>
            <Text style={styles.rowSender}>{e.senderId.slice(0, 12)}</Text>
            <Text style={styles.rowExpiry}>
              {fmt(e.expiresAt - now)}
            </Text>
          </View>
        ))
      )}

      {snap.recentAcks.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Recent ACKs</Text>
          {snap.recentAcks.map((k) => (
            <Text key={k} style={styles.ackRow}>
              ✓ …{short(k)}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0D1117",
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: "#E6EDF3",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  activeBadge: { backgroundColor: "#1A7F37" },
  pausedBadge: { backgroundColor: "#6E4800" },
  badgeText: {
    color: "#E6EDF3",
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  meta: {
    color: "#7D8590",
    fontSize: 11,
    fontFamily: "monospace",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 6,
  },
  button: {
    backgroundColor: "#21262D",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  destructive: {
    borderColor: "#F85149",
  },
  pressed: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: "#E6EDF3",
    fontSize: 12,
    fontFamily: "monospace",
  },
  sectionLabel: {
    color: "#7D8590",
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 4,
  },
  empty: {
    color: "#7D8590",
    fontSize: 11,
    fontFamily: "monospace",
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  rowKey: {
    color: "#79C0FF",
    fontSize: 11,
    fontFamily: "monospace",
    flex: 1,
  },
  rowSender: {
    color: "#A5D6FF",
    fontSize: 11,
    fontFamily: "monospace",
    flex: 2,
  },
  rowExpiry: {
    color: "#D29922",
    fontSize: 11,
    fontFamily: "monospace",
    flex: 1,
    textAlign: "right",
  },
  ackRow: {
    color: "#3FB950",
    fontSize: 11,
    fontFamily: "monospace",
  },
});
