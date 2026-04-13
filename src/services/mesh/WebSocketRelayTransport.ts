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
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private context?: TransportRuntimeContext;
  private peers: TransportPeer[] = [];
  private envelopeListeners = new Set<(envelope: RelayEnvelope) => void>();
  private peerListeners = new Set<(peers: TransportPeer[]) => void>();
  private connectionListeners = new Set<(state: TransportConnectionState, error?: string) => void>();

  async start(context: TransportRuntimeContext) {
    if (!context.relayServerUrl.trim()) {
      this.context = context;
      this.stopped = false;
      this.peers = [];
      this.emitPeers();
      this.emitConnection("disconnected");
      return;
    }

    await this.stop();
    this.context = context;
    this.stopped = false;
    this.connect();
  }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    this.peers = [];
    this.emitPeers();
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

  private connect() {
    const context = this.context;
    if (!context || this.stopped || !context.relayServerUrl.trim()) {
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.emitConnection("connecting");

    const socket = new WebSocket(context.relayServerUrl);
    this.socket = socket;

    socket.onopen = () => {
      this.emitConnection("connected");
      socket.send(
        JSON.stringify({
          type: "join",
          eventId: context.event.id,
          userId: context.user.id,
          alias: context.user.phoneNumberDisplay,
        } satisfies RelayMessage),
      );
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
    };

    socket.onclose = () => {
      this.socket = undefined;
      this.peers = [];
      this.emitPeers();
      if (this.stopped) {
        this.emitConnection("disconnected");
        return;
      }

      this.emitConnection("connecting", "Waiting for internet relay.");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 3000);
  }
}
