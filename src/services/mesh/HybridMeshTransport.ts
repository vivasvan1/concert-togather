import type { MeshTransport, TransportRuntimeContext } from "./Transport";
import type { RelayEnvelope, TransportConnectionState, TransportPeer } from "../../types/domain";

function statePriority(state: TransportConnectionState) {
  switch (state) {
    case "connected":
      return 5;
    case "connecting":
      return 4;
    case "permission-required":
      return 3;
    case "disconnected":
      return 2;
    case "error":
      return 1;
    default:
      return 0;
  }
}

export class HybridMeshTransport implements MeshTransport {
  private envelopeListeners = new Set<(envelope: RelayEnvelope) => void>();
  private peerListeners = new Set<(peers: TransportPeer[]) => void>();
  private connectionListeners = new Set<(state: TransportConnectionState, error?: string) => void>();
  private peerState = new Map<string, TransportPeer[]>();
  private connectionState = new Map<string, { state: TransportConnectionState; error?: string }>();
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly transports: Array<{ key: string; transport: MeshTransport }>,
  ) {}

  async start(context: TransportRuntimeContext) {
    await this.stop();

    for (const { key, transport } of this.transports) {
      this.unsubscribers.push(
        transport.onEnvelope((envelope) => {
          for (const listener of this.envelopeListeners) {
            listener(envelope);
          }
        }),
      );
      this.unsubscribers.push(
        transport.onPeersChanged((peers) => {
          this.peerState.set(key, peers);
          this.emitPeers();
        }),
      );
      this.unsubscribers.push(
        transport.onConnectionStateChanged((state, error) => {
          this.connectionState.set(key, { state, error });
          this.emitConnection();
        }),
      );
    }

    await Promise.allSettled(
      this.transports.map(({ transport }) => transport.start(context)),
    );
    this.emitConnection();
    this.emitPeers();
  }

  async stop() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.peerState.clear();
    this.connectionState.clear();
    await Promise.allSettled(this.transports.map(({ transport }) => transport.stop()));
  }

  getPeers() {
    return this.mergePeers();
  }

  async send(envelope: RelayEnvelope) {
    const activeTransports = this.transports.filter(({ key }) => {
      const state = this.connectionState.get(key)?.state;
      return state === "connected" || state === "connecting";
    });
    const candidates = activeTransports.length > 0 ? activeTransports : this.transports;
    const results = await Promise.allSettled(
      candidates.map(({ transport }) => transport.send(envelope)),
    );

    if (results.some((result) => result.status === "fulfilled")) {
      return;
    }

    const firstRejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstRejected?.reason instanceof Error
      ? firstRejected.reason
      : new Error("No transport accepted the envelope.");
  }

  onEnvelope(listener: (envelope: RelayEnvelope) => void) {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  onPeersChanged(listener: (peers: TransportPeer[]) => void) {
    this.peerListeners.add(listener);
    listener(this.mergePeers());
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  onConnectionStateChanged(listener: (state: TransportConnectionState, error?: string) => void) {
    this.connectionListeners.add(listener);
    const current = this.getDerivedConnection();
    listener(current.state, current.error);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private mergePeers() {
    const merged = new Map<string, TransportPeer>();

    for (const peers of this.peerState.values()) {
      for (const peer of peers) {
        const key = peer.phoneNumber ?? peer.id;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, peer);
          continue;
        }

        merged.set(key, {
          ...existing,
          ...peer,
          via:
            existing.via === "nearby" || peer.via === "nearby"
              ? "nearby"
              : peer.via,
          lastSeenAt:
            new Date(existing.lastSeenAt).getTime() > new Date(peer.lastSeenAt).getTime()
              ? existing.lastSeenAt
              : peer.lastSeenAt,
        });
      }
    }

    return [...merged.values()].sort(
      (left, right) =>
        new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
    );
  }

  private emitPeers() {
    const peers = this.mergePeers();
    for (const listener of this.peerListeners) {
      listener(peers);
    }
  }

  private getDerivedConnection() {
    const states = [...this.connectionState.values()];
    if (states.length === 0) {
      return { state: "disconnected" as TransportConnectionState, error: undefined };
    }

    const best = [...states].sort(
      (left, right) => statePriority(right.state) - statePriority(left.state),
    )[0];
    const relevantStates =
      best.state === "connected" ? states.filter((item) => item.state === "connected") : states;
    const error = relevantStates
      .map((item) => item.error)
      .filter((item): item is string => Boolean(item))
      .join(" | ");

    return {
      state: best.state,
      error: error || undefined,
    };
  }

  private emitConnection() {
    const current = this.getDerivedConnection();
    for (const listener of this.connectionListeners) {
      listener(current.state, current.error);
    }
  }
}
