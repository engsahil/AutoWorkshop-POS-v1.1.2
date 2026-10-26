const listeners = new Set<() => void>();

/** Signals that local data changed so visible lists can refresh. */
export function bump(): void {
  for (const l of listeners) l();
}

export function onBump(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
