// Server side of "Control from anywhere" (EAS Hosting): sends the browser to Hue's sign-in page.
// HUE_CLIENT_ID and HUE_CLIENT_SECRET live in the server's environment, never in the app.

export function GET(request: Request) {
  const clientId = process.env.HUE_CLIENT_ID;
  if (!clientId) return new Response('Cloud access is not set up on this server.', { status: 503 });
  const state = new URL(request.url).searchParams.get('state') ?? '';
  const url = new URL('https://api.meethue.com/v2/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return Response.redirect(url.toString(), 302);
}
