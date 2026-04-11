import type { MeshTransport, TransportRuntimeContext } from "./Transport";
import type { RelayEnvelope, TransportConnectionState, TransportPeer } from "../../types/domain";

type RelayMessage =
  | {
      type: "join";
      eventId: string;
      userId: string;
      alias: string;
    }
  | {
      type: "presence";
      peers: TransportPeer[];
    }
  | {
      type: "envelope";
      envelope: RelayEnvelope;
    };

export class WebSocketRelayTransport implements MeshTransport {
  private socket?: WebSocket;
  private peers: TransportPeer[] = [];
  private envelopeListeners = new Set<(envelope: RelayEnvelope) => void>();
  private peerListeners = new Set<(peers: TransportPeer[]) => void>();
  private connectionListeners = new Set<(state: TransportConnectionState, error?: string) => void>();

  async start(context: TransportRuntimeContext) {
    if (!context.relayServerUrl.trim()) {
      this.emitConnection("error", "Set a relay URL before connecting.");
      return;
    }

    await this.stop();
    this.emitConnection("connecting");

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(context.relayServerUrl);
      this.socket = socket;

      socket.onopen = () => {
        this.emitConnection("connected");
        socket.send(
          JSON.stringify({
            type: "join",
            eventId: context.event.id,
            userId: context.user.id,
            alias: context.user.handle,
          } satisfies RelayMessage),
        );
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RelayMessage;

          if (message.type === "presence") {
            this.peers = message.peers;
            this.emitPeers();
            return;
          }

          if (message.type === "envelope") {
            for (const listener of this.envelopeListeners) {
              listener(message.envelope);
            }
          }
        } catch {
          this.emitConnection("error", "Received an invalid relay payload.");
        }
      };

      socket.onerror = () => {
        this.emitConnection("error", "Unable to reach the relay server.");
        resolve();
      };

      socket.onclose = () => {
        this.emitConnection("disconnected");
      };
    });
  }

  async stop() {
    this.socket?.close();
    this.socket = undefined;
  }

  getPeers() {
    return this.peers;
  }

  async send(envelope: RelayEnvelope) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay server is not connected.");
    }

    this.socket.send(
      JSON.stringify({
        type: "envelope",
        envelope,
      } satisfies RelayMessage),
    );
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

  onConnectionStateChanged(listener: (state: TransportConnectionState, error?: string) => void) {
    this.connectionListeners.add(listener);
    listener(this.socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected");
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
