import { Platform } from "react-native";

import { getConcertNearbyMeshModule } from "./ConcertNearbyMeshModule";
import { relayStore } from "./RelayStore";
import { RELAY_REBROADCAST_INTERVAL_MS } from "./relayConfig";
import type { MeshTransport } from "./Transport";

class RelayBroadcaster {
  private transport: MeshTransport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickSubscription: { remove(): void } | null = null;

  start(transport: MeshTransport): void {
    this.transport = transport;

    if (Platform.OS === "android") {
      const module = getConcertNearbyMeshModule();
      if (module) {
        module.startRelayService().catch(() => undefined);
        this.tickSubscription = module.addListener("onRelayTick", () => {
          this.tick();
        });
        return;
      }
    }

    // iOS or Android without native module: use JS timer (opportunistic)
    this.timer = setInterval(() => this.tick(), RELAY_REBROADCAST_INTERVAL_MS);
  }

  stop(): void {
    if (Platform.OS === "android") {
      getConcertNearbyMeshModule()?.stopRelayService().catch(() => undefined);
      this.tickSubscription?.remove();
      this.tickSubscription = null;
    }

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.transport = null;
  }

  private async tick(): Promise<void> {
    if (!this.transport) return;
    await relayStore.pruneExpired();
    for (const envelope of relayStore.getActive()) {
      this.transport.send(envelope).catch(() => undefined);
    }
  }
}

export const relayBroadcaster = new RelayBroadcaster();
