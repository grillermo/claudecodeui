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
