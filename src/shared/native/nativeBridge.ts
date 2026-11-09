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
