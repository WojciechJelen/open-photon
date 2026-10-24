import { providerKind, uploadTimeoutMs } from "./comfy-provider.ts";
import { comfyTarget } from "./comfy-target.ts";

/**
 * A Nitro plugin (registered in `vite.config.ts`): it runs once as the server starts, before it
 * listens (the database is opened and seeded next, by `src/app/boot.ts`). Invalid Comfy config
 * throws here, so the process exits instead of failing a user's first Generate: the target, a
 * `COMFY_UPLOAD_TIMEOUT_MS` out of range, and `COMFY_PROVIDER=fake` in a production server
 * (`providerKind`).
 */
export default function checkComfyTarget() {
  const provider = providerKind(process.env);
  const { apiKey, baseUrl, kind } = comfyTarget();
  const uploadTimeout = uploadTimeoutMs(process.env);

  console.info(
    JSON.stringify({
      auth: apiKey ? "bearer" : "none",
      base: baseUrl,
      event: "comfy.target",
      provider,
      target: kind,
      upload_timeout_ms: uploadTimeout,
    }),
  );
}
