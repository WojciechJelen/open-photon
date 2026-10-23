/** `/access`, with `next` naming the page to return to after the code unless that is `/`. */
export function accessUrl(next: string) {
  // `encodeURIComponent` escapes every character that could end an HTML attribute.
  return next === "/" ? "/access" : `/access?next=${encodeURIComponent(next)}`;
}

/**
 * The code form; it posts back to `/access`, keeping `next`. With `error` (a wrong code), that
 * replaces the intro and the line about links that carry a code is left out.
 */
export function accessPage(next: string, error?: string) {
  const message =
    error ??
    "Browsing the samples is open to anyone. Enter an access code to upload your own clips and generate.";

  const link = error ? "" : " Opened a link that already contains a code? You're in.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access · Open Photon</title>
  <style>
    * { box-sizing: border-box; }
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; background: #09080d; color: #f4f2f8; font: 16px/1.5 system-ui, sans-serif; }
    main { width: 100%; max-width: 400px; }
    .brand { font-weight: 700; font-size: 15px; }
    h1 { font-size: 30px; letter-spacing: -0.5px; margin: 24px 0 8px; }
    p { color: #bdb7cb; margin: 0 0 28px; }
    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    input, button { width: 100%; min-height: 48px; border-radius: 12px; font: inherit; padding: 11px 14px; }
    input { border: 1px solid rgba(255, 255, 255, 0.14); background: #0f0d15; color: #f4f2f8; }
    input:focus { outline: 2px solid #a68bff; outline-offset: 2px; }
    button { margin-top: 16px; border: 0; border-radius: 999px; background: #f3eeff; color: #0b0910; cursor: pointer; font-weight: 600; }
    button:hover { background: #ffffff; }
    button:focus-visible { outline: 2px solid #a68bff; outline-offset: 3px; }
    small { display: block; color: #8e889c; margin-top: 18px; }
    a { color: #bdb7cb; }
    a:hover { color: #f4f2f8; }
  </style>
</head>
<body>
  <main>
    <div class="brand">Open Photon</div>
    <h1>Access code</h1>
    <p role="status">${message}</p>
    <form method="post" action="${accessUrl(next)}">
      <label for="code">Access code</label>
      <input id="code" name="code" type="password" autocomplete="one-time-code" required maxlength="256">
      <button type="submit">Continue</button>
    </form>
    <small>Access lasts 12 hours. Ask the owner for a code.${link} <a href="/motionTransfer">Browse the samples</a></small>
  </main>
</body>
</html>`;
}
