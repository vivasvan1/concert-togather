// Each transport implementation plugs into the app through this contract so the
// state layer does not care whether messages arrived via demo, relay, or nearby radios.
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
