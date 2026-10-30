import { comfyMark, comfyWordmark, runpodLogo } from "../partner-logos.ts";

/** `/access`, with `next` naming the page to return to after the code unless that is `/`. */
export function accessUrl(next: string) {
  // `encodeURIComponent` escapes every character that could end an HTML attribute.
  return next === "/" ? "/access" : `/access?next=${encodeURIComponent(next)}`;
}

/** What the page shows: its stills' URLs and the built stylesheet's (`src/start.ts`). */
export type AccessArt = { stills: readonly string[]; stylesheet: string };

const brandLogo = `<svg aria-hidden="true" class="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5"></circle><circle class="fill-brand" cx="12" cy="12" r="4"></circle><circle class="fill-brand-2" cx="19.1" cy="4.9" r="2"></circle></svg>`;

const poweredBy = `<div class="flex flex-wrap items-center gap-x-6 gap-y-3 text-soft-foreground">
  <span class="hud text-muted-foreground">Powered by</span>
  <span class="inline-flex items-center gap-1.5">
    <svg role="img" aria-label="Comfy" class="shrink-0" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="${comfyMark}"></path></svg>
    <svg aria-hidden="true" class="shrink-0" width="52" height="15" viewBox="0 0 83 24" fill="currentColor" fill-rule="evenodd"><path d="${comfyWordmark}"></path></svg>
  </span>
  <svg role="img" aria-label="Runpod" class="shrink-0" width="78" height="17" viewBox="0 0 594 130" fill="currentColor">${runpodLogo.map((d) => `<path d="${d}" fill-rule="evenodd" clip-rule="evenodd"></path>`).join("")}</svg>
</div>`;

/**
 * The code form, rendered without React (a server-rendered string, so it works with no script):
 * the app's stylesheet gives it the design's classes, and its stills fill the side. It posts back
 * to `/access`, keeping `next`. With `error` (a wrong code), that replaces the intro.
 */
export function accessPage(next: string, art?: AccessArt, error?: string) {
  const message = error ?? "Upload your own clips and start rendering.";

  const stills = (art?.stills ?? [])
    .map(
      (still) =>
        `<div class="relative overflow-hidden"><img alt="" class="absolute inset-0 size-full object-cover" src="${still}"></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09080d">
  <title>Access · Open Photon</title>
  ${art ? `<link rel="stylesheet" href="${art.stylesheet}">` : ""}
</head>
<body>
  <div class="flex min-h-svh flex-wrap">
    <div aria-hidden="true" class="grid min-h-80 flex-[1_1_30rem] grid-cols-3 gap-0.5 bg-screen">${stills}</div>
    <main class="flex min-w-0 flex-[1_1_30rem] flex-col justify-between gap-12 px-[clamp(1.5rem,6vw,6rem)] py-10">
      <a class="inline-flex h-11 w-fit items-center gap-2.5 rounded-md font-display text-lg font-bold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring" href="/">${brandLogo}Open Photon</a>
      <div class="flex w-full max-w-100 flex-col gap-6">
        <div class="flex flex-col gap-2.5">
          <h1 class="font-display text-[40px] leading-[1.08] font-bold tracking-display">Enter your access code</h1>
          <p class="text-base text-soft-foreground" role="status">${message}</p>
        </div>
        <form class="flex flex-col gap-6" method="post" action="${accessUrl(next)}">
          <div class="flex min-w-0 flex-col gap-2">
            <label class="text-[13px] font-medium text-soft-foreground" for="code">Access code</label>
            <input class="h-11 w-full rounded-field border border-input bg-field px-3.5 text-[15px] text-foreground outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/20" id="code" name="code" type="password" autocomplete="one-time-code" required maxlength="256">
            <span class="text-[12.5px] text-muted-foreground">Ask the owner for a code.</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <button class="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold tracking-[-0.005em] text-primary-foreground transition-colors hover:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring" type="submit">Continue</button>
            <a class="inline-flex h-11 w-full items-center justify-center rounded-full px-5 text-sm font-semibold tracking-[-0.005em] text-soft-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring" href="/explore">Browse the samples</a>
          </div>
        </form>
      </div>
      ${poweredBy}
    </main>
  </div>
</body>
</html>`;
}
