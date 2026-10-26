/**
 * Sync boundary — deliberately not implemented.
 *
 * Servixa is offline-first: every record lives in the browser's IndexedDB and
 * nothing is uploaded. There is no server, no database and no synchronization
 * in this release, by design.
 *
 * The endpoint exists so the client and deployments have a stable, honest
 * answer instead of a broken request:
 *
 *   GET  /api/sync  -> 200 { available: false, mode: 'local-only' }
 *   POST /api/sync  -> 501, always, with `accepted: 0`
 *
 * It must never imply that a record was stored remotely.
 */
export const config = { runtime: 'edge' };

const LOCAL_ONLY =
  'Servixa runs local-only in this release. All data stays in this browser; there is no server or sync service. Export a backup to move data to another device.';

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return json({ ok: false, available: false, mode: 'local-only', message: LOCAL_ONLY }, 200);
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }
  return json({ ok: false, code: 'SYNC_NOT_AVAILABLE', accepted: 0, message: LOCAL_ONLY }, 501);
}
