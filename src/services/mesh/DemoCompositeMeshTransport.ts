import type { MeshTransport, TransportRuntimeContext } from "./Transport";
import type { RelayEnvelope, TransportConnectionState, TransportPeer } from "../../types/domain";

export class DemoCompositeMeshTransport implements MeshTransport {
  private listeners = new Set<(envelope: RelayEnvelope) => void>();
  private peerListeners = new Set<(peers: TransportPeer[]) => void>();
  private connectionListeners = new Set<(state: TransportConnectionState, error?: string) => void>();

  private peers: TransportPeer[] = [
    {
      id: "peer-arya",
      alias: "+1 415 555 0101",
      lastSeenAt: new Date().toISOString(),
      via: "bluetooth",
    },
    {
      id: "peer-rahul",
      alias: "+1 415 555 0102",
      lastSeenAt: new Date().toISOString(),
      via: "wifi-direct",
    },
  ];

  async start(_context: TransportRuntimeContext) {
    this.emitConnection("connected");
    this.emitPeers();
    return;
  }

  async stop() {
    this.emitConnection("disconnected");
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

  onPeersChanged(listener: (peers: TransportPeer[]) => void) {
    this.peerListeners.add(listener);
    listener(this.peers);
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  onConnectionStateChanged(listener: (state: TransportConnectionState, error?: string) => void) {
    this.connectionListeners.add(listener);
    listener("connected");
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private emitPeers() {
    for (const listener of this.peerListeners) {
      listener(this.peers);
    }
  }

  private emitConnection(state: TransportConnectionState, error?: string) {
    for (const listener of this.connectionListeners) {
      listener(state, error);
    }
  }
}
