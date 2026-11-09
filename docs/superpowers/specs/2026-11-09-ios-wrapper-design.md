# iOS wrapper for claudecodeui

## Goal

A native iOS app that wraps this web app, so that:

- new web builds reach the phone without clearing a cache by hand;
- the interface starts instantly from assets already on disk, including offline;
- dictation works the way it does in vvterm, talking directly to the mema server on the PC.

## Non-goals

- Tabs.
- Offline chat data. Chats still need the server.
- Keeping unsent text across closing or backgrounding the app. The user wants what they typed, for
  example to start a new conversation, to be there on reopening. That is a goal for a later plan.
- App Store or TestFlight distribution.
- Replacing the web app's behaviour in Safari or on desktop.

## Decisions

Made by the user:

- Fork `Kyome22/Telescopure` (MIT) and add `ios-ota-deploy` to the new app. It is a minimal browser
  with navigation already built.
- Dictation has "the same UX" as vvterm and "talks directly to my mema server in the PC". Fonos is
  not used. Rationale: one dictation experience across the user's apps.
- Dictation audio is uploaded as m4a, as Fonos does. There is no Apple Speech fallback.
- A failed transcription keeps the recording in permanent storage, and a red bar offers retry.
- ntfy replaces Web Push, which does not work in a WKWebView.
- No tabs for now. A single-app wrapper does not need them.
- New web builds download in the background, then a tap applies them. A chat is never reloaded
  without the user asking.
- Browser UI is hidden and summonable, so the app fills the screen and navigation stays available.
- Server URL is fixed in the build: `https://claude.chiq.me`. Rationale: one server to target.

Defaults proposed by Claude, awaiting confirmation in this review:

- **Cache architecture:** approach A below, native files served from a custom scheme.
- **Naming:** repo `~/c/third-parties/cloudcli-ios`, app name `CloudCLI`, scheme `cloudcli`.

## Facts checked

- Server CORS is open: `server/index.ts:131`, `cors({ exposedHeaders: [...] })`.
- Auth is a bearer token in `localStorage` under `auth-token` (`AuthContext.tsx:17`).
- WebSocket URLs are built from `window.location` (`WebSocketContext.tsx:53-60`,
  `shell/utils/socket.ts:47-59`), and the app also uses `EventSource` and relative `fetch`.
- `server/index.ts:216-225` sends `max-age=31536000, immutable` for every `.js`, `.css`, image and
  font file, hashed or not.
- Service worker registration is guarded by `'serviceWorker' in navigator` (`src/main.tsx:20`,
  `useWebPush.ts:30`).
- Web Push is sent from `notification-orchestrator.service.js:181`.
- vvterm's mema client posts a 16 kHz mono WAV to `<base>/v1/transcribe` as multipart, with a
  Keychain bearer token. It probes first and retries 503 responses that carry `Retry-After`.
- Fonos records 16 kHz audio and encodes it as AAC at 48 kbps in an m4a container
  (`AudioCaptureService.swift:54`, `AudioCaptureWAVCodec.swift:125-139`), uploaded as `audio/mp4`.
- Mema's `/v1/transcribe` takes an uploaded file and converts it with ffmpeg (`server/app.py:185-231`).
- The web app's server reads `VOICE_API_BASE_URL` and `VOICE_API_KEY` (`voice.module.ts:16-17`).
- Telescopure creates its web view in one place, `WebView(configuration: .forTelescopure)` in
  `BrowserView.swift`, and needs iOS 18+.
- Telescopure's README asks for Xcode 27.1+. The macmini has Xcode 26.3 on macOS 15.7.3, and
  immunemac has no Xcode selected. Its manifest needs Swift tools 6.2. Whether it builds on 26.3 is
  untested.

## Cache approaches considered

| | Approach | Trade-off |
|---|---|---|
| A (chosen) | The app downloads each build to disk and serves it from `cloudcli://app/` through a `WKURLSchemeHandler` | Full control and instant offline start. The page's origin changes. |
| B | Keep `sw.js` and enable App-Bound Domains | Least code. Keeps the opaque caching this project exists to escape, and preloading stays awkward. |
| C | Proxy all traffic natively, including `/api` | No origin change. Upload bodies through `WKURLSchemeHandler` have a history of being dropped, and WebSockets cannot be proxied this way. |

## Design

### 1. Build manifest (web repo)

`npm run build` also writes `dist/asset-manifest.json`, containing a build ID and each file's path,
SHA-256 and size. It is served like any other file in `dist` and must not be cached.

### 2. Build store (app)

Owns everything on disk under `builds/<id>/`.

- Checks the manifest on launch and on returning to the foreground.
- Downloads only files whose hash changed, copying unchanged ones from the current build.
- Verifies every file's hash before the build counts as ready. An incomplete build is discarded.
- Keeps the current and previous builds and deletes older ones.
- Records the current build in one atomic write.

### 3. Scheme handler (app)

Serves `cloudcli://app/*` from the current build. Unknown paths return `index.html`, so client-side
routes work. Responses carry the correct content type.

### 4. Update pill and rollback (app)

When a downloaded build is ready, a small "new build" pill appears. Tapping it switches the current
build and reloads the page. If the page fails to signal that it loaded within 15 seconds, the app
returns to the previous build and shows why. The summonable browser UI also has a "reload assets"
control that re-checks the manifest immediately.

### 5. Server origin shim (app)

A script injected at document start points `fetch`, `EventSource` and `WebSocket` calls for `/api`,
`/ws` and `/shell` at `https://claude.chiq.me`, using `wss:` for sockets. `XMLHttpRequest` and
`<img src="/api/...">` uses are audited during implementation and covered if any exist.

The web app is otherwise unaware of the wrapper. The user signs in once under the new origin.

### 6. Dictation (app and web repo)

A native floating control follows vvterm's states: voice, then stop or cancel, then return, then
idle. The keyboard stays open while it is used.

- Records audio with Fonos's settings: 16 kHz mono, AAC at 48 kbps, m4a. Posts it to mema's
  `/v1/transcribe` as `audio/mp4`, with `cleanup_mode=raw`.
- Writes each recording to permanent app storage before uploading, and deletes it only after mema
  returns the text.
- Probes first, so an absent server is told apart from a slow transcription, and retries busy
  responses up to twice.
- If mema returns an error or cannot be reached, a red bar appears at the top of the app with a
  "Retry and copy" button. It stays until the recording is transcribed or dismissed. A successful
  retry copies the text to the clipboard for the user to paste manually, and removes the recording.
- The mema URL and bearer token are set in Settings. The token is kept in the Keychain. A trailing
  `/v1` on the URL is ignored, because `VOICE_API_BASE_URL` may carry one.

Moving the settings from `.env`: Claude cannot touch `.env` files, so the user does this step. On
the macmini, run the command below. Then, on the phone, tap "Paste from clipboard" in Settings,
which fills both fields from those two lines (Universal Clipboard carries them across).

```bash
grep -E '^VOICE_API_(BASE_URL|KEY)=' ~/c/third-parties/claudecodeui/.env | pbcopy
```

The web app gains a small bridge: `window.__nativeDictation` exposes insert-into-composer and send.
Return sends through it. The composer's own mic button is hidden when the wrapper is detected.

### 7. Notifications (web repo and app)

The notification orchestrator gains an ntfy channel next to Web Push, configured by environment
variables. Each notification's click URL is `cloudcli://session/<id>`. The app registers the
`cloudcli` scheme and opens that session.

### 8. Cache header fix (web repo)

Limit `max-age=31536000, immutable` to `/assets/`. Everything else revalidates. This helps the web
app with or without the wrapper.

### 9. Fork and deploy

Fork into `~/c/third-parties/cloudcli-ios`. Remove bookmarks, search-engine settings, the share
extension and default-browser support. Keep navigation, pull to refresh and zoom. The start page is
the current build. Run `ios-ota-deploy` once the app builds.

The first implementation task is proving the fork builds on Xcode 26.3. If it does not, stop and
choose between installing Xcode on immunemac and rebasing on FocusKiosk.

## Error handling

| Situation | Behaviour |
|---|---|
| First launch with no network | A native screen explains that the first download needs a connection, with a retry button |
| Manifest check fails | Keep running the current build, no alert |
| Download or hash failure | Discard the partial build and retry at the next check |
| New build fails to load | Roll back to the previous build and show why |
| Server unreachable | The web app shows its existing connection error |
| Mema unreachable or returns an error | Keep the recording and show the red "Retry and copy" bar |
| App closed with a failed recording | The red bar returns on next launch |
| Microphone permission denied | The control explains and links to Settings |
| Web process killed by iOS | Reload the current build |

## Testing

- Unit tests: manifest diffing, hash verification, atomic switching, rollback, URL rewriting, parsing the
  pasted settings, and keeping and retrying failed recordings.
- Web repo tests: manifest generation, cache headers, the dictation bridge and the ntfy channel.
- On the phone: airplane-mode launch, applying a new build mid-session, a build that fails to load,
  dictation through mema, a failed upload retried from the red bar, and tapping an ntfy notification.
