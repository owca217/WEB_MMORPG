import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { gameSocket, type ConnectionState } from '../net/GameSocket';
import { sessionStateStore } from '../state/SessionStateStore';
import { closeForegroundGamePanel } from '../ui/gameWindows';

export async function initializeNativeClient(
  options: { reload?: () => void } = {}
): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined;
  let connection: ConnectionState = 'connecting';
  let rebooting = false;
  const reboot = (): void => {
    if (rebooting) return;
    rebooting = true;
    (options.reload ?? (() => window.location.reload()))();
  };
  const stopConnection = gameSocket.onConnectionState((state) => { connection = state; });
  // A new server connection has no old battle. Boot restores the saved account and world.
  const stopReauthenticated = gameSocket.onReauthenticated(() => reboot());
  const stateListener = await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive || !sessionStateStore.getToken()) return;
    if (connection !== 'connected') {
      reboot();
    } else {
      gameSocket.requestPlayerState();
      gameSocket.requestWorldState();
    }
  });
  const backListener = await App.addListener('backButton', () => {
    if (closeForegroundGamePanel()) return;
    const back = new Event('game-ui-back', { cancelable: true });
    document.dispatchEvent(back);
    if (!back.defaultPrevented) void App.minimizeApp();
  });
  return async () => {
    stopConnection();
    stopReauthenticated();
    await Promise.all([stateListener.remove(), backListener.remove()]);
  };
}
