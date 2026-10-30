import { cn } from "cn";

import { Hud } from "#/shared/components/brand";
import { comfyMark, comfyWordmark, runpodLogo } from "#/shared/partner-logos";

// Taller than the logo it holds, without pushing the row: a 44 px target around a 17 px mark.
const logoLink =
  "-my-3.5 inline-flex items-center gap-1.5 rounded-md py-3.5 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** "Powered by" and the partners' logos, each a link: the home page's hero and every footer. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 text-soft-foreground", className)}
    >
      <Hud>Powered by</Hud>
      <a aria-label="Comfy" className={logoLink} href="https://www.comfy.org">
        <svg
          aria-hidden="true"
          className="shrink-0"
          fill="currentColor"
          fillRule="evenodd"
          height="17"
          viewBox="0 0 24 24"
          width="17"
        >
          <path d={comfyMark} />
        </svg>
        <svg
          aria-hidden="true"
          className="shrink-0"
          fill="currentColor"
          fillRule="evenodd"
          height="15"
          viewBox="0 0 83 24"
          width="52"
        >
          <path d={comfyWordmark} />
        </svg>
      </a>
      <a aria-label="Runpod" className={logoLink} href="https://www.runpod.io">
        <svg
          aria-hidden="true"
          className="shrink-0"
          fill="currentColor"
          height="17"
          viewBox="0 0 594 130"
          width="78"
        >
          {runpodLogo.map((path) => (
            <path clipRule="evenodd" d={path} fillRule="evenodd" key={path} />
          ))}
        </svg>
      </a>
    </div>
  );
}
