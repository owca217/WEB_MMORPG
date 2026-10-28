// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: true }));
const events = vi.hoisted(() => new Map<string, (...args: any[]) => void>());
const minimizeApp = vi.hoisted(() => vi.fn(async () => undefined));
const socket = vi.hoisted(() => ({
  onConnectionState: vi.fn(), onReauthenticated: vi.fn(),
  requestPlayerState: vi.fn(), requestWorldState: vi.fn()
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
vi.mock('@capacitor/app', () => ({ App: {
  addListener: vi.fn(async (event: string, handler: (...args: any[]) => void) => {
    events.set(event, handler);
    return { remove: async () => { events.delete(event); } };
  }), minimizeApp
} }));
vi.mock('../src/net/GameSocket', () => ({ gameSocket: socket }));
vi.mock('../src/state/SessionStateStore', () => ({ sessionStateStore: { getToken: () => 'test-session' } }));
import { initializeNativeClient } from '../src/native/nativeLifecycle';

beforeEach(() => {
  vi.clearAllMocks(); events.clear(); native.value = true;
  document.body.innerHTML = '';
  socket.onConnectionState.mockImplementation((handler) => { events.set('connection', handler); return vi.fn(); });
  socket.onReauthenticated.mockImplementation((handler) => { events.set('reauthenticated', handler); return vi.fn(); });
});

describe('Android lifecycle', () => {
  it('leaves a browser client alone', async () => {
    native.value = false;
    await initializeNativeClient({ reload: vi.fn() });
    expect(events.size).toBe(0);
  });

  it('preserves a live battle on a short background visit and refreshes snapshots on return', async () => {
    const reload = vi.fn();
    await initializeNativeClient({ reload });
    events.get('connection')!('connected');
    events.get('appStateChange')!({ isActive: false });
    events.get('appStateChange')!({ isActive: true });
    expect(reload).not.toHaveBeenCalled();
    expect(socket.requestPlayerState).toHaveBeenCalledOnce();
    expect(socket.requestWorldState).toHaveBeenCalledOnce();
  });

  it('boots a fresh scene after reconnection because the old server battle was discarded', async () => {
    const reload = vi.fn();
    await initializeNativeClient({ reload });
    events.get('connection')!('disconnected');
    events.get('appStateChange')!({ isActive: true });
    events.get('reauthenticated')!({ ok: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('closes an open panel before minimizing and removes native listeners on cleanup', async () => {
    document.body.innerHTML = '<div class="game-panel"><button data-close>Zamknij</button></div>';
    const close = vi.fn(); document.querySelector('button')!.addEventListener('click', close);
    const cleanup = await initializeNativeClient({ reload: vi.fn() });
    await events.get('backButton')!({ canGoBack: false });
    expect(close).toHaveBeenCalledOnce();
    expect(minimizeApp).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    await events.get('backButton')!({ canGoBack: false });
    expect(minimizeApp).toHaveBeenCalledOnce();
    await cleanup();
    expect(events.has('backButton')).toBe(false);
    expect(events.has('appStateChange')).toBe(false);
  });

  it('closes the foreground panel before a dialogue created later behind it', async () => {
    document.body.innerHTML = '<div class="game-panel" style="z-index:1100"><button data-close id="front">Postać</button></div><div class="dialogue-panel" style="z-index:1050"><button data-close id="behind">Rozmowa</button></div>';
    const front = vi.fn(); const behind = vi.fn();
    document.getElementById('front')!.addEventListener('click', front);
    document.getElementById('behind')!.addEventListener('click', behind);
    await initializeNativeClient({ reload: vi.fn() });
    events.get('backButton')!({ canGoBack: false });
    expect(front).toHaveBeenCalledOnce();
    expect(behind).not.toHaveBeenCalled();
  });
});
