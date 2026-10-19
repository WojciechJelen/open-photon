import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * In dev, Nitro hands what a browser fetches for `<video>` and `<img>` (`Sec-Fetch-Dest: video`,
 * `image`, …) to Vite's static files, so `/media/*` never reached the app's route. Marking those
 * requests as documents keeps them on the app. Production has no Vite in front of the app.
 */
const mediaThroughApp: Plugin = {
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.startsWith("/media/")) {
        request.headers["sec-fetch-dest"] = "document";
      }

      next();
    });
  },
  name: "open-photon:media-through-app",
};

const config = defineConfig({
  plugins: [
    mediaThroughApp,
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: "node-server",
      traceDeps: ["@comfyorg/sdk*"],
    }),
    viteReact(),
  ],
  resolve: { tsconfigPaths: true },
  ssr: { external: ["@comfyorg/sdk"] },
});

export default config;
