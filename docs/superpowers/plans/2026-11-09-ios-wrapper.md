# iOS Wrapper for claudecodeui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `CloudCLI`, an iOS app forked from Telescopure that runs claudecodeui from builds stored on disk, updates them on a tap, dictates through mema, and receives notifications through ntfy.

**Architecture:** The web repo publishes a build manifest. The app downloads each build into a versioned folder, serves it from `cloudcli://app/` through a `WKURLSchemeHandler`, and a document-start script points API and socket traffic at `https://claude.chiq.me`. Dictation is native: a floating control records m4a, posts it to mema, and hands text to the composer through a small JavaScript bridge.

**Tech Stack:** TypeScript, Express, node:test and vitest (web repo). Swift 6.2, SwiftUI, WebKit, AVFoundation, Swift Testing, cybozu/WebUI 4.5.0 (app).

**Spec:** `docs/superpowers/specs/2026-11-09-ios-wrapper-design.md`

---

## Conventions

- **Part A** runs in `~/c/third-parties/claudecodeui`, on a new branch created in Task 1.
- **Part B** runs in `~/c/third-parties/cloudcli-ios`.
- Claude must not read or edit `.env` files. Steps that need them are marked **USER STEP**.
- Ask before restarting the running server.
- Internal Xcode target names stay `Telescopure` and `TelescopureShare`. Only the product identity changes. Renaming targets gains nothing and breaks the project file.

**App test command**, run from `~/c/third-parties/cloudcli-ios`, with the test name substituted where a step says so:

```bash
xcodebuild test -project Telescopure.xcodeproj -scheme Telescopure -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:ModelTests/BuildStoreTests -quiet
```

## Correction to the spec

Spec section 8 assumed unhashed `public/` files received the year-long header. They do not: `server/index.ts` serves `public/` first, through a plain `express.static` with no custom headers. Files in `public/` already revalidate. The change in Task 2 is therefore only a safeguard for files that exist solely in `dist/`, and it should not be expected to fix stale assets.

## File structure

Web repo:

| File | Responsibility |
|---|---|
| `server/modules/assets/services/asset-manifest.service.ts` | Builds the manifest from a directory |
| `server/scripts/write-asset-manifest.ts` | Build step that writes `dist/asset-manifest.json` |
| `server/modules/assets/services/static-cache-policy.ts` | Chooses `Cache-Control` for `dist` files |
| `src/shared/native/nativeBridge.ts` | Wrapper detection, ready signal, dictation bridge |
| `server/modules/notifications/services/ntfy-notifications.service.ts` | Publishes to ntfy |

App, under `LocalPackage/Sources/`:

| File | Responsibility |
|---|---|
| `DataSource/WebBuild/AppScheme.swift` | Scheme, host and server constants |
| `DataSource/WebBuild/BuildManifest.swift` | Manifest types and fetch |
| `DataSource/WebBuild/BuildStore.swift` | On-disk builds, verification, switching |
| `DataSource/WebBuild/BuildLocation.swift` | Thread-safe current build folder |
| `DataSource/WebBuild/AppSchemeResolver.swift` | Maps a URL to a file and content type |
| `DataSource/WebBuild/ServerOriginShim.swift` | Document-start URL rewriting script |
| `DataSource/Dictation/MemaCredentials.swift` | Settings parsing and URL normalising |
| `DataSource/Dictation/MemaCredentialStore.swift` | UserDefaults and Keychain storage |
| `DataSource/Dictation/MemaClient.swift` | Upload, probe and busy retries |
| `DataSource/Dictation/PendingRecordingStore.swift` | Recordings in permanent storage |
| `DataSource/Dictation/DictationRecorder.swift` | AVAudioRecorder wrapper |
| `Model/Wrapper/BuildUpdater.swift` | Check, pill state, apply, rollback |
| `Model/Wrapper/DictationController.swift` | Dictation state machine and retry |
| `Model/Wrapper/AppSchemeHandler.swift` | `WKURLSchemeHandler` |
| `Model/Wrapper/AppServices.swift` | Wires everything together |
| `UserInterface/Wrapper/WrapperOverlay.swift` | Pill, red bar, floating control, tools |
| `UserInterface/Wrapper/MemaSettingsView.swift` | Mema settings with paste from clipboard |

---

# Part A: web repo

### Task 1: Build manifest

**Files:**
- Create: `server/modules/assets/services/asset-manifest.service.ts`
- Create: `server/scripts/write-asset-manifest.ts`
- Modify: `package.json:45`
- Test: `server/modules/assets/tests/asset-manifest.service.test.ts`

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b feat/ios-wrapper
```

- [ ] **Step 2: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAssetManifest } from '@/modules/assets/services/asset-manifest.service.js';

async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'manifest-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), body);
  }
  return dir;
}

test('lists every file with its hash and size, sorted, using forward slashes', async () => {
  const dir = await fixture({ 'index.html': 'a', 'assets/app.js': 'bb' });
  try {
    const manifest = await buildAssetManifest(dir);
    assert.deepEqual(manifest.files, [
      { path: 'assets/app.js', sha256: createHash('sha256').update('bb').digest('hex'), size: 2 },
      { path: 'index.html', sha256: createHash('sha256').update('a').digest('hex'), size: 1 },
    ]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('excludes the manifest itself', async () => {
  const dir = await fixture({ 'index.html': 'a', 'asset-manifest.json': '{}' });
  try {
    const manifest = await buildAssetManifest(dir);
    assert.deepEqual(manifest.files.map((f) => f.path), ['index.html']);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('build id changes only when content changes', async () => {
  const one = await fixture({ 'index.html': 'a' });
  const same = await fixture({ 'index.html': 'a' });
  const other = await fixture({ 'index.html': 'b' });
  try {
    const [a, b, c] = await Promise.all([one, same, other].map(buildAssetManifest));
    assert.equal(a.buildId, b.buildId);
    assert.notEqual(a.buildId, c.buildId);
  } finally {
    await Promise.all([one, same, other].map((d) => rm(d, { recursive: true })));
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/asset-manifest.service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the service**

```ts
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const ASSET_MANIFEST_NAME = 'asset-manifest.json';

export type AssetManifest = {
  buildId: string;
  files: { path: string; sha256: string; size: number }[];
};

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export async function buildAssetManifest(dir: string): Promise<AssetManifest> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .map((full) => ({ full, relative: path.relative(dir, full).split(path.sep).join('/') }))
      .filter(({ relative }) => relative !== ASSET_MANIFEST_NAME)
      .map(async ({ full, relative }) => {
        const data = await readFile(full);
        return { path: relative, sha256: sha256(data), size: data.length };
      }),
  );
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const buildId = sha256(files.map((f) => `${f.path}:${f.sha256}`).join('\n')).slice(0, 16);
  return { buildId, files };
}
```

- [ ] **Step 5: Add the build step**

Create `server/scripts/write-asset-manifest.ts`:

```ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ASSET_MANIFEST_NAME, buildAssetManifest } from '@/modules/assets/services/asset-manifest.service.js';

const dist = path.resolve(process.cwd(), 'dist');
const manifest = await buildAssetManifest(dist);
await writeFile(path.join(dist, ASSET_MANIFEST_NAME), JSON.stringify(manifest));
console.log(`asset manifest: ${manifest.buildId}, ${manifest.files.length} files`);
```

In `package.json`, change `build:client` to:

```json
"build:client": "vite build && tsx --tsconfig server/tsconfig.json server/scripts/write-asset-manifest.ts",
```

- [ ] **Step 6: Verify the tests and the build step**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/asset-manifest.service.test.ts && npm run build:client`
Expected: 3 tests pass, and the build ends with a line starting `asset manifest:`.

- [ ] **Step 7: Commit**

```bash
git add server/modules/assets server/scripts/write-asset-manifest.ts package.json
git commit -m "feat(assets): publish a build manifest for the iOS wrapper"
```

### Task 2: Limit the immutable header to `/assets/`

**Files:**
- Create: `server/modules/assets/services/static-cache-policy.ts`
- Modify: `server/index.ts:216-225`
- Test: `server/modules/assets/tests/static-cache-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { staticCacheControl } from '@/modules/assets/services/static-cache-policy.js';

test('html is never stored', () => {
  assert.equal(staticCacheControl('index.html'), 'no-cache, no-store, must-revalidate');
});

test('hashed assets are immutable', () => {
  assert.equal(staticCacheControl('assets/app-abc.js'), 'public, max-age=31536000, immutable');
});

test('anything else revalidates', () => {
  assert.equal(staticCacheControl('logo.png'), 'no-cache');
  assert.equal(staticCacheControl('asset-manifest.json'), 'no-cache');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/static-cache-policy.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
export function staticCacheControl(distRelativePath: string): string {
  const normalized = distRelativePath.split('\\').join('/');
  if (normalized.endsWith('.html')) return 'no-cache, no-store, must-revalidate';
  if (normalized.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}
```

- [ ] **Step 4: Use it in the server**

In `server/index.ts`, add the import next to the other module imports:

```ts
import { staticCacheControl } from '@/modules/assets/services/static-cache-policy.js';
```

Replace the `setHeaders` body of the `dist` static handler:

```ts
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', staticCacheControl(path.relative(path.join(APP_ROOT, 'dist'), filePath)));
        if (filePath.endsWith('.html')) {
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
```

- [ ] **Step 5: Verify**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/static-cache-policy.test.ts && npm run typecheck`
Expected: 3 tests pass, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/modules/assets server/index.ts
git commit -m "fix(server): limit the immutable header to hashed assets"
```

### Task 3: Native bridge

**Files:**
- Create: `src/shared/native/nativeBridge.ts`
- Modify: `src/App.tsx`, `src/modules/chat/composer/ChatComposer.tsx:249-252,462`, `src/modules/chat/hooks/useChatComposerState.ts:1320`
- Test: `src/shared/native/nativeBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isNativeWrapper, notifyNativeReady, registerNativeDictation } from './nativeBridge';

afterEach(() => {
  delete window.webkit;
  delete window.__nativeDictation;
});

const installHandler = () => {
  const postMessage = vi.fn();
  window.webkit = { messageHandlers: { cloudcliBridge: { postMessage } } };
  return postMessage;
};

describe('nativeBridge', () => {
  it('detects the wrapper from its message handler', () => {
    expect(isNativeWrapper()).toBe(false);
    installHandler();
    expect(isNativeWrapper()).toBe(true);
  });

  it('posts the ready signal only inside the wrapper', () => {
    expect(() => notifyNativeReady()).not.toThrow();
    const postMessage = installHandler();
    notifyNativeReady();
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('routes insert and send to the transcript handler until unregistered', () => {
    const onTranscript = vi.fn();
    const unregister = registerNativeDictation(onTranscript);
    expect(window.__nativeDictation?.insert('hola')).toBe(true);
    expect(window.__nativeDictation?.send()).toBe(true);
    expect(onTranscript.mock.calls).toEqual([['hola'], ['', true]]);
    unregister();
    expect(window.__nativeDictation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/native/nativeBridge.test.ts`
Expected: FAIL, cannot resolve `./nativeBridge`.

- [ ] **Step 3: Implement**

```ts
type NativeDictation = { insert: (text: string) => boolean; send: () => boolean };

declare global {
  interface Window {
    webkit?: { messageHandlers?: { cloudcliBridge?: { postMessage: (message: unknown) => void } } };
    __nativeDictation?: NativeDictation;
  }
}

export const isNativeWrapper = (): boolean => Boolean(window.webkit?.messageHandlers?.cloudcliBridge);

export function notifyNativeReady(): void {
  window.webkit?.messageHandlers?.cloudcliBridge?.postMessage({ type: 'ready' });
}

export function registerNativeDictation(onTranscript: (text: string, send?: boolean) => void): () => void {
  window.__nativeDictation = {
    insert: (text) => {
      onTranscript(text);
      return true;
    },
    send: () => {
      onTranscript('', true);
      return true;
    },
  };
  return () => {
    delete window.__nativeDictation;
  };
}
```

- [ ] **Step 4: Stop an empty send adding a trailing space**

In `useChatComposerState.ts`, replace the `next` line in `handleVoiceTranscript`:

```ts
    const next = !text ? base : base ? `${base} ${text}` : text;
```

- [ ] **Step 5: Wire the composer**

In `ChatComposer.tsx`, add the import, then add this directly after the `useVoiceInput` call:

```tsx
import { isNativeWrapper, registerNativeDictation } from '@/shared/native/nativeBridge';
```

```tsx
  useEffect(() => {
    if (!onVoiceTranscript) return undefined;
    return registerNativeDictation(onVoiceTranscript);
  }, [onVoiceTranscript]);
```

Change the mic button condition at line 462:

```tsx
            {onVoiceTranscript && voiceAvailable && !isNativeWrapper() && (
```

- [ ] **Step 6: Signal that the app mounted**

In `src/App.tsx`, import `notifyNativeReady` from `@/shared/native/nativeBridge` and add `useEffect` to the React import (add `import { useEffect } from 'react';` if the file has no React import). Add directly after `const routerBasename = detectRouterBasename();`:

```tsx
  useEffect(() => {
    notifyNativeReady();
  }, []);
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/shared/native src/modules/chat/tests/slashCommandArguments.test.ts && npm run typecheck`
Expected: all pass, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/native src/App.tsx src/modules/chat/composer/ChatComposer.tsx src/modules/chat/hooks/useChatComposerState.ts
git commit -m "feat(chat): add a bridge for the native iOS wrapper"
```

### Task 4: ntfy channel

**Files:**
- Create: `server/modules/notifications/services/ntfy-notifications.service.ts`
- Modify: `server/modules/notifications/services/notification-orchestrator.service.js:3-5,212-235`
- Test: `server/modules/notifications/tests/ntfy-notifications.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { readNtfyConfig, sendNtfyNotification } from '@/modules/notifications/services/ntfy-notifications.service.js';

const config = { url: 'https://ntfy.example', topic: 'cloudcli', token: 'secret' };

test('config needs both a url and a topic', () => {
  assert.equal(readNtfyConfig({}), null);
  assert.equal(readNtfyConfig({ NTFY_URL: 'https://ntfy.example' }), null);
  assert.deepEqual(readNtfyConfig({ NTFY_URL: 'https://ntfy.example/', NTFY_TOPIC: 't' }), {
    url: 'https://ntfy.example',
    topic: 't',
    token: undefined,
  });
});

test('publishes JSON with a click url into the wrapper', async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response('{}');
  }) as typeof fetch;

  await sendNtfyNotification(config, { title: 'Done', body: 'Claude: ok', data: { sessionId: 'a/b' } }, fetchImpl);

  assert.equal(captured?.url, 'https://ntfy.example');
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(String(captured?.init.body)), {
    topic: 'cloudcli',
    title: 'Done',
    message: 'Claude: ok',
    click: 'cloudcli://session/a%2Fb',
  });
});

test('omits click without a session', async () => {
  let body = '';
  const fetchImpl = (async (_: string, init: RequestInit) => {
    body = String(init.body);
    return new Response('{}');
  }) as typeof fetch;
  await sendNtfyNotification(config, { title: 'T', body: 'B', data: {} }, fetchImpl);
  assert.equal('click' in JSON.parse(body), false);
});

test('a failed publish does not throw', async () => {
  const fetchImpl = (async () => new Response('no', { status: 500 })) as typeof fetch;
  await assert.doesNotReject(sendNtfyNotification(config, { title: 'T', body: 'B', data: {} }, fetchImpl));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/notifications/tests/ntfy-notifications.service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

JSON publishing is used because ntfy's `Title` header cannot carry non-ASCII session names.

```ts
export type NtfyConfig = { url: string; topic: string; token?: string };
export type NtfyPayload = { title: string; body: string; data?: { sessionId?: string | null } };

export function readNtfyConfig(env: Record<string, string | undefined> = process.env): NtfyConfig | null {
  const url = env.NTFY_URL?.replace(/\/$/, '');
  const topic = env.NTFY_TOPIC;
  if (!url || !topic) return null;
  return { url, topic, token: env.NTFY_TOKEN || undefined };
}

export async function sendNtfyNotification(
  config: NtfyConfig,
  payload: NtfyPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const sessionId = payload.data?.sessionId;
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        topic: config.topic,
        title: payload.title,
        message: payload.body,
        ...(sessionId ? { click: `cloudcli://session/${encodeURIComponent(sessionId)}` } : {}),
      }),
    });
    if (!response.ok) console.warn(`ntfy publish failed: ${response.status}`);
  } catch (error) {
    console.warn('ntfy publish failed:', error);
  }
}
```

- [ ] **Step 4: Register the channel**

In the orchestrator, add the import after the webhook import:

```js
import { readNtfyConfig, sendNtfyNotification } from '@/modules/notifications/services/ntfy-notifications.service.js';
```

Add this entry at the end of `notificationChannels`:

```js
  {
    id: 'ntfy',
    // Gated by server configuration, for the same reason as the webhook channel:
    // the Settings client rewrites preferences.channels with only its known keys.
    isEnabled: () => Boolean(readNtfyConfig()),
    send: ({ payload }) => sendNtfyNotification(readNtfyConfig(), payload)
  }
```

- [ ] **Step 5: Verify**

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/notifications/tests/ntfy-notifications.service.test.ts server/modules/notifications/tests/notification-orchestrator.integration.test.ts && npm run typecheck`
Expected: all pass, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/modules/notifications
git commit -m "feat(notifications): add an ntfy channel"
```

---

# Part B: iOS app

### Task 5: Fork and prove it builds (gate)

**Files:** none changed.

- [ ] **Step 1: Fork and clone**

```bash
gh repo fork Kyome22/Telescopure --fork-name cloudcli-ios --clone=false
git clone git@github.com:grillermo/cloudcli-ios.git ~/c/third-parties/cloudcli-ios
```

- [ ] **Step 2: Build and test on Xcode 26.3**

Run from `~/c/third-parties/cloudcli-ios`:

```bash
xcodebuild test -project Telescopure.xcodeproj -scheme Telescopure -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:ModelTests -quiet
```

Expected: `** TEST SUCCEEDED **`, or exit code 0 with `-quiet`.

- [ ] **Step 3: Gate**

If the build fails because of Xcode 26.3, stop and report the error to the user. The spec's choices are installing Xcode on immunemac or rebasing on FocusKiosk. Do not edit around it without asking.

### Task 6: Strip the browser down and set the app's identity

**Files:**
- Delete: `LocalPackage/Sources/DataSource/Entities/Bookmark.swift`, `.../Entities/SearchEngine.swift`, `LocalPackage/Sources/Model/Stores/BookmarkItem.swift`, `.../BookmarkManagement.swift`, `.../SearchEngineSetting.swift`, `LocalPackage/Sources/UserInterface/BookmarkButtonStyle.swift`, `.../Views/BookmarkItemView.swift`, `.../Views/BookmarkManagementView.swift`, `.../Views/SearchEngineSettingView.swift`, `LocalPackage/Tests/ModelTests/StoreTests/BookmarkItemTests.swift`, `.../BookmarkManagementTests.swift`
- Modify: `LocalPackage/Sources/Model/Stores/Browser.swift`, `.../Settings.swift`, `.../Share.swift`, `LocalPackage/Sources/DataSource/Repositories/UserDefaultsRepository.swift`, `LocalPackage/Sources/UserInterface/Views/BrowserView.swift`, `.../SettingsView.swift`, `.../BrowserActionButtons.swift`, `.../Extensions/WebKit+Extension.swift`, `.../Scenes/BrowserScene.swift`, `LocalPackage/Sources/Model/Stores/BrowserNavigation.swift`, `LocalPackage/Tests/ModelTests/StoreTests/BrowserTests.swift`, `.../SettingsTests.swift`, `Telescopure/Info.plist`, `Telescopure/Telescopure.entitlements`, `Telescopure.xcodeproj/project.pbxproj`
- Test: `LocalPackage/Tests/ModelTests/StoreTests/BrowserTests.swift`

- [ ] **Step 1: Delete the files listed above**

```bash
cd LocalPackage && git rm Sources/DataSource/Entities/Bookmark.swift Sources/DataSource/Entities/SearchEngine.swift Sources/Model/Stores/BookmarkItem.swift Sources/Model/Stores/BookmarkManagement.swift Sources/Model/Stores/SearchEngineSetting.swift Sources/UserInterface/BookmarkButtonStyle.swift Sources/UserInterface/Views/BookmarkItemView.swift Sources/UserInterface/Views/BookmarkManagementView.swift Sources/UserInterface/Views/SearchEngineSettingView.swift Tests/ModelTests/StoreTests/BookmarkItemTests.swift Tests/ModelTests/StoreTests/BookmarkManagementTests.swift
```

- [ ] **Step 2: Remove the references**

In `Browser.swift`, remove: the `bookmarkManagement` property, init parameter and assignment; the `.bookmarkButtonTapped`, `.bookmarkManagement(...)` reducer cases and the matching `Action` cases. Replace `search(with:)` with:

```swift
    private func search(with text: String) async {
        guard let url = URLComponents(string: text)?.url, url.scheme != nil else { return }
        await webViewProxyClient.load(URLRequest(url: url))
    }
```

In `BrowserView.swift`, remove the `.sheet(item: $store.bookmarkManagement)` modifier. Then list the remaining references and remove each one, including their tests in `BrowserTests.swift` and `SettingsTests.swift`:

```bash
grep -rn -E "[Bb]ookmark|SearchEngine|searchEngine|isDefaultBrowser|defaultBrowser" LocalPackage/Sources LocalPackage/Tests
```

Expected after removal: no output.

- [ ] **Step 3: Make safe areas reach the page**

In `WebKit+Extension.swift`, delete the `extension WKWebView` block that overrides `safeAreaInsets`, so the web app's `env(safe-area-inset-*)` values work.

- [ ] **Step 4: Set the identity**

`Telescopure/Info.plist`: replace the `CFBundleURLSchemes` array with one entry, and add the display name and microphone text:

```xml
			<key>CFBundleURLSchemes</key>
			<array>
				<string>cloudcli</string>
			</array>
```

```xml
	<key>CFBundleDisplayName</key>
	<string>CloudCLI</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>CloudCLI records your voice and sends it to your own mema server to transcribe it.</string>
```

`Telescopure/Telescopure.entitlements`: remove the `com.apple.developer.web-browser` key and its value, leaving an empty `<dict/>`. An ad hoc provisioning profile cannot carry that entitlement.

Replace the bundle identifiers and the share extension's scheme:

```bash
grep -rln "telescopure://" LocalPackage/Sources TelescopureShare | xargs sd -F 'telescopure://' 'cloudcli://'
grep -n "PRODUCT_BUNDLE_IDENTIFIER" Telescopure.xcodeproj/project.pbxproj
grep -rn '"telescopure"' LocalPackage/Sources TelescopureShare
```

The last command must print only the line in `Browser.swift` that Step 6 replaces. Change any other match to `"cloudcli"`, so the share extension opens this app.

Using the identifiers that command prints, edit `project.pbxproj` so the app is `me.chiq.cloudcli`, the share extension is `me.chiq.cloudcli.share`, and the UI tests are `me.chiq.cloudcli.uitests`.

- [ ] **Step 5: Write the failing routing tests**

Add to `BrowserTests.swift`:

```swift
    @MainActor @Test
    func send_onOpenURL_session_link_opens_the_session() async {
        let request = OSAllocatedUnfairLock<URLRequest?>(initialState: nil)
        let sut = Browser(.testDependencies(
            webViewProxyClient: testDependency(of: WebViewProxyClient.self) {
                $0.load = { value in request.withLock { $0 = value } }
            }
        ))
        await sut.send(.onOpenURL(URL(string: "cloudcli://session/abc%2Fd")!))
        #expect(request.withLock(\.self)?.url?.absoluteString == "cloudcli://app/session/abc%2Fd")
    }

    @MainActor @Test
    func send_decidePolicyFor_allows_the_app_origin() async {
        let sut = Browser(.testDependencies())
        await sut.send(.browserNavigation(.decidePolicyFor(URLRequest(url: URL(string: "cloudcli://app/")!))))
        #expect(sut.isPresentedConfirmationDialog == false)
    }
```

Run the App test command with `ModelTests/BrowserTests`.
Expected: FAIL. The session test finds no load, and the policy test finds the dialog presented.

- [ ] **Step 6: Implement routing**

In `Browser.swift`, replace the line `case "telescopure":` with:

```swift
            case "cloudcli":
                if url.host() == "session" {
                    let encoded = url.path(percentEncoded: true)
                    guard let target = URL(string: "cloudcli://app/session\(encoded)") else { return }
                    await webViewProxyClient.load(URLRequest(url: target))
                    return
                }
```

Keep the existing `guard let queryItem` handling after this, so shared links work. In `.decidePolicyFor`, allow the app's own origin before the scheme check:

```swift
            if requestURL.scheme == "cloudcli", requestURL.host() == "app" {
                appStateClient.send(\.actionPolicySubject, input: .allow)
                return
            }
```

- [ ] **Step 7: Start with the toolbar hidden**

In `BrowserScene.swift`:

```swift
            BrowserView(store: .init(appDependencies, isPresentedToolbar: false))
```

- [ ] **Step 8: Reload when iOS kills the web process**

Add to `BrowserNavigationDelegate` in `BrowserNavigation.swift`:

```swift
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
```

- [ ] **Step 9: Verify**

Run the App test command with `ModelTests`.
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: reduce Telescopure to the CloudCLI wrapper"
```

### Task 7: Build store

**Files:**
- Create: `LocalPackage/Sources/DataSource/WebBuild/AppScheme.swift`, `.../BuildManifest.swift`, `.../BuildLocation.swift`, `.../BuildStore.swift`
- Test: `LocalPackage/Tests/ModelTests/WrapperTests/BuildStoreTests.swift`

- [ ] **Step 1: Add the types**

`AppScheme.swift`:

```swift
import Foundation

public enum AppScheme {
    public static let scheme = "cloudcli"
    public static let host = "app"
    public static let root = URL(string: "cloudcli://app/")!
    public static let server = URL(string: "https://claude.chiq.me")!
    public static let bridgeName = "cloudcliBridge"
}
```

`BuildManifest.swift`:

```swift
import Foundation

public struct BuildManifest: Codable, Equatable, Sendable {
    public struct File: Codable, Equatable, Sendable {
        public let path: String
        public let sha256: String
        public let size: Int

        public init(path: String, sha256: String, size: Int) {
            self.path = path
            self.sha256 = sha256
            self.size = size
        }
    }

    public let buildId: String
    public let files: [File]

    public init(buildId: String, files: [File]) {
        self.buildId = buildId
        self.files = files
    }

    public static func fetch(session: URLSession = .shared) async throws -> BuildManifest {
        var request = URLRequest(url: AppScheme.server.appending(path: "asset-manifest.json"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(BuildManifest.self, from: data)
    }
}
```

`BuildLocation.swift`:

```swift
import Foundation
import os

public final class BuildLocation: Sendable {
    private let directory = OSAllocatedUnfairLock<URL?>(initialState: nil)

    public init() {}

    public var current: URL? {
        get { directory.withLock(\.self) }
        set { directory.withLock { $0 = newValue } }
    }
}
```

- [ ] **Step 2: Write the failing tests**

```swift
import CryptoKit
import Foundation
import os
import Testing

@testable import DataSource

struct BuildStoreTests {
    private func hash(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func manifest(_ id: String, _ files: [String: String]) -> BuildManifest {
        BuildManifest(
            buildId: id,
            files: files.map { .init(path: $0.key, sha256: hash($0.value), size: $0.value.utf8.count) }
        )
    }

    private func makeStore(
        _ files: [String: String],
        fetched: OSAllocatedUnfairLock<[String]> = .init(initialState: [])
    ) -> BuildStore {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        return BuildStore(root: root, fetch: { path in
            fetched.withLock { $0.append(path) }
            guard let body = files[path] else { throw URLError(.fileDoesNotExist) }
            return Data(body.utf8)
        })
    }

    @Test
    func prepare_then_activate_exposes_the_files() async throws {
        let store = makeStore(["index.html": "a"])
        try await store.prepare(manifest("one", ["index.html": "a"]))
        try await store.activate("one")
        let directory = try #require(await store.currentDirectory())
        #expect(try String(contentsOf: directory.appending(path: "index.html"), encoding: .utf8) == "a")
    }

    @Test
    func a_hash_mismatch_discards_the_build() async throws {
        let store = makeStore(["index.html": "corrupt"])
        await #expect(throws: BuildStore.Failure.self) {
            try await store.prepare(manifest("one", ["index.html": "a"]))
        }
        #expect(await store.isReady("one") == false)
    }

    @Test
    func unchanged_files_are_not_downloaded_again() async throws {
        let fetched = OSAllocatedUnfairLock<[String]>(initialState: [])
        let store = makeStore(["a.js": "same", "b.js": "new"], fetched: fetched)
        try await store.prepare(manifest("one", ["a.js": "same"]))
        try await store.activate("one")
        fetched.withLock { $0 = [] }
        try await store.prepare(manifest("two", ["a.js": "same", "b.js": "new"]))
        #expect(fetched.withLock(\.self) == ["b.js"])
    }

    @Test
    func rollback_returns_to_the_previous_build() async throws {
        let store = makeStore(["index.html": "a"])
        try await store.prepare(manifest("one", ["index.html": "a"]))
        try await store.activate("one")
        try await store.prepare(manifest("two", ["index.html": "a"]))
        try await store.activate("two")
        #expect(try await store.rollback() == "one")
        #expect(await store.pointer().current == "one")
    }

    @Test
    func only_current_and_previous_are_kept() async throws {
        let store = makeStore(["index.html": "a"])
        for id in ["one", "two", "three"] {
            try await store.prepare(manifest(id, ["index.html": "a"]))
            try await store.activate(id)
        }
        #expect(await store.isReady("one") == false)
        #expect(await store.isReady("two"))
        #expect(await store.isReady("three"))
    }

    @Test
    func paths_cannot_escape_the_build_folder() async throws {
        let store = makeStore(["../evil": "a"])
        await #expect(throws: BuildStore.Failure.self) {
            try await store.prepare(manifest("one", ["../evil": "a"]))
        }
    }
}
```

- [ ] **Step 3: Run them to verify they fail**

Run the App test command with `ModelTests/BuildStoreTests`.
Expected: FAIL, cannot find `BuildStore`.

- [ ] **Step 4: Implement**

```swift
import CryptoKit
import Foundation

public actor BuildStore {
    public typealias Fetch = @Sendable (String) async throws -> Data

    public enum Failure: Error, Equatable {
        case hashMismatch(String)
        case unsafePath(String)
        case notReady(String)
    }

    public struct Pointer: Codable, Equatable, Sendable {
        public var current: String?
        public var previous: String?
    }

    private static let manifestName = ".manifest.json"
    private let root: URL
    private let fetch: Fetch
    private let files = FileManager.default

    public init(root: URL, fetch: @escaping Fetch) {
        self.root = root
        self.fetch = fetch
    }

    private var builds: URL { root.appending(path: "builds", directoryHint: .isDirectory) }
    private var pointerFile: URL { root.appending(path: "current.json") }
    private func folder(_ id: String) -> URL { builds.appending(path: id, directoryHint: .isDirectory) }

    public func pointer() -> Pointer {
        guard let data = try? Data(contentsOf: pointerFile),
              let value = try? JSONDecoder().decode(Pointer.self, from: data) else {
            return Pointer()
        }
        return value
    }

    /// A build's manifest is written last, so its presence means the build is complete.
    public func isReady(_ id: String) -> Bool {
        files.fileExists(atPath: folder(id).appending(path: Self.manifestName).path)
    }

    public func currentDirectory() -> URL? {
        guard let id = pointer().current, isReady(id) else { return nil }
        return folder(id)
    }

    public func prepare(_ manifest: BuildManifest) async throws {
        guard !isReady(manifest.buildId) else { return }
        let partial = builds.appending(path: "\(manifest.buildId).partial", directoryHint: .isDirectory)
        try? files.removeItem(at: partial)
        try files.createDirectory(at: partial, withIntermediateDirectories: true)
        do {
            let known = currentFiles()
            for file in manifest.files {
                guard Self.isSafe(file.path) else { throw Failure.unsafePath(file.path) }
                let destination = partial.appending(path: file.path)
                try files.createDirectory(
                    at: destination.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                let data: Data
                if let existing = known[file.path], existing.sha256 == file.sha256 {
                    data = try Data(contentsOf: existing.url)
                } else {
                    data = try await fetch(file.path)
                }
                guard Self.sha256(data) == file.sha256 else { throw Failure.hashMismatch(file.path) }
                try data.write(to: destination)
            }
            try JSONEncoder().encode(manifest).write(to: partial.appending(path: Self.manifestName))
            try? files.removeItem(at: folder(manifest.buildId))
            try files.moveItem(at: partial, to: folder(manifest.buildId))
        } catch {
            try? files.removeItem(at: partial)
            throw error
        }
    }

    public func activate(_ id: String) throws {
        guard isReady(id) else { throw Failure.notReady(id) }
        let old = pointer()
        try write(Pointer(current: id, previous: old.current == id ? old.previous : old.current))
        prune()
    }

    /// Returns the build now current, or nil when there is nothing to return to.
    public func rollback() throws -> String? {
        let old = pointer()
        guard let previous = old.previous, isReady(previous) else { return nil }
        try write(Pointer(current: previous, previous: nil))
        return previous
    }

    private func write(_ value: Pointer) throws {
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: pointerFile, options: .atomic)
    }

    private func prune() {
        let value = pointer()
        let keep = Set([value.current, value.previous].compactMap(\.self))
        for name in (try? files.contentsOfDirectory(atPath: builds.path)) ?? [] where !keep.contains(name) {
            try? files.removeItem(at: builds.appending(path: name))
        }
    }

    private func currentFiles() -> [String: (sha256: String, url: URL)] {
        guard let directory = currentDirectory(),
              let data = try? Data(contentsOf: directory.appending(path: Self.manifestName)),
              let manifest = try? JSONDecoder().decode(BuildManifest.self, from: data) else {
            return [:]
        }
        var result: [String: (sha256: String, url: URL)] = [:]
        for file in manifest.files {
            result[file.path] = (file.sha256, directory.appending(path: file.path))
        }
        return result
    }

    private static func isSafe(_ path: String) -> Bool {
        !path.hasPrefix("/") && !path.split(separator: "/").contains("..")
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
```

- [ ] **Step 5: Verify**

Run the App test command with `ModelTests/BuildStoreTests`.
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add LocalPackage
git commit -m "feat: store web builds on disk with verified updates"
```

### Task 8: Scheme handler and server origin shim

**Files:**
- Create: `LocalPackage/Sources/DataSource/WebBuild/AppSchemeResolver.swift`, `.../ServerOriginShim.swift`, `LocalPackage/Sources/Model/Wrapper/AppSchemeHandler.swift`
- Test: `LocalPackage/Tests/ModelTests/WrapperTests/AppSchemeResolverTests.swift`, `.../ServerOriginShimTests.swift`

- [ ] **Step 1: Write the failing tests**

`AppSchemeResolverTests.swift`:

```swift
import Foundation
import Testing

@testable import DataSource

struct AppSchemeResolverTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appending(path: "assets"), withIntermediateDirectories: true)
        try Data("html".utf8).write(to: root.appending(path: "index.html"))
        try Data("js".utf8).write(to: root.appending(path: "assets/app.js"))
        return root
    }

    private func resolve(_ url: String, _ root: URL) throws -> AppSchemeResolver.Resolved {
        try #require(AppSchemeResolver.resolve(URL(string: url)!, root: root))
    }

    @Test
    func serves_an_existing_file_with_its_type() throws {
        let resolved = try resolve("cloudcli://app/assets/app.js", makeRoot())
        #expect(resolved.file.lastPathComponent == "app.js")
        #expect(resolved.contentType == "text/javascript; charset=utf-8")
    }

    @Test
    func client_routes_get_index_html() throws {
        let resolved = try resolve("cloudcli://app/session/abc", makeRoot())
        #expect(resolved.file.lastPathComponent == "index.html")
        #expect(resolved.contentType == "text/html; charset=utf-8")
    }

    @Test
    func traversal_gets_index_html() throws {
        let resolved = try resolve("cloudcli://app/../../secret", makeRoot())
        #expect(resolved.file.lastPathComponent == "index.html")
    }
}
```

`ServerOriginShimTests.swift`:

```swift
import JavaScriptCore
import Testing

@testable import DataSource

struct ServerOriginShimTests {
    private func run(_ call: String) -> String? {
        let context = JSContext()!
        context.evaluateScript("""
        var calls = [];
        var window = this;
        var location = { origin: 'cloudcli://app' };
        function fetch(u) { calls.push(String(u)); }
        function WebSocket(u) { calls.push(u); }
        function EventSource(u) { calls.push(u); }
        function XMLHttpRequest() {}
        XMLHttpRequest.prototype.open = function (m, u) { calls.push(u); };
        """)
        context.evaluateScript(ServerOriginShim.source)
        context.evaluateScript(call)
        return context.evaluateScript("calls[0]")?.toString()
    }

    @Test(arguments: [
        ("fetch('/api/x')", "https://claude.chiq.me/api/x"),
        ("fetch('cloudcli://app/api/x')", "https://claude.chiq.me/api/x"),
        ("fetch('/assets/a.js')", "/assets/a.js"),
        ("fetch('/apiary')", "/apiary"),
        ("new EventSource('/api/stream?a=1')", "https://claude.chiq.me/api/stream?a=1"),
        ("new WebSocket('ws://app/ws?token=t')", "wss://claude.chiq.me/ws?token=t"),
        ("new WebSocket('ws://app/shell')", "wss://claude.chiq.me/shell"),
        ("new WebSocket('wss://example.com/ws')", "wss://example.com/ws"),
        ("new XMLHttpRequest().open('GET', '/api/x')", "https://claude.chiq.me/api/x"),
    ])
    func rewrites(call: String, expected: String) {
        #expect(run(call) == expected)
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run the App test command with `ModelTests/AppSchemeResolverTests` and again with `ModelTests/ServerOriginShimTests`.
Expected: FAIL, cannot find the types.

- [ ] **Step 3: Implement the resolver**

```swift
import Foundation

public enum AppSchemeResolver {
    public struct Resolved: Equatable, Sendable {
        public let file: URL
        public let contentType: String
    }

    private static let contentTypes = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "ico": "image/x-icon",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "wasm": "application/wasm",
        "webmanifest": "application/manifest+json",
    ]

    public static func resolve(_ url: URL, root: URL) -> Resolved? {
        let base = root.standardizedFileURL
        let candidate = base.appending(path: String(url.path(percentEncoded: false).drop { $0 == "/" }))
            .standardizedFileURL
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory)
        let isInside = candidate.path.hasPrefix(base.path + "/")
        let file = exists && !isDirectory.boolValue && isInside ? candidate : base.appending(path: "index.html")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return Resolved(
            file: file,
            contentType: contentTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        )
    }
}
```

- [ ] **Step 4: Implement the shim**

```swift
public enum ServerOriginShim {
    public static let source = #"""
    (function () {
      var server = 'https://claude.chiq.me';
      var socketServer = 'wss://claude.chiq.me';
      var prefixes = ['/api', '/ws', '/shell', '/plugin-ws'];

      function isServerPath(path) {
        return prefixes.some(function (p) {
          return path === p || path.indexOf(p + '/') === 0 || path.indexOf(p + '?') === 0;
        });
      }

      function appPath(url) {
        if (url.indexOf(location.origin) === 0) return url.slice(location.origin.length);
        return url;
      }

      function rewriteHttp(url) {
        if (typeof url !== 'string') return url;
        var path = appPath(url);
        return path.charAt(0) === '/' && isServerPath(path) ? server + path : url;
      }

      function rewriteSocket(url) {
        var match = /^wss?:\/\/app(\/.*)$/.exec(String(url));
        return match && isServerPath(match[1]) ? socketServer + match[1] : url;
      }

      var nativeFetch = window.fetch;
      window.fetch = function (input, init) {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          var rewritten = rewriteHttp(input.url);
          return nativeFetch.call(window, rewritten === input.url ? input : new Request(rewritten, input), init);
        }
        return nativeFetch.call(window, rewriteHttp(typeof input === 'string' ? input : String(input)), init);
      };

      function wrapConstructor(name, rewrite) {
        window[name] = new Proxy(window[name], {
          construct: function (target, args) {
            args[0] = rewrite(args[0]);
            return Reflect.construct(target, args);
          }
        });
      }
      wrapConstructor('WebSocket', rewriteSocket);
      wrapConstructor('EventSource', rewriteHttp);

      var nativeOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        args[1] = rewriteHttp(url);
        return nativeOpen.apply(this, args);
      };
    })();
    """#
}
```

- [ ] **Step 5: Implement the handler**

`AppSchemeHandler.swift`:

```swift
import DataSource
import Foundation
import WebKit

public final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let location: BuildLocation

    public init(location: BuildLocation) {
        self.location = location
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let root = location.current,
              let resolved = AppSchemeResolver.resolve(url, root: root),
              let data = try? Data(contentsOf: resolved.file, options: .mappedIfSafe),
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: 200,
                  httpVersion: "HTTP/1.1",
                  headerFields: ["Content-Type": resolved.contentType, "Cache-Control": "no-store"]
              ) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}
}
```

The file is served in one synchronous pass, so a task cannot be stopped midway.

- [ ] **Step 6: Audit other server URLs**

Run in `~/c/third-parties/claudecodeui`:

```bash
git grep -n -E "(src|href|action)=\{?[\`'\"]?/?(api|ws)/" -- src
git grep -n -E "(src|href)=\{[^}]*(api|Url)" -- src
```

Any `<img>`, `<a>` or `<video>` that loads from the server by relative path will not pass through the shim. For each one found, change it to use a URL built by a new `serverUrl(path)` function in `src/shared/native/nativeBridge.ts`:

```ts
export const serverUrl = (path: string): string => (isNativeWrapper() ? `https://claude.chiq.me${path}` : path);
```

If nothing is found, skip adding `serverUrl`. Commit any web changes on `feat/ios-wrapper`.

- [ ] **Step 7: Verify**

Run the App test command with `ModelTests/AppSchemeResolverTests` and again with `ModelTests/ServerOriginShimTests`.
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add LocalPackage
git commit -m "feat: serve builds from a custom scheme and reach the server"
```

### Task 9: Build updater

**Files:**
- Create: `LocalPackage/Sources/Model/Wrapper/BuildUpdater.swift`
- Test: `LocalPackage/Tests/ModelTests/WrapperTests/BuildUpdaterTests.swift`

- [ ] **Step 1: Write the failing tests**

```swift
import CryptoKit
import Foundation
import os
import Testing

@testable import DataSource
@testable import Model

@MainActor
struct BuildUpdaterTests {
    private let body = Data("a".utf8)

    private func manifest(_ id: String) -> BuildManifest {
        let hash = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        return BuildManifest(buildId: id, files: [.init(path: "index.html", sha256: hash, size: 1)])
    }

    private func makeUpdater(
        latest: OSAllocatedUnfairLock<BuildManifest?>,
        watchdog: Duration = .seconds(60)
    ) -> BuildUpdater {
        let body = body
        let store = BuildStore(
            root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString),
            fetch: { _ in body }
        )
        return BuildUpdater(
            store: store,
            location: BuildLocation(),
            fetchManifest: {
                guard let value = latest.withLock(\.self) else { throw URLError(.notConnectedToInternet) }
                return value
            },
            watchdog: watchdog
        )
    }

    @Test
    func first_launch_downloads_and_loads_without_asking() async {
        let updater = makeUpdater(latest: .init(initialState: manifest("one")))
        await updater.launch()
        #expect(updater.activeBuildID == "one")
        #expect(updater.pendingBuildID == nil)
        #expect(updater.loadNonce == 1)
    }

    @Test
    func first_launch_offline_reports_it() async {
        let updater = makeUpdater(latest: .init(initialState: nil))
        await updater.launch()
        #expect(updater.needsFirstDownload)
        #expect(updater.activeBuildID == nil)
    }

    @Test
    func a_new_build_waits_for_the_tap() async {
        let latest = OSAllocatedUnfairLock<BuildManifest?>(initialState: manifest("one"))
        let updater = makeUpdater(latest: latest)
        await updater.launch()
        latest.withLock { $0 = manifest("two") }
        await updater.check()
        #expect(updater.activeBuildID == "one")
        #expect(updater.pendingBuildID == "two")
        #expect(updater.loadNonce == 1)

        await updater.applyPending()
        #expect(updater.activeBuildID == "two")
        #expect(updater.pendingBuildID == nil)
        #expect(updater.loadNonce == 2)
    }

    @Test
    func a_build_that_never_signals_ready_rolls_back() async throws {
        let latest = OSAllocatedUnfairLock<BuildManifest?>(initialState: manifest("one"))
        let updater = makeUpdater(latest: latest, watchdog: .milliseconds(20))
        await updater.launch()
        latest.withLock { $0 = manifest("two") }
        await updater.check()
        await updater.applyPending()
        try await Task.sleep(for: .milliseconds(200))
        #expect(updater.activeBuildID == "one")
        #expect(updater.rollbackMessage != nil)
        #expect(updater.loadNonce == 3)

        await updater.check()
        #expect(updater.pendingBuildID == nil)
    }

    @Test
    func a_ready_signal_keeps_the_new_build() async throws {
        let latest = OSAllocatedUnfairLock<BuildManifest?>(initialState: manifest("one"))
        let updater = makeUpdater(latest: latest, watchdog: .milliseconds(20))
        await updater.launch()
        latest.withLock { $0 = manifest("two") }
        await updater.check()
        await updater.applyPending()
        updater.pageReady()
        try await Task.sleep(for: .milliseconds(200))
        #expect(updater.activeBuildID == "two")
    }

    @Test
    func a_failed_check_changes_nothing() async {
        let latest = OSAllocatedUnfairLock<BuildManifest?>(initialState: manifest("one"))
        let updater = makeUpdater(latest: latest)
        await updater.launch()
        latest.withLock { $0 = nil }
        await updater.check()
        #expect(updater.activeBuildID == "one")
        #expect(updater.pendingBuildID == nil)
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run the App test command with `ModelTests/BuildUpdaterTests`.
Expected: FAIL, cannot find `BuildUpdater`.

- [ ] **Step 3: Implement**

```swift
import DataSource
import Foundation
import Observation

@MainActor @Observable public final class BuildUpdater {
    public private(set) var activeBuildID: String?
    public private(set) var pendingBuildID: String?
    public private(set) var needsFirstDownload = false
    public private(set) var isChecking = false
    /// Incremented whenever the web view should load the current build.
    public private(set) var loadNonce = 0
    public var rollbackMessage: String?

    private let store: BuildStore
    private let location: BuildLocation
    private let fetchManifest: @Sendable () async throws -> BuildManifest
    private let watchdog: Duration
    @ObservationIgnored private var watchdogTask: Task<Void, Never>?
    @ObservationIgnored private var rejectedBuildID: String?

    public init(
        store: BuildStore,
        location: BuildLocation,
        fetchManifest: @escaping @Sendable () async throws -> BuildManifest,
        watchdog: Duration = .seconds(15)
    ) {
        self.store = store
        self.location = location
        self.fetchManifest = fetchManifest
        self.watchdog = watchdog
    }

    public func launch() async {
        if let id = await store.pointer().current, let directory = await store.currentDirectory() {
            activeBuildID = id
            location.current = directory
            loadNonce += 1
        }
        await check()
    }

    public func check() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            let manifest = try await fetchManifest()
            guard manifest.buildId != activeBuildID, manifest.buildId != rejectedBuildID else { return }
            try await store.prepare(manifest)
            if activeBuildID == nil {
                try await switchTo(manifest.buildId)
                needsFirstDownload = false
            } else {
                pendingBuildID = manifest.buildId
            }
        } catch {
            if activeBuildID == nil { needsFirstDownload = true }
        }
    }

    public func applyPending() async {
        guard let id = pendingBuildID else { return }
        pendingBuildID = nil
        do {
            try await switchTo(id)
            armWatchdog(for: id)
        } catch {
            rollbackMessage = "The new build could not be applied."
        }
    }

    public func pageReady() {
        watchdogTask?.cancel()
        watchdogTask = nil
    }

    private func switchTo(_ id: String) async throws {
        try await store.activate(id)
        activeBuildID = id
        location.current = await store.currentDirectory()
        loadNonce += 1
    }

    private func armWatchdog(for id: String) {
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self, watchdog] in
            try? await Task.sleep(for: watchdog)
            guard !Task.isCancelled else { return }
            await self?.rollBack(from: id)
        }
    }

    private func rollBack(from id: String) async {
        guard let previous = try? await store.rollback() else { return }
        rejectedBuildID = id
        activeBuildID = previous
        location.current = await store.currentDirectory()
        loadNonce += 1
        rollbackMessage = "Build \(id) did not load, so the previous build was restored."
    }
}
```

- [ ] **Step 4: Verify**

Run the App test command with `ModelTests/BuildUpdaterTests`.
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add LocalPackage
git commit -m "feat: apply new builds on a tap and roll back failures"
```

### Task 10: Mema settings and client

**Files:**
- Create: `LocalPackage/Sources/DataSource/Dictation/MemaCredentials.swift`, `.../MemaCredentialStore.swift`, `.../MemaClient.swift`
- Test: `LocalPackage/Tests/ModelTests/WrapperTests/MemaCredentialsTests.swift`, `.../MemaClientTests.swift`

- [ ] **Step 1: Write the failing tests**

`MemaCredentialsTests.swift`:

```swift
import Foundation
import Testing

@testable import DataSource

struct MemaCredentialsTests {
    @Test
    func parses_the_two_pasted_lines() throws {
        let value = try #require(MemaCredentials.parsePasted(
            "VOICE_API_BASE_URL=https://mema.example/v1/\nVOICE_API_KEY=abc\n"
        ))
        #expect(value.baseURL.absoluteString == "https://mema.example")
        #expect(value.token == "abc")
    }

    @Test
    func strips_quotes() throws {
        let value = try #require(MemaCredentials.parsePasted(
            "VOICE_API_KEY=\"abc\"\nVOICE_API_BASE_URL='https://mema.example'"
        ))
        #expect(value.baseURL.absoluteString == "https://mema.example")
        #expect(value.token == "abc")
    }

    @Test
    func rejects_incomplete_text() {
        #expect(MemaCredentials.parsePasted("VOICE_API_KEY=abc") == nil)
        #expect(MemaCredentials.parsePasted("hello") == nil)
    }
}
```

`MemaClientTests.swift`:

```swift
import Foundation
import os
import Testing

@testable import DataSource

struct MemaClientTests {
    private let credentials = MemaCredentials(baseURL: URL(string: "https://mema.example")!, token: "t")

    private func response(_ url: URL, _ status: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
    }

    private func audioFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).m4a")
        try Data("audio".utf8).write(to: url)
        return url
    }

    @Test
    func uploads_m4a_with_the_token_and_returns_trimmed_text() async throws {
        let captured = OSAllocatedUnfairLock<URLRequest?>(initialState: nil)
        let client = MemaClient(send: { [self] request in
            if request.httpMethod == "POST" { captured.withLock { $0 = request } }
            let data = request.httpMethod == "POST" ? Data(#"{"text":" hola "}"#.utf8) : Data()
            return (data, response(request.url!, 200))
        }, busyDelay: .zero)

        #expect(try await client.transcribe(file: audioFile(), credentials: credentials) == "hola")

        let request = try #require(captured.withLock(\.self))
        #expect(request.url?.absoluteString == "https://mema.example/v1/transcribe")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer t")
        let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
        #expect(body.contains("filename=\"audio.m4a\""))
        #expect(body.contains("Content-Type: audio/mp4"))
        #expect(body.contains("name=\"cleanup_mode\""))
    }

    @Test
    func retries_a_busy_server_twice_then_fails() async throws {
        let posts = OSAllocatedUnfairLock(initialState: 0)
        let client = MemaClient(send: { [self] request in
            if request.httpMethod == "POST" { posts.withLock { $0 += 1 } }
            let status = request.httpMethod == "POST" ? 503 : 200
            return (Data(), response(request.url!, status, headers: ["Retry-After": "1"]))
        }, busyDelay: .zero)

        await #expect(throws: MemaClient.Failure.busy) {
            try await client.transcribe(file: audioFile(), credentials: credentials)
        }
        #expect(posts.withLock(\.self) == 3)
    }

    @Test
    func an_absent_server_is_unreachable() async throws {
        let client = MemaClient(send: { _ in throw URLError(.cannotConnectToHost) }, busyDelay: .zero)
        await #expect(throws: MemaClient.Failure.unreachable) {
            try await client.transcribe(file: audioFile(), credentials: credentials)
        }
    }

    @Test
    func other_statuses_are_reported() async throws {
        let client = MemaClient(send: { [self] request in
            (Data(), response(request.url!, request.httpMethod == "POST" ? 401 : 200))
        }, busyDelay: .zero)
        await #expect(throws: MemaClient.Failure.status(401)) {
            try await client.transcribe(file: audioFile(), credentials: credentials)
        }
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run the App test command with `ModelTests/MemaCredentialsTests` and again with `ModelTests/MemaClientTests`.
Expected: FAIL, cannot find the types.

- [ ] **Step 3: Implement credentials**

```swift
import Foundation

public struct MemaCredentials: Equatable, Sendable {
    public let baseURL: URL
    public let token: String

    public init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    public init?(urlText: String, token: String) {
        var text = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        if text.hasSuffix("/v1") { text.removeLast(3) }
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, let url = URL(string: text), url.scheme != nil, url.host() != nil else { return nil }
        self.init(baseURL: url, token: token)
    }

    public static func parsePasted(_ text: String) -> MemaCredentials? {
        var values: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = line[..<separator].trimmingCharacters(in: .whitespaces)
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: "\"'")))
            values[key] = value
        }
        guard let url = values["VOICE_API_BASE_URL"], let token = values["VOICE_API_KEY"] else { return nil }
        return MemaCredentials(urlText: url, token: token)
    }
}
```

- [ ] **Step 4: Implement the client**

```swift
import Foundation

public struct MemaClient: Sendable {
    public typealias Send = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    public enum Failure: Error, Equatable {
        case unreachable
        case busy
        case status(Int)
        case invalidResponse
    }

    private struct Transcript: Decodable {
        let text: String
    }

    private static let maxBusyRetries = 2
    private let send: Send
    private let busyDelay: Duration

    public init(send: @escaping Send, busyDelay: Duration = .seconds(2)) {
        self.send = send
        self.busyDelay = busyDelay
    }

    public static let live = MemaClient(send: { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    })

    public func transcribe(file: URL, credentials: MemaCredentials) async throws -> String {
        try await probe(credentials.baseURL)
        let request = try Self.uploadRequest(file: file, credentials: credentials)

        var retries = 0
        while true {
            let (data, response): (Data, HTTPURLResponse)
            do {
                (data, response) = try await send(request)
            } catch {
                throw Failure.unreachable
            }
            switch response.statusCode {
            case 200:
                guard let transcript = try? JSONDecoder().decode(Transcript.self, from: data) else {
                    throw Failure.invalidResponse
                }
                return transcript.text.trimmingCharacters(in: .whitespacesAndNewlines)
            case 503 where response.value(forHTTPHeaderField: "Retry-After") != nil:
                guard retries < Self.maxBusyRetries else { throw Failure.busy }
                retries += 1
                try await Task.sleep(for: busyDelay)
            default:
                throw Failure.status(response.statusCode)
            }
        }
    }

    /// URLSession has no connect timeout, so a short request tells an absent
    /// server apart from a slow transcription. Any HTTP response means it is there.
    private func probe(_ baseURL: URL) async throws {
        var request = URLRequest(url: baseURL)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 3
        do {
            _ = try await send(request)
        } catch {
            throw Failure.unreachable
        }
    }

    private static func uploadRequest(file: URL, credentials: MemaCredentials) throws -> URLRequest {
        let boundary = "cloudcli-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"cleanup_mode\"\r\n\r\nraw\r\n".utf8))
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".utf8))
        body.append(try Data(contentsOf: file))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: credentials.baseURL.appending(path: "v1/transcribe"))
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }
}
```

- [ ] **Step 5: Implement credential storage**

```swift
import Foundation
import Security

public struct MemaCredentialStore: Sendable {
    private static let urlKey = "mema-base-url"
    private static let service = "me.chiq.cloudcli.mema"
    private static let account = "bearerToken"

    public init() {}

    public func load() -> MemaCredentials? {
        guard let url = UserDefaults.standard.string(forKey: Self.urlKey), let token = readToken() else { return nil }
        return MemaCredentials(urlText: url, token: token)
    }

    public func save(_ credentials: MemaCredentials) {
        UserDefaults.standard.set(credentials.baseURL.absoluteString, forKey: Self.urlKey)
        let query = Self.query
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = Data(credentials.token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func readToken() -> String? {
        var query = Self.query
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
```

- [ ] **Step 6: Verify**

Run the App test command with `ModelTests/MemaCredentialsTests` and again with `ModelTests/MemaClientTests`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add LocalPackage
git commit -m "feat: add the mema client and its settings"
```

### Task 11: Recording and the dictation state machine

**Files:**
- Create: `LocalPackage/Sources/DataSource/Dictation/PendingRecordingStore.swift`, `.../DictationRecorder.swift`, `LocalPackage/Sources/Model/Wrapper/DictationController.swift`
- Test: `LocalPackage/Tests/ModelTests/WrapperTests/DictationControllerTests.swift`

- [ ] **Step 1: Add storage and the recorder**

`PendingRecordingStore.swift`:

```swift
import Foundation

public struct PendingRecordingStore: Sendable {
    private let root: URL

    public init(root: URL) {
        self.root = root
    }

    public func newFile() throws -> URL {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appending(path: "\(UUID().uuidString).m4a")
    }

    /// Oldest first.
    public func all() -> [URL] {
        let keys: [URLResourceKey] = [.creationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: keys)) ?? []
        func created(_ url: URL) -> Date {
            (try? url.resourceValues(forKeys: Set(keys)).creationDate) ?? .distantPast
        }
        return files.filter { $0.pathExtension == "m4a" }.sorted { created($0) < created($1) }
    }

    public func delete(_ file: URL) {
        try? FileManager.default.removeItem(at: file)
    }
}
```

`DictationRecorder.swift`, using Fonos's settings of 16 kHz mono AAC at 48 kbps:

```swift
import AVFoundation

@MainActor
public protocol DictationRecording: AnyObject {
    func requestPermission() async -> Bool
    func start(to file: URL) throws
    func stop()
}

@MainActor
public final class DictationRecorder: DictationRecording {
    private var recorder: AVAudioRecorder?

    public init() {}

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func start(to file: URL) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
        ]
        let recorder = try AVAudioRecorder(url: file, settings: settings)
        guard recorder.record() else { throw URLError(.cannotCreateFile) }
        self.recorder = recorder
    }

    public func stop() {
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
```

- [ ] **Step 2: Write the failing tests**

```swift
import Foundation
import os
import Testing

@testable import DataSource
@testable import Model

@MainActor
final class FakeRecorder: DictationRecording {
    var granted = true
    var stopCount = 0

    func requestPermission() async -> Bool { granted }

    func start(to file: URL) throws {
        try Data("audio".utf8).write(to: file)
    }

    func stop() {
        stopCount += 1
    }
}

@MainActor
struct DictationControllerTests {
    final class Sink {
        var inserted: [String] = []
        var sends = 0
        var clipboard: String?
        var insertSucceeds = true
    }

    private let credentials = MemaCredentials(baseURL: URL(string: "https://mema.example")!, token: "t")

    private func makeController(
        recorder: FakeRecorder = FakeRecorder(),
        sink: Sink,
        store: PendingRecordingStore,
        status: OSAllocatedUnfairLock<Int>,
        hasCredentials: Bool = true
    ) -> DictationController {
        let client = MemaClient(send: { request in
            let code = request.httpMethod == "POST" ? status.withLock(\.self) : 200
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"text":"hola"}"#.utf8), response)
        }, busyDelay: .zero)
        let available = hasCredentials ? credentials : nil
        return DictationController(
            recorder: recorder,
            store: store,
            client: client,
            credentials: { available },
            insert: { text in
                sink.inserted.append(text)
                return sink.insertSucceeds
            },
            send: { sink.sends += 1 },
            copy: { sink.clipboard = $0 }
        )
    }

    private func makeStore() -> PendingRecordingStore {
        PendingRecordingStore(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    @Test
    func happy_path_runs_voice_stop_return_idle() async {
        let sink = Sink()
        let store = makeStore()
        let sut = makeController(sink: sink, store: store, status: .init(initialState: 200))
        await sut.voiceTapped()
        #expect(sut.state == .recording)
        await sut.stopTapped()
        #expect(sut.state == .readyToSend)
        #expect(sink.inserted == ["hola"])
        #expect(store.all().isEmpty)
        await sut.returnTapped()
        #expect(sut.state == .idle)
        #expect(sink.sends == 1)
    }

    @Test
    func cancel_discards_the_recording() async {
        let sink = Sink()
        let store = makeStore()
        let recorder = FakeRecorder()
        let sut = makeController(recorder: recorder, sink: sink, store: store, status: .init(initialState: 200))
        await sut.voiceTapped()
        sut.cancelTapped()
        #expect(sut.state == .idle)
        #expect(recorder.stopCount == 1)
        #expect(store.all().isEmpty)
        #expect(sink.inserted.isEmpty)
    }

    @Test
    func a_failure_keeps_the_recording_and_shows_the_bar() async {
        let store = makeStore()
        let sut = makeController(sink: Sink(), store: store, status: .init(initialState: 500))
        await sut.voiceTapped()
        await sut.stopTapped()
        #expect(sut.state == .idle)
        #expect(sut.failedCount == 1)
        #expect(store.all().count == 1)
    }

    @Test
    func a_successful_retry_copies_and_removes_the_recording() async {
        let sink = Sink()
        let store = makeStore()
        let status = OSAllocatedUnfairLock(initialState: 500)
        let sut = makeController(sink: sink, store: store, status: status)
        await sut.voiceTapped()
        await sut.stopTapped()
        status.withLock { $0 = 200 }
        await sut.retryAndCopyTapped()
        #expect(sink.clipboard == "hola")
        #expect(sink.inserted.isEmpty)
        #expect(sut.failedCount == 0)
        #expect(store.all().isEmpty)
    }

    @Test
    func a_failed_retry_keeps_the_bar() async {
        let store = makeStore()
        let sut = makeController(sink: Sink(), store: store, status: .init(initialState: 500))
        await sut.voiceTapped()
        await sut.stopTapped()
        await sut.retryAndCopyTapped()
        #expect(sut.failedCount == 1)
        #expect(store.all().count == 1)
    }

    @Test
    func failed_recordings_return_on_next_launch() throws {
        let store = makeStore()
        try Data("audio".utf8).write(to: store.newFile())
        let sut = makeController(sink: Sink(), store: store, status: .init(initialState: 200))
        sut.loadPending()
        #expect(sut.failedCount == 1)
    }

    @Test
    func dismiss_removes_the_recording() async {
        let store = makeStore()
        let sut = makeController(sink: Sink(), store: store, status: .init(initialState: 500))
        await sut.voiceTapped()
        await sut.stopTapped()
        sut.dismissFailedTapped()
        #expect(sut.failedCount == 0)
        #expect(store.all().isEmpty)
    }

    @Test
    func text_with_no_composer_on_screen_goes_to_the_clipboard() async {
        let sink = Sink()
        sink.insertSucceeds = false
        let sut = makeController(sink: sink, store: makeStore(), status: .init(initialState: 200))
        await sut.voiceTapped()
        await sut.stopTapped()
        #expect(sink.clipboard == "hola")
        #expect(sut.state == .idle)
    }

    @Test
    func denied_permission_does_not_record() async {
        let recorder = FakeRecorder()
        recorder.granted = false
        let sut = makeController(recorder: recorder, sink: Sink(), store: makeStore(), status: .init(initialState: 200))
        await sut.voiceTapped()
        #expect(sut.state == .idle)
        #expect(sut.permissionDenied)
    }

    @Test
    func missing_settings_keep_the_recording() async {
        let store = makeStore()
        let sut = makeController(sink: Sink(), store: store, status: .init(initialState: 200), hasCredentials: false)
        await sut.voiceTapped()
        await sut.stopTapped()
        #expect(sut.failedCount == 1)
        #expect(store.all().count == 1)
    }
}
```

- [ ] **Step 3: Run them to verify they fail**

Run the App test command with `ModelTests/DictationControllerTests`.
Expected: FAIL, cannot find `DictationController`.

- [ ] **Step 4: Implement**

```swift
import DataSource
import Foundation
import Observation

@MainActor @Observable public final class DictationController {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        case transcribing
        case readyToSend
    }

    public private(set) var state = State.idle
    public private(set) var failed: [URL] = []
    public private(set) var isRetrying = false
    public var permissionDenied = false

    public var failedCount: Int { failed.count }

    private let recorder: any DictationRecording
    private let store: PendingRecordingStore
    private let client: MemaClient
    private let credentials: @MainActor () -> MemaCredentials?
    private let insert: @MainActor (String) async -> Bool
    private let send: @MainActor () async -> Void
    private let copy: @MainActor (String) -> Void
    @ObservationIgnored private var currentFile: URL?

    public init(
        recorder: any DictationRecording,
        store: PendingRecordingStore,
        client: MemaClient,
        credentials: @escaping @MainActor () -> MemaCredentials?,
        insert: @escaping @MainActor (String) async -> Bool,
        send: @escaping @MainActor () async -> Void,
        copy: @escaping @MainActor (String) -> Void
    ) {
        self.recorder = recorder
        self.store = store
        self.client = client
        self.credentials = credentials
        self.insert = insert
        self.send = send
        self.copy = copy
    }

    public func loadPending() {
        failed = store.all()
    }

    public func voiceTapped() async {
        guard state == .idle else { return }
        guard await recorder.requestPermission() else {
            permissionDenied = true
            return
        }
        do {
            let file = try store.newFile()
            try recorder.start(to: file)
            currentFile = file
            state = .recording
        } catch {
            state = .idle
        }
    }

    public func cancelTapped() {
        guard state == .recording, let file = currentFile else { return }
        recorder.stop()
        store.delete(file)
        currentFile = nil
        state = .idle
    }

    public func stopTapped() async {
        guard state == .recording, let file = currentFile else { return }
        recorder.stop()
        currentFile = nil
        state = .transcribing
        do {
            let text = try await transcribe(file)
            store.delete(file)
            guard !text.isEmpty else {
                state = .idle
                return
            }
            if await insert(text) {
                state = .readyToSend
            } else {
                copy(text)
                state = .idle
            }
        } catch {
            failed.append(file)
            state = .idle
        }
    }

    public func returnTapped() async {
        guard state == .readyToSend else { return }
        await send()
        state = .idle
    }

    /// Retries the oldest failed recording.
    public func retryAndCopyTapped() async {
        guard !isRetrying, let file = failed.first else { return }
        isRetrying = true
        defer { isRetrying = false }
        guard let text = try? await transcribe(file) else { return }
        copy(text)
        store.delete(file)
        failed.removeFirst()
    }

    public func dismissFailedTapped() {
        guard let file = failed.first else { return }
        store.delete(file)
        failed.removeFirst()
    }

    private func transcribe(_ file: URL) async throws -> String {
        guard let credentials = credentials() else { throw MemaClient.Failure.unreachable }
        return try await client.transcribe(file: file, credentials: credentials)
    }
}
```

- [ ] **Step 5: Verify**

Run the App test command with `ModelTests/DictationControllerTests`.
Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add LocalPackage
git commit -m "feat: add native dictation with retry for failed recordings"
```

### Task 12: Wire it together

**Files:**
- Create: `LocalPackage/Sources/Model/Wrapper/AppServices.swift`, `LocalPackage/Sources/UserInterface/Wrapper/WrapperOverlay.swift`, `.../Wrapper/MemaSettingsView.swift`
- Modify: `LocalPackage/Sources/UserInterface/Extensions/WebKit+Extension.swift`, `.../Views/BrowserView.swift`, `.../Scenes/BrowserScene.swift`, `LocalPackage/Sources/DataSource/Dependencies/WebViewProxyClient.swift`

- [ ] **Step 1: Confirm the WebUI API**

Run from the repo root after any build has resolved packages:

```bash
grep -rn "func evaluateJavaScript" ~/Library/Developer/Xcode/DerivedData/Telescopure-*/SourcePackages/checkouts/WebUI/Sources
```

Expected: an async `evaluateJavaScript` on `WebViewProxy`. If the signature returns `Any` rather than throwing, adjust the closure in Step 2 to match.

- [ ] **Step 2: Add JavaScript evaluation to the proxy client**

In `WebViewProxyClient.swift`, add the property, and add a line to each value:

```swift
    public var evaluateJavaScript: @Sendable (String) async -> Bool
```

In `liveValue`:

```swift
            evaluateJavaScript: { script in
                ((try? await proxy().evaluateJavaScript(script)) as? Bool) ?? false
            },
```

In `testValue`:

```swift
        evaluateJavaScript: { _ in false },
```

Place each directly after the `loadHTMLString` line in that value, because the memberwise initialiser follows declaration order. Declare the property directly after `loadHTMLString` too.

- [ ] **Step 3: Add the services**

`AppServices.swift`:

```swift
import DataSource
import Foundation
import Observation
import UIKit
import WebKit

private final class ScriptBridge: NSObject, WKScriptMessageHandler {
    private let onReady: @MainActor () -> Void

    init(onReady: @escaping @MainActor () -> Void) {
        self.onReady = onReady
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard (message.body as? [String: Any])?["type"] as? String == "ready" else { return }
        MainActor.assumeIsolated { onReady() }
    }
}

@MainActor @Observable public final class AppServices {
    public let updater: BuildUpdater
    public let dictation: DictationController
    public let credentials = MemaCredentialStore()
    public let webViewConfiguration: WKWebViewConfiguration

    public static func live() -> AppServices {
        AppServices(webViewProxyClient: AppDependencies.shared.webViewProxyClient)
    }

    public init(webViewProxyClient: WebViewProxyClient) {
        let support = URL.applicationSupportDirectory
        let location = BuildLocation()
        let store = BuildStore(root: support.appending(path: "WebBuilds")) { path in
            var request = URLRequest(url: AppScheme.server.appending(path: path))
            request.cachePolicy = .reloadIgnoringLocalCacheData
            return try await URLSession.shared.data(for: request).0
        }
        let updater = BuildUpdater(store: store, location: location, fetchManifest: { try await BuildManifest.fetch() })
        self.updater = updater

        let credentialStore = credentials
        dictation = DictationController(
            recorder: DictationRecorder(),
            store: PendingRecordingStore(root: support.appending(path: "Recordings")),
            client: .live,
            credentials: { credentialStore.load() },
            insert: { text in
                guard let data = try? JSONEncoder().encode([text]),
                      let json = String(data: data, encoding: .utf8) else { return false }
                let script = "window.__nativeDictation ? window.__nativeDictation.insert(\(json)[0]) : false"
                return await webViewProxyClient.evaluateJavaScript(script)
            },
            send: {
                _ = await webViewProxyClient.evaluateJavaScript(
                    "window.__nativeDictation ? window.__nativeDictation.send() : false"
                )
            },
            copy: { UIPasteboard.general.string = $0 }
        )

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsInlinePredictions = true
        configuration.applicationNameForUserAgent = "Safari/604.1"
        configuration.setURLSchemeHandler(AppSchemeHandler(location: location), forURLScheme: AppScheme.scheme)
        configuration.userContentController.addUserScript(WKUserScript(
            source: ServerOriginShim.source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController.add(
            ScriptBridge(onReady: { updater.pageReady() }),
            name: AppScheme.bridgeName
        )
        webViewConfiguration = configuration
    }
}
```

Delete the now-unused `forTelescopure` extension from `WebKit+Extension.swift`. If the file is then empty, `git rm` it.

- [ ] **Step 4: Add the settings view**

`MemaSettingsView.swift`:

```swift
import DataSource
import SwiftUI
import UIKit

struct MemaSettingsView: View {
    let store: MemaCredentialStore
    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""
    @State private var token = ""
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Mema server") {
                    TextField("https://…", text: $urlText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Bearer token", text: $token)
                }
                Section {
                    Button("Paste from clipboard", action: paste)
                }
                if let message {
                    Text(message).foregroundStyle(.red)
                }
            }
            .navigationTitle("Dictation")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                if let saved = store.load() {
                    urlText = saved.baseURL.absoluteString
                    token = saved.token
                }
            }
        }
    }

    private func paste() {
        guard let value = UIPasteboard.general.string.flatMap(MemaCredentials.parsePasted) else {
            message = "The clipboard does not hold the two VOICE_API lines."
            return
        }
        urlText = value.baseURL.absoluteString
        token = value.token
        message = nil
    }

    private func save() {
        guard let value = MemaCredentials(urlText: urlText, token: token) else {
            message = "Enter a full URL and a token."
            return
        }
        store.save(value)
        dismiss()
    }
}
```

- [ ] **Step 5: Add the overlay**

`WrapperOverlay.swift`:

```swift
import Model
import SwiftUI

struct WrapperOverlay: View {
    let services: AppServices
    let isToolbarVisible: Bool
    @Environment(\.openURL) private var openURL
    @State private var isPresentedSettings = false

    private var updater: BuildUpdater { services.updater }
    private var dictation: DictationController { services.dictation }

    var body: some View {
        VStack(spacing: 8) {
            if dictation.failedCount > 0 {
                failedBar
            }
            if let message = updater.rollbackMessage {
                Button(message) { updater.rollbackMessage = nil }
                    .font(.footnote)
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
            }
            if updater.pendingBuildID != nil {
                Button("New build") { Task { await updater.applyPending() } }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.borderedProminent)
                    .clipShape(Capsule())
            }
            if isToolbarVisible {
                tools
            }
            Spacer()
            HStack {
                dictationControl
                Spacer()
            }
            .padding(20)
        }
        .sheet(isPresented: $isPresentedSettings) {
            MemaSettingsView(store: services.credentials)
        }
        .alert("Microphone access is off", isPresented: Binding(
            get: { dictation.permissionDenied },
            set: { dictation.permissionDenied = $0 }
        )) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var failedBar: some View {
        HStack {
            Text("Transcription failed").font(.footnote.weight(.semibold))
            Spacer()
            Button(dictation.isRetrying ? "Retrying…" : "Retry and copy") {
                Task { await dictation.retryAndCopyTapped() }
            }
            .disabled(dictation.isRetrying)
            Button("Dismiss", systemImage: "xmark") { dictation.dismissFailedTapped() }
                .labelStyle(.iconOnly)
        }
        .foregroundStyle(.white)
        .tint(.white)
        .padding(10)
        .background(.red)
    }

    private var tools: some View {
        HStack(spacing: 16) {
            Button(updater.isChecking ? "Checking…" : "Reload assets") { Task { await updater.check() } }
                .disabled(updater.isChecking)
            Button("Dictation") { isPresentedSettings = true }
        }
        .font(.footnote)
        .buttonStyle(.bordered)
    }

    @ViewBuilder
    private var dictationControl: some View {
        switch dictation.state {
        case .idle:
            control("mic.fill", label: "Dictate") { await dictation.voiceTapped() }
        case .recording:
            HStack(spacing: 12) {
                control("stop.fill", label: "Stop", tint: .red) { await dictation.stopTapped() }
                control("xmark", label: "Cancel", tint: .gray) { dictation.cancelTapped() }
            }
        case .transcribing:
            ProgressView().padding(14).background(.regularMaterial, in: Circle())
        case .readyToSend:
            control("return", label: "Send") { await dictation.returnTapped() }
        }
    }

    private func control(
        _ systemImage: String,
        label: String,
        tint: Color = .accentColor,
        action: @escaping @MainActor () async -> Void
    ) -> some View {
        Button { Task { await action() } } label: {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(width: 48, height: 48)
                .foregroundStyle(.white)
                .background(tint, in: Circle())
        }
        .accessibilityLabel(label)
    }
}

struct FirstDownloadView: View {
    let isChecking: Bool
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("CloudCLI needs a connection for its first download.")
                .multilineTextAlignment(.center)
            Button(isChecking ? "Checking…" : "Retry", action: retry)
                .disabled(isChecking)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
```

- [ ] **Step 6: Connect the view**

In `BrowserView.swift`:

Add below `@StateObject var store: Browser`:

```swift
    let services: AppServices
    @Environment(\.scenePhase) private var scenePhase
    // A notification tapped with the app closed arrives before any build has
    // loaded, and the first load of the root would otherwise replace it.
    @State private var pendingOpenURL: URL?
```

Replace `WebView(configuration: .forTelescopure)` with:

```swift
                        WebView(configuration: services.webViewConfiguration)
```

Replace the existing `.overlay { if proxy.url == nil { LogoView() } }` with:

```swift
                            .overlay {
                                if services.updater.needsFirstDownload {
                                    FirstDownloadView(isChecking: services.updater.isChecking) {
                                        Task { await services.updater.check() }
                                    }
                                } else if proxy.url == nil {
                                    LogoView()
                                }
                            }
```

Extend the existing `.task` on the `NavigationStack`, adding after the `store.send(.task(...))` call:

```swift
                    services.dictation.loadPending()
                    await services.updater.launch()
```

Add next to the `.onChange(of: proxy.url)` modifier:

```swift
                .onChange(of: services.updater.loadNonce) { _, _ in
                    proxy.load(request: URLRequest(url: AppScheme.root))
                    if let url = pendingOpenURL {
                        pendingOpenURL = nil
                        Task { await store.send(.onOpenURL(url)) }
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await services.updater.check() }
                }
```

Replace the existing `.onOpenURL` modifier:

```swift
        .onOpenURL { url in
            if services.updater.loadNonce == 0 {
                pendingOpenURL = url
                return
            }
            Task {
                await store.send(.onOpenURL(url))
            }
        }
```

Add `import DataSource` at the top. Add this after the outermost `.ignoresSafeArea(.keyboard, edges: .bottom)`, so the control rises with the keyboard:

```swift
        .overlay {
            WrapperOverlay(services: services, isToolbarVisible: store.isPresentedToolbar)
        }
```

Fix the `#Preview` to pass `services: AppServices(webViewProxyClient: .testValue)`.

In `BrowserScene.swift`:

```swift
public struct BrowserScene: Scene {
    @Environment(\.appDependencies) private var appDependencies
    @State private var services = AppServices.live()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            BrowserView(store: .init(appDependencies, isPresentedToolbar: false), services: services)
                .resolvesFoldableLayout()
        }
    }
}
```

- [ ] **Step 7: Verify the whole app builds and passes**

Run the App test command with `ModelTests`.
Expected: all pass.

- [ ] **Step 8: Check it in the simulator against a real build**

Run the `run` skill to launch the app in the simulator. Expected after the web changes are live (Task 13): the app loads the interface from `cloudcli://app/`, and login works. Before then, the first-download screen appears, because `asset-manifest.json` does not exist on the server yet. Confirm that screen now.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: run claudecodeui from stored builds with native dictation"
```

### Task 13: Deploy and verify on the phone

**Files:** created by the deploy skill.

- [ ] **Step 1: Set up OTA deploy**

Invoke the `ios-ota-deploy` skill in `~/c/third-parties/cloudcli-ios` and follow it, using bundle ID `me.chiq.cloudcli` and app name `CloudCLI`. Confirm that the entitlement removed in Task 6 stayed removed, since the ad hoc profile cannot carry it.

- [ ] **Step 2: USER STEP: ntfy settings**

Claude cannot touch `.env`. The user adds these to `~/c/third-parties/claudecodeui/.env`, using the server URL and topic they want. `NTFY_TOKEN` is needed only if the server requires it.

```
NTFY_URL=https://ntfy.chiq.me
NTFY_TOPIC=cloudcli
NTFY_TOKEN=
```

- [ ] **Step 3: Publish the web changes**

Ask the user before running this, because it restarts the running server:

```bash
cd ~/c/third-parties/claudecodeui && npm run build && ./serve
```

Confirm the manifest is served:

```bash
curl -s https://claude.chiq.me/asset-manifest.json | head -c 120
```

Expected: JSON starting with `{"buildId":`.

- [ ] **Step 4: Deploy the app**

Run the `./deploy` command created in Step 1, and give the user the install link it prints.

- [ ] **Step 5: USER STEP: mema settings**

On the macmini, the user runs the command below. Then, on the phone, they open the toolbar, tap Dictation, tap "Paste from clipboard", and tap Save.

```bash
grep -E '^VOICE_API_(BASE_URL|KEY)=' ~/c/third-parties/claudecodeui/.env | pbcopy
```

- [ ] **Step 6: USER STEP: verify on the phone**

- [ ] Sign in once. The chat list loads, and live updates arrive over the socket.
- [ ] Content clears the notch and the home indicator.
- [ ] Force quit, enable airplane mode, and reopen. The interface appears immediately with its connection error.
- [ ] Run `npm run build` after a visible change, return to the app, and tap the "New build" pill. A chat in progress is not reloaded before the tap.
- [ ] Deploy a build whose `App` throws on mount. After the 15 seconds, the previous build returns with a message. Remove the throw afterwards.
- [ ] Dictate: the mic becomes stop and cancel, then return, and the text lands in the composer. Return sends it. The keyboard stays open.
- [ ] Dictate with mema unreachable. The red bar appears, survives a force quit, and "Retry and copy" puts the text on the clipboard once mema is back.
- [ ] Trigger a notification with ntfy configured, and tap it, once with the app open and once with it force quit. The session opens in CloudCLI both times. If ntfy will not open a custom scheme, report it, because the spec's click URL would need another route.
- [ ] Share a link into the app from Safari using the share extension. It opens in the app.
