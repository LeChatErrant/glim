// Swaps a sign-in code, or a refresh token, for Hue Remote API tokens. Adds the client secret,
// which only this server knows. Hue's reply is passed through as is.

type Grant = { code?: string; refresh_token?: string };

export async function POST(request: Request) {
  const clientId = process.env.HUE_CLIENT_ID;
  const secret = process.env.HUE_CLIENT_SECRET;
  if (!clientId || !secret) return Response.json({ error: 'not_configured' }, { status: 503 });
  const grant = (await request.json().catch(() => ({}))) as Grant;
  const form = new URLSearchParams();
  if (grant.code) {
    form.set('grant_type', 'authorization_code');
    form.set('code', grant.code);
  } else if (grant.refresh_token) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', grant.refresh_token);
  } else {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const res = await fetch('https://api.meethue.com/v2/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
