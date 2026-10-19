export function accessPage(message = "Enter the access code to use this private preview.") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access · Open Photon</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; background: #fafafa; color: #18181b; font: 16px/1.5 system-ui, sans-serif; }
    main { width: 100%; max-width: 400px; }
    .brand { font-weight: 600; font-size: 14px; }
    h1 { font-size: 30px; letter-spacing: -1px; margin: 24px 0 8px; }
    p { color: #52525b; margin: 0 0 28px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 8px; }
    input, button { width: 100%; border-radius: 8px; font: inherit; padding: 11px 14px; }
    input { border: 1px solid #d4d4d8; background: white; }
    input:focus { outline: 2px solid #71717a; outline-offset: 2px; }
    button { margin-top: 16px; border: 0; background: #18181b; color: white; cursor: pointer; font-weight: 500; }
    button:hover { background: #3f3f46; }
    small { display: block; color: #71717a; margin-top: 18px; }
  </style>
</head>
<body>
  <main>
    <div class="brand">Open Photon</div>
    <h1>Private preview</h1>
    <p role="status">${message}</p>
    <form method="post" action="/access">
      <label for="code">Access code</label>
      <input id="code" name="code" type="password" autocomplete="current-password" required maxlength="256">
      <button type="submit">Continue</button>
    </form>
    <small>Access lasts 12 hours. Ask the owner for a code.</small>
  </main>
</body>
</html>`;
}
