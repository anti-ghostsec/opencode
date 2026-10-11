import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.antighostsec.opencode",
  appName: "OpenCode",
  webDir: "dist",
  server: {
    // The opencode server accepts CORS requests from the Tauri origins without any `--cors` flag, so the
    // shell serves the app from one of them. Plain http also lets the app reach http servers on the LAN or
    // Tailscale without mixed-content blocking, and *.localhost still counts as a secure context for the camera.
    androidScheme: "http",
    hostname: "tauri.localhost",
  },
  android: {
    // A phone keyboard and a remote server rarely need WebView debugging outside development builds.
    webContentsDebuggingEnabled: false,
  },
}

export default config
