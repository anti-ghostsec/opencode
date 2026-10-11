// @refresh reload

import "@/runtime/polyfills"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { loadInitialLocale } from "@/runtime/i18n/language"
import { PlatformProvider } from "@/runtime/platform/platform"
import { PwaRoutePersistence, restorePwaRoute } from "@/runtime/platform/pwa"
import { KeyboardInsets } from "@/runtime/platform/keyboard"
import pkg from "../package.json"
import { createAndroidPlatform, startBackButton } from "./platform"

const root = document.getElementById("root")

const platform = createAndroidPlatform(pkg.version)

startBackButton()

if (root instanceof HTMLElement && root.dataset.opencodeMounted === undefined) {
  root.dataset.opencodeMounted = ""
  void loadInitialLocale().then((locale) => {
    // The app runs full screen like an installed PWA, so it reopens on the last session the same way.
    root.dataset.standalone = "true"
    restorePwaRoute()

    // The bundled app has no server of its own; servers are added on the connect screen by pairing link,
    // QR code or address and password, and the app remembers them.
    render(
      () => (
        <PlatformProvider value={platform}>
          <AppBaseProviders locale={locale}>
            <AppInterface servers={[]}>
              <KeyboardInsets />
              <PwaRoutePersistence />
            </AppInterface>
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
  })
}
