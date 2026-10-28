import { describe, expect, it } from 'vitest';
import { getAndroidBuildEnvironment } from '../../../scripts/build-android-client.mjs';

describe('bundled Android client', () => {
  it('uses local bundled assets and the shared HTTPS game server regardless of web hosting defaults', () => {
    const env = getAndroidBuildEnvironment({ VITE_BASE_PATH: '/WEB_MMORPG/', VITE_GAME_SERVER_URL: '' });
    expect(env.VITE_BASE_PATH).toBe('/');
    expect(env.VITE_GAME_SERVER_URL).toBe('https://web-mmorpg-server.onrender.com');
  });

  it('permits a separately configured HTTPS game server without sending credentials in the URL', () => {
    expect(getAndroidBuildEnvironment({ ANDROID_GAME_SERVER_URL: 'https://game.example.test/' }).VITE_GAME_SERVER_URL)
      .toBe('https://game.example.test');
    for (const url of ['http://game.example.test', 'https://user:password@game.example.test', 'https://game.example.test/?token=secret', 'https://game.example.test/api']) {
      expect(() => getAndroidBuildEnvironment({ ANDROID_GAME_SERVER_URL: url })).toThrow('ANDROID_SERVER_MUST_BE_HTTPS_ORIGIN');
    }
  });
});
