import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function getAndroidBuildEnvironment(env = process.env) {
  const server = new URL(env.ANDROID_GAME_SERVER_URL || 'https://web-mmorpg-server.onrender.com');
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash || server.pathname !== '/') {
    throw new Error('ANDROID_SERVER_MUST_BE_HTTPS_ORIGIN');
  }
  return { ...env, VITE_BASE_PATH: '/', VITE_GAME_SERVER_URL: server.origin };
}

export function runNodeScript(script, args, env, cwd = repositoryRoot) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ANDROID_BUILD_STEP_FAILED_${result.status}`);
}

export function buildAndroidClient(env = process.env) {
  const nativeEnv = getAndroidBuildEnvironment(env);
  runNodeScript(resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), ['--noEmit', '-p', 'apps/client/tsconfig.json'], nativeEnv);
  runNodeScript(resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), ['build', '--mode', 'android', '--outDir', 'dist-android'], nativeEnv, resolve(repositoryRoot, 'apps/client'));
  runNodeScript(resolve(repositoryRoot, 'node_modules/@capacitor/cli/bin/capacitor'), ['sync', 'android'], nativeEnv, resolve(repositoryRoot, 'apps/client'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildAndroidClient();
}
