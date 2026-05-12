import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    allowedHosts: true,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/html/index.html"),
        jarvis: resolve(__dirname, "src/html/jarvis.html"),
        admin: resolve(__dirname, "src/html/admin.html"),
      },
    },
  },
});
