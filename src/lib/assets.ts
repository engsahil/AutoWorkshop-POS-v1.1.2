const base = import.meta.env.BASE_URL || '/';

export const DEFAULT_LOGIN_ART = `${base}img/login-art.jpg`;
export const DEFAULT_HERO_ART = `${base}img/hero-car.jpg`;
export const DEFAULT_SETUP_ART = `${base}img/setup-art.jpg`;

export function assetUrl(path: string | null | undefined, fallback: string): string {
  return path || fallback;
}

/** Max accepted upload size before compression (raw File). */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export interface ImagePickOptions {
  /** Longest edge in pixels after resize. */
  maxEdge?: number;
  /** JPEG/WebP quality for photographic art. */
  quality?: number;
  /** Keep transparency (logos) by encoding PNG instead of JPEG. */
  preserveAlpha?: boolean;
}

/**
 * Reads an image file, downsizes it on a canvas and returns a data URL that is
 * small enough to live comfortably inside IndexedDB and JSON backups.
 * Throws a user-readable error for unsupported or oversized files.
 */
export async function fileToDataUrl(file: File, opts: ImagePickOptions = {}): Promise<string> {
  const { maxEdge = 1600, quality = 0.86, preserveAlpha = false } = opts;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    throw new Error('Choose a PNG, JPG or WebP image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('That image is larger than 6 MB. Pick a smaller file or compress it first.');
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('The image could not be decoded.'));
    el.src = raw;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const type = preserveAlpha && file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(type, quality);
}
