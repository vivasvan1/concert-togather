import AsyncStorage from "@react-native-async-storage/async-storage";

import type { RelayEnvelope } from "../../types/domain";
import { RELAY_TTL_MS } from "./relayConfig";

const RELAY_STORE_KEY = "concert-togather/relay-store-v1";

interface RelayEntry {
  envelope: RelayEnvelope;
  expiresAt: number;
}

class RelayStore {
  private entries = new Map<string, RelayEntry>();

  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(RELAY_STORE_KEY);
      if (!raw) return;
      const parsed: RelayEntry[] = JSON.parse(raw);
      for (const entry of parsed) {
        this.entries.set(entry.envelope.dedupeKey, entry);
      }
    } catch {}
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        RELAY_STORE_KEY,
        JSON.stringify(Array.from(this.entries.values())),
      );
    } catch {}
  }

  async add(envelope: RelayEnvelope): Promise<void> {
    const expiresAt = new Date(envelope.createdAt).getTime() + RELAY_TTL_MS;
    if (Date.now() >= expiresAt) return;
    this.entries.set(envelope.dedupeKey, { envelope, expiresAt });
    await this.persist();
  }

  async remove(dedupeKey: string): Promise<void> {
    if (!this.entries.has(dedupeKey)) return;
    this.entries.delete(dedupeKey);
    await this.persist();
  }

  getActive(): RelayEnvelope[] {
    const now = Date.now();
    return Array.from(this.entries.values())
      .filter((e) => e.expiresAt > now)
      .map((e) => e.envelope);
  }

  async pruneExpired(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}

export const relayStore = new RelayStore();
