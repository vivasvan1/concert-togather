export function formatTimeLabel(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function minutesAgo(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

