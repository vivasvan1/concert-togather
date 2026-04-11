import type { RelayEnvelope, TransportPeer } from "../../types/domain";

export interface MeshTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPeers(): TransportPeer[];
  send(envelope: RelayEnvelope): Promise<void>;
  onEnvelope(listener: (envelope: RelayEnvelope) => void): () => void;
}
