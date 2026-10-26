// Hue sends the browser here after sign-in (the callback URL registered with Hue). We hand the
// code back to the app, which swaps it for tokens through /api/hue/token.

/** The app's deep link (scheme in app.json, screen src/app/away.tsx). */
const APP_RETURN = 'huelab://away';

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const back = new URL(APP_RETURN);
  for (const k of ['code', 'state', 'error']) {
    const v = params.get(k);
    if (v) back.searchParams.set(k, v);
  }
  const href = back.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // Redirect at once, with a button in case the browser asks before opening an app.
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${href}">
<title>Back to the app</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;font-family:system-ui,sans-serif">
<a href="${href}" style="color:#050506;background:#E9CF9F;padding:16px 28px;border-radius:26px;text-decoration:none;font-size:16px">Back to the app</a>
</body>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
