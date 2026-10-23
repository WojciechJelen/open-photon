/**
 * The origin absolute links (Open Graph tags, share links) start with: `PUBLIC_APP_URL` when set,
 * which a deployment behind a proxy needs, else the origin of the request being served
 * (`requestUrl`).
 */
export function publicOrigin(requestUrl: string) {
  return new URL(process.env.PUBLIC_APP_URL ?? requestUrl).origin;
}
