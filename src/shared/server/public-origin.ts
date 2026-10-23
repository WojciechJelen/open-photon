/**
 * The origin absolute links (Open Graph tags, share links) start with: `PUBLIC_APP_URL` when set,
 * which a deployment behind a proxy needs, else the origin of the request being served
 * (`requestUrl`).
 */
export function publicOrigin(requestUrl: string) {
  return new URL(process.env.PUBLIC_APP_URL ?? requestUrl).origin;
}

/**
 * `GET /api/share-origin`: `shareOriginSchema`, the `publicOrigin` of the request, so a page
 * builds a published generation's share link as the server does. Not public: the access guard
 * answers 401 without a session.
 */
export function handleShareOrigin(request: Request) {
  return Response.json({ origin: publicOrigin(request.url) });
}
