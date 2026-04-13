export function normalizePhoneNumber(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return `${hasPlus ? "+" : "+"}${digits}`;
}

export function formatPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) {
    return "";
  }

  const digits = normalized.slice(1);
  if (digits.length <= 3) {
    return normalized;
  }
  if (digits.length <= 7) {
    return `+${digits.slice(0, digits.length - 4)} ${digits.slice(-4)}`;
  }
  if (digits.length <= 10) {
    return `+${digits.slice(0, digits.length - 7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
  }

  return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
}

export function isLikelyPhoneNumber(value: string) {
  const normalized = normalizePhoneNumber(value);
  return normalized.length >= 8;
}
