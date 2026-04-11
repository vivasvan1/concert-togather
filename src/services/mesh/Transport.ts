import type {
  EventRecord,
  RelayEnvelope,
  TransportConnectionState,
  TransportPeer,
  UserIdentity,
} from "../../types/domain";

export interface TransportRuntimeContext {
  event: EventRecord;
  user: UserIdentity;
  relayServerUrl: string;
}

export interface MeshTransport {
  start(context: TransportRuntimeContext): Promise<void>;
  stop(): Promise<void>;
  getPeers(): TransportPeer[];
  send(envelope: RelayEnvelope): Promise<void>;
  onEnvelope(listener: (envelope: RelayEnvelope) => void): () => void;
  onPeersChanged(listener: (peers: TransportPeer[]) => void): () => void;
  onConnectionStateChanged(
    listener: (state: TransportConnectionState, error?: string) => void,
  ): () => void;
}
