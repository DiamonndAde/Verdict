import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Solana web3.js expects a Node-style Buffer global in the browser.
      buffer: "buffer/",
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    // A few Solana deps read process.env / global.
    "process.env": {},
    global: "globalThis",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});
