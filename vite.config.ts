import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * In dev, Nitro can hand media requests and the root setup.md to Vite's static files before
 * their app handlers. Mark them as documents so their headers and access policy match production.
 */
const filesThroughApp: Plugin = {
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.startsWith("/media/") || request.url?.split("?")[0] === "/setup.md") {
        request.headers["sec-fetch-dest"] = "document";
      }

      next();
    });
  },
  name: "open-photon:files-through-app",
};

// The dev server's port: `PORT` from the environment or `.env` (default 3030), so worktrees run
// side by side. The built server reads `PORT` itself at runtime.
const config = defineConfig(({ mode }) => ({
  plugins: [
    filesThroughApp,
    tailwindcss(),
    tanstackStart(),
    nitro({
      // Run in order before the server listens: bad Comfy config stops the process
      // (`comfy-boot.ts`); then the database is opened, migrated and seeded (`src/app/boot.ts`).
      plugins: ["./src/shared/server/comfy-boot.ts", "./src/app/boot.ts"],
      preset: "node-server",
      traceDeps: ["@comfyorg/sdk*"],
    }),
    viteReact(),
  ],
  resolve: { tsconfigPaths: true },
  server: { port: Number(loadEnv(mode, process.cwd(), "").PORT || 3030) },
  ssr: { external: ["@comfyorg/sdk"] },
}));

export default config;
