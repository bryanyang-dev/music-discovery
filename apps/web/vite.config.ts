import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Local tape API started by `pnpm api:dev` (see apps/api/src/serve-api.cli.ts). */
const tapeApiOrigin = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    // Spotify accepts loopback redirect URIs only as 127.0.0.1, not localhost,
    // and the registered URI must match this port exactly.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": tapeApiOrigin },
  },
});
