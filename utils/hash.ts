const encoder = new TextEncoder();

// FNV-1a 32-bit hash for fast content staleness checks.
export function hashContent(content: string): string {
  const bytes = encoder.encode(content);
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
