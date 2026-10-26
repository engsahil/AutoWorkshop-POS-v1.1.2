/**
 * Minimal read-only ZIP reader, just enough for .xlsx.
 *
 * Uses the browser's own DecompressionStream('deflate-raw') — no third-party
 * zip library, no native code. Only the central directory is walked, and only
 * the entries the caller asks for are inflated.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, 0xffff + 22 + 64);
  for (let i = view.byteLength - 22; i >= view.byteLength - max && i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Not a readable ZIP container (no end-of-central-directory record).');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  if (count === 0xffff || ptr === 0xffffffff) {
    throw new Error('ZIP64 workbooks are not supported. Re-save the file as a normal .xlsx.');
  }
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.byteLength || view.getUint32(ptr, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const offset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, offset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .xlsx files. Save the sheet as CSV and import that instead.');
  }
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== LOCAL_SIG) throw new Error(`Damaged ZIP entry: ${entry.name}`);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method} in ${entry.name}.`);
}

export async function readZipText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const data = await extractZipEntry(bytes, entry);
  return new TextDecoder('utf-8').decode(data);
}
