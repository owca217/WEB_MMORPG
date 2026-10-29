import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildAndroidClient, repositoryRoot } from './build-android-client.mjs';

const release = process.argv.includes('--release');
const env = { ...process.env };
if (!env.JAVA_HOME && process.platform === 'win32' && env.LOCALAPPDATA) {
  const bundledJdk = resolve(env.LOCALAPPDATA, 'Programs/Android Studio/jbr');
  if (existsSync(bundledJdk)) env.JAVA_HOME = bundledJdk;
}
if (!env.ANDROID_HOME) env.ANDROID_HOME = env.ANDROID_SDK_ROOT;
if (!env.ANDROID_HOME && process.platform === 'win32' && env.LOCALAPPDATA) {
  env.ANDROID_HOME = resolve(env.LOCALAPPDATA, 'Android/Sdk');
}
if (!env.JAVA_HOME || !env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) {
  throw new Error('Set JAVA_HOME to JDK 21 and ANDROID_HOME to an Android SDK with platform/build-tools 36.');
}
if (release) {
  for (const variable of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!env[variable]) throw new Error(`Release signing requires ${variable}; no credentials belong in Git.`);
  }
}
buildAndroidClient(env);
const androidDirectory = resolve(repositoryRoot, 'apps/client/android');
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(gradle, [release ? 'assembleRelease' : 'assembleDebug', '--no-daemon'], {
  cwd: androidDirectory, env, stdio: 'inherit', shell: process.platform === 'win32'
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const variant = release ? 'release' : 'debug';
const artifactDirectory = resolve(repositoryRoot, 'artifacts/android');
mkdirSync(artifactDirectory, { recursive: true });
const name = `WEB-MMORPG-0.1.13${release ? '' : '-debug'}.apk`;
const output = resolve(artifactDirectory, name);
copyFileSync(resolve(androidDirectory, `app/build/outputs/apk/${variant}/app-${variant}.apk`), output);
const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(`${output}.sha256`, `${digest}  ${name}\n`);
console.log(`APK: ${output}\nSHA-256: ${digest}`);
