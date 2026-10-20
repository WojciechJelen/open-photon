import assert from "node:assert/strict";

/**
 * Signs in at `base` with `ACCESS_CODE` (a code `scripts/mint-code.mjs` minted on that
 * deployment's database) and returns the session cookie as a `Cookie` header value.
 */
export async function accessCookie(base) {
  const code = process.env.ACCESS_CODE;

  assert.ok(code, "Set ACCESS_CODE to a code minted with scripts/mint-code.mjs on that database");

  const response = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(response.status, 204, "Access-code login must succeed");
  const cookie = response.headers.get("Set-Cookie");
  assert.ok(cookie, "Login must issue a session cookie");

  return cookie.split(";")[0];
}
