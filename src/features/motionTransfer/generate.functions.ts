import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The server modules are loaded on the server only: a static import would pull SQLite and the
// SDK into the client bundle.

/**
 * What `/g/:id` shows, the origin its share link starts with, and whether the visitor has an
 * access session (`signedIn`); `null` for an id that names no generation. A Motion Transfer
 * generation comes as `readResult` reads it (`view: "motionTransfer"`), any other as
 * `readGenerationResult` does (`view: "outputs"`: a page renders it by the media of its outputs).
 * Server functions pass the access guard, so this checks access itself: a generation's page needs
 * a session unless it is a pre-rendered sample; without one, the browser goes to the code form,
 * which returns to the page.
 */
export const loadResult = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readSession } = await import("#/shared/server/access.server");
    const { accessUrl } = await import("#/shared/server/access-page.server");
    const { readResult } = await import("#/features/motionTransfer/server/generate");
    const { readGenerationResult } = await import("#/shared/server/generation/pages");
    const { publicOrigin } = await import("#/shared/server/public-origin");
    const signedIn = readSession(getRequest()) !== null;
    const motionTransfer = readResult(data, signedIn);
    const other = motionTransfer ? null : readGenerationResult(data);

    const result = motionTransfer
      ? { ...motionTransfer, view: "motionTransfer" as const }
      : other && { ...other, view: "outputs" as const };

    if (result && !result.prerendered && !signedIn) {
      throw redirect({ href: accessUrl(`/g/${result.generation.id}`), reloadDocument: true });
    }

    return result && { ...result, origin: publicOrigin(getRequest().url), signedIn };
  });

/**
 * What the share page `/r/:slug` shows; `null` for a slug no done generation has. A Motion
 * Transfer generation comes as `readShare` reads it (`view: "motionTransfer"`), any other as
 * `readGenerationShare` does (`view: "outputs"`).
 */
export const loadShare = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readShare } = await import("#/features/motionTransfer/server/share");
    const { readGenerationShare } = await import("#/shared/server/generation/pages");
    const { publicOrigin } = await import("#/shared/server/public-origin");
    const origin = publicOrigin(getRequest().url);
    const motionTransfer = readShare(data, origin);
    const other = motionTransfer ? null : readGenerationShare(data, origin);

    return motionTransfer
      ? { ...motionTransfer, view: "motionTransfer" as const }
      : other && { ...other, view: "outputs" as const };
  });
