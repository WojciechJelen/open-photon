import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
  plugins: [
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
