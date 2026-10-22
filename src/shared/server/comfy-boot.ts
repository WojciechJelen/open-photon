import { comfyTarget } from "./comfy-target.ts";

/**
 * A Nitro plugin (registered in `vite.config.ts`): it runs once as the server starts, before it
 * listens, while the app itself and its database load on the first request. Invalid Comfy config
 * throws here, so the process exits instead of failing a user's first Generate.
 */
export default function checkComfyTarget() {
  const { apiKey, baseUrl, kind } = comfyTarget();

  console.info(
    JSON.stringify({
      auth: apiKey ? "bearer" : "none",
      base: baseUrl,
      event: "comfy.target",
      target: kind,
    }),
  );
}
