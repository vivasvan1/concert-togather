import AsyncStorage from "@react-native-async-storage/async-storage";

import type { RelayEnvelope } from "../../types/domain";
import { RELAY_TTL_MS } from "./relayConfig";

const RELAY_STORE_KEY = "concert-togather/relay-store-v1";
const MAX_RECENT_ACKS = 10;

interface RelayEntry {
  envelope: RelayEnvelope;
  expiresAt: number;
}

export interface RelayStoreEntry {
  dedupeKey: string;
  senderId: string;
  expiresAt: number;
}

class RelayStore {
  private entries = new Map<string, RelayEntry>();
  private _recentAcks: string[] = [];

  get recentAcks(): string[] {
    return this._recentAcks;
  }

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
    this._recentAcks = [dedupeKey, ...this._recentAcks].slice(0, MAX_RECENT_ACKS);
    await this.persist();
  }

  getActive(): RelayEnvelope[] {
    const now = Date.now();
    return Array.from(this.entries.values())
      .filter((e) => e.expiresAt > now)
      .map((e) => e.envelope);
  }

  getSnapshot(): RelayStoreEntry[] {
    return Array.from(this.entries.values()).map((e) => ({
      dedupeKey: e.envelope.dedupeKey,
      senderId: e.envelope.senderId,
      expiresAt: e.expiresAt,
    }));
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
    await this.persist();
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
