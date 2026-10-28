import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.owca217.webmmorpg',
  appName: 'WEB MMORPG',
  webDir: 'dist-android',
  backgroundColor: '#111318',
  loggingBehavior: 'debug',
  plugins: {
    SystemBars: { hidden: true }
  },
  android: {
    minWebViewVersion: 111,
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  },
  server: {
    androidScheme: 'https',
    cleartext: false,
    errorPath: 'webview-error.html'
  }
};

export default config;
