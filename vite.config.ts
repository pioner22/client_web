import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const cleanId = id.replace(/\\/g, "/");
          if (cleanId.includes("node_modules")) return "vendor";
          if (cleanId.includes("/src/config/")) return "config";
          if (cleanId.includes("/src/pages/")) return "pages";
          if (cleanId.includes("/src/components/")) return "components";
          if (cleanId.includes("/src/helpers/")) return "helpers";
          if (cleanId.includes("/src/stores/")) return "stores";
          return undefined;
        },
      },
    },
  },
});
