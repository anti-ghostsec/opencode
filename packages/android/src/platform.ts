import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { LocalNotifications } from "@capacitor/local-notifications"
import type { Platform } from "@opencode/app"
import { createBrowserDraftStore } from "@/runtime/persistence/drafts"

// The phone is a remote client like the browser, so the app treats it as the web platform and only the
// operations a WebView cannot do on its own go through native plugins.
export function createAndroidPlatform(version: string) {
  const handlers = new Map<number, () => void>()
  let nextID = 1
  let foreground = true

  void App.addListener("appStateChange", (state) => {
    foreground = state.isActive
  })

  void LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const id = event.notification.id
    handlers.get(id)?.()
    handlers.delete(id)
  })

  const platform: Platform = {
    platform: "web",
    draftStore: createBrowserDraftStore(),
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)

      if (url.protocol === "mailto:") {
        window.location.href = url.href
        return
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") return
      void Browser.open({ url: url.href })
    },
    restart: async () => window.location.reload(),
    async notify(title, description, onClick) {
      if (foreground) return

      const permission = await LocalNotifications.checkPermissions()
      const display =
        permission.display === "granted" ? "granted" : (await LocalNotifications.requestPermissions()).display

      if (display !== "granted") return
      const id = nextID++

      if (onClick) handlers.set(id, onClick)
      await LocalNotifications.schedule({ notifications: [{ id, title, body: description ?? "" }] })
    },
    async writeClipboardText(text) {
      await navigator.clipboard.writeText(text)
    },
  }

  return platform
}

// Android's back gesture walks the app's history first and only leaves the app from its first page.
export function startBackButton() {
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) return window.history.back()
    void App.minimizeApp()
  })
}
