/** FNV-1a, 32 bits. Short, dependency-free, and stable across reloads. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The mark target for a selection in an assistant message outside any document. */
export function messageTarget(messageText: string): string {
  return `msg:${hashText(messageText)}`;
}
