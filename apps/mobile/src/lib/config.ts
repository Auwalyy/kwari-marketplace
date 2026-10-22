import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Resolves the API base URL.
 * 1. EXPO_PUBLIC_API_URL when set (required for production builds).
 * 2. In development, the host of the Expo dev server (your computer's LAN IP), so physical devices
 *    on the same Wi-Fi reach the API — `localhost` on a phone would be the phone itself.
 * 3. Emulator fallbacks: Android emulator reaches the host machine at 10.0.2.2.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra?.expoGo?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:4000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();

/**
 * Release builds must be given a real HTTPS API through EXPO_PUBLIC_API_URL (see apps/mobile/eas.json).
 * When it is missing or still a placeholder, the app shows a configuration screen instead of failing
 * every request with "No connection".
 */
export const API_CONFIG_ERROR: string | null = (() => {
  if (__DEV__) return null;
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!explicit) return 'EXPO_PUBLIC_API_URL is not set for this build.';
  if (/example\.com/i.test(explicit)) return `EXPO_PUBLIC_API_URL is still the placeholder (${explicit}).`;
  if (!explicit.startsWith('https://')) return 'EXPO_PUBLIC_API_URL must use https:// in release builds.';
  return null;
})();
export const API_V1 = `${API_URL}/api/v1`;
export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? Constants.expoConfig?.extra?.eas?.projectId;
