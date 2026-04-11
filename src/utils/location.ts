import type { PeerLocationHint } from "../types/domain";

export function getFriendLocationSummary(hint?: PeerLocationHint) {
  if (!hint) {
    return "No concert signal yet";
  }

  if (hint.proximity && hint.proximity.confidence > 0.72) {
    return `Likely ${hint.proximity.estimate.replace("-", " ")} to you`;
  }

  if (hint.meetupSpot) {
    return `Heading to ${hint.meetupSpot}`;
  }

  if (hint.gps) {
    return `GPS fix ±${Math.round(hint.gps.accuracyMeters)}m`;
  }

  return "Waiting for a fresh update";
}
