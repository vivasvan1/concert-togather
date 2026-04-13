import {
  getConcertNearbyMeshModule,
  isConcertNearbyMeshAvailable,
} from "./ConcertNearbyMeshModule";
import type { MeshTransport, TransportRuntimeContext } from "./Transport";
import type {
  RelayEnvelope,
  TransportConnectionState,
  TransportPeer,
} from "../../types/domain";

export class AndroidNearbyTransport implements MeshTransport {
  private peers: TransportPeer[] = [];
  private envelopeListeners = new Set<(envelope: RelayEnvelope) => void>();
  private peerListeners = new Set<(peers: TransportPeer[]) => void>();
  private connectionListeners = new Set<
    (state: TransportConnectionState, error?: string) => void
  >();
  private subscriptions: Array<{ remove(): void }> = [];

  static isAvailable() {
    return isConcertNearbyMeshAvailable();
  }

  async start(context: TransportRuntimeContext) {
    const module = getConcertNearbyMeshModule();

    if (!module || !module.isAvailable()) {
      this.emitConnection(
        "error",
        "Android nearby transport is unavailable in this build. Use an APK or dev build, not Expo Go.",
      );
      return;
    }

    await this.stop();

    this.subscriptions = [
      // JS subscribes to normalized native events and re-emits them through the shared transport interface.
      module.addListener("onConnectionStateChanged", (event) => {
        const errorMessage =
          typeof event.statusCode === "number" && event.error
            ? `${event.error} (code ${event.statusCode})`
            : event.error;
        this.emitConnection(event.state, errorMessage);
      }),
      module.addListener("onPeersChanged", (event) => {
        this.peers = event.peers;
        this.emitPeers();
      }),
      module.addListener("onEnvelope", (event) => {
        try {
          const envelope = JSON.parse(event.envelopeJson) as RelayEnvelope;
          for (const listener of this.envelopeListeners) {
            listener(envelope);
          }
        } catch {
          console.warn("[ConcertNearbyMesh] invalid envelope payload");
          this.emitConnection("error", "Received an invalid nearby envelope.");
        }
      }),
    ];

    console.info(
      "[ConcertNearbyMesh] startSession",
      context.event.id,
      context.user.phoneNumberDisplay,
    );
    await module.startSession(
      context.event.id,
      context.user.id,
      context.user.phoneNumberDisplay,
    );
  }

  async stop() {
    const module = getConcertNearbyMeshModule();

    for (const subscription of this.subscriptions) {
      subscription.remove();
    }
    this.subscriptions = [];

    this.peers = [];
    this.emitPeers();

    if (module?.isAvailable()) {
      await module.stopSession();
    }
  }

  getPeers() {
    return this.peers;
  }

  async send(envelope: RelayEnvelope) {
    const module = getConcertNearbyMeshModule();

    if (!module || !module.isAvailable()) {
      throw new Error("Android nearby transport is unavailable in this build.");
    }

    console.info("[ConcertNearbyMesh] sendEnvelope", envelope.id);
    await module.sendEnvelope(JSON.stringify(envelope));
  }

  onEnvelope(listener: (envelope: RelayEnvelope) => void) {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  onPeersChanged(listener: (peers: TransportPeer[]) => void) {
    this.peerListeners.add(listener);
    listener(this.peers);
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  onConnectionStateChanged(
    listener: (state: TransportConnectionState, error?: string) => void,
  ) {
    this.connectionListeners.add(listener);
    listener("disconnected");
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
