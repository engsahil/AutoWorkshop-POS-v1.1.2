export function uid(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  const base = `${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36)}`;
  return prefix ? `${prefix}_${base}` : base;
}

export function opId(): string {
  return uid('op');
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 250) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
