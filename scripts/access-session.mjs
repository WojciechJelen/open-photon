import assert from "node:assert/strict";

export async function accessCookie(base) {
  const code = process.env.APP_ACCESS_CODE;

  if (!code) {
    return "";
  }

  const response = await fetch(`${base}/access`, {
    method: "POST",
    body: new URLSearchParams({ code }),
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(response.status, 303, "Access-code login must succeed");
  const cookie = response.headers.get("Set-Cookie");
  assert.ok(cookie, "Login must issue a session cookie");

  return cookie.split(";")[0];
}
