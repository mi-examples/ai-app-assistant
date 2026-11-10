function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 16 digits: epoch millis + 3 random digits (MI Concierge format). */
export function newConversationTs(): string {
  const digits = Array.from(randomBytes(3), (b) => b % 10).join('');

  return `${Date.now()}${digits}`;
}

/** 32 lowercase hex characters. */
export function newMessageUid(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}
