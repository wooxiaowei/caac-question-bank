import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8010",
      "/question-bank.json": "http://127.0.0.1:8010"
    }
  },
  build: {
    outDir: "dist",
    assetsDir: "app-assets",
    emptyOutDir: true
  }
});
