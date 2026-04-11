import type { MeshTransport } from "./Transport";
import type { RelayEnvelope, TransportPeer } from "../../types/domain";

export class DemoCompositeMeshTransport implements MeshTransport {
  private listeners = new Set<(envelope: RelayEnvelope) => void>();

  private peers: TransportPeer[] = [
    {
      id: "peer-arya",
      alias: "arya-phone",
      lastSeenAt: new Date().toISOString(),
      via: "bluetooth",
    },
    {
      id: "peer-rahul",
      alias: "rahul-android",
      lastSeenAt: new Date().toISOString(),
      via: "wifi-direct",
    },
  ];

  async start() {
    return;
  }

  async stop() {
    return;
  }

  getPeers() {
    return this.peers;
  }

  async send(envelope: RelayEnvelope) {
    setTimeout(() => {
      for (const listener of this.listeners) {
        listener({
          ...envelope,
          hopCount: envelope.hopCount + 1,
          ttl: Math.max(0, envelope.ttl - 1),
        });
      }
    }, 800);
  }

  onEnvelope(listener: (envelope: RelayEnvelope) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
