/**
 * Deployment health probe.
 *
 * Reports only what this deployment can observe: the function ran and the app
 * is local-only. It never claims a database or sync service exists.
 */
export const config = { runtime: 'edge' };

export default async function handler(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      service: 'servixa',
      version: '1.1.2',
      mode: 'local-only',
      syncConfigured: false,
      time: new Date().toISOString()
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
