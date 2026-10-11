# OpenCode for Android

The desktop app's interface (`packages/app`) in an Android shell, the same way `packages/desktop` wraps it in
Electron. The phone runs no agent of its own: it connects to an opencode server on your computer, so sessions,
files, terminals and tools all run there.

## Install

Every push to `dev` builds a signed APK and publishes it to the `android-latest` release. Open that release on the
phone, download `opencode-android.apk` and install it. Later builds install over it.

## Connect to your computer

1. Install opencode on the computer.
2. Run `opencode pair --remote` there. It enables remote access through OpenTunnel and prints a pairing link and a
   QR code.
3. In the app, scan the QR code or paste the link. The app remembers the server.

Without `--remote`, `opencode pair` prints LAN addresses that work on the same Wi-Fi, or across networks with
Tailscale. The app can also connect with a server address and password (`opencode service get password`).

## How it fits together

- `src/entry.tsx` mounts the app like the web entry, with no built-in server, so it opens on the connect screen.
- `src/platform.ts` implements the app's `Platform` for Android: links open in the system browser, notifications
  use Android notifications while the app is in the background, and the back gesture walks the app's history.
- The WebView serves the app from `http://tauri.localhost`, an origin the opencode server already accepts, so no
  `--cors` flag is needed.
- `android/` is the Capacitor project. `app/sideload.keystore` signs builds when no `ANDROID_KEYSTORE_*` secrets are
  set; it is public, so it is fit only for installing your own builds.

## Build locally

Requires Java 21 and the Android SDK.

```bash
bun install
cd packages/android
bun run apk   # app/build/outputs/apk/release/app-release.apk
```

The root `bun.lock` is left as upstream has it, so run `bun install` without `--frozen-lockfile`.
