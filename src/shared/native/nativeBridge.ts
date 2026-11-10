type NativeDictation = { insert: (text: string) => boolean; send: () => boolean };

declare global {
  interface Window {
    webkit?: { messageHandlers?: { cloudcliBridge?: { postMessage: (message: unknown) => void } } };
    __nativeDictation?: NativeDictation;
  }
}

export const isNativeWrapper = (): boolean => Boolean(window.webkit?.messageHandlers?.cloudcliBridge);

async function readBuildId(): Promise<string | undefined> {
  try {
    const response = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const manifest = (await response.json()) as { buildId?: unknown };
    return typeof manifest.buildId === 'string' ? manifest.buildId : undefined;
  } catch {
    return undefined;
  }
}

// Tells the wrapper the page loaded, with the build it is running so a late signal from a
// build that was rolled back is ignored. Falls back to a bare ready if the manifest is unreadable.
export async function notifyNativeReady(): Promise<void> {
  const handler = window.webkit?.messageHandlers?.cloudcliBridge;
  if (!handler) return;
  const buildId = await readBuildId();
  handler.postMessage(buildId ? { type: 'ready', buildId } : { type: 'ready' });
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
