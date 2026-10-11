import { defineConfig } from "vite"
import appPlugin from "@opencode/app/vite"

export default defineConfig({
  plugins: [appPlugin],
  // Shares the web app's favicons, theme preload script and static assets.
  publicDir: "../app/public",
  server: {
    host: "0.0.0.0",
    port: 3010,
  },
  build: {
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: false,
  },
})
