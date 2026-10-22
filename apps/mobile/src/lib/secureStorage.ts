import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Refresh tokens live in the OS keychain/keystore (SecureStore). On web (development preview only)
 * SecureStore is unavailable, so tokens fall back to session-scoped storage there.
 */
const REFRESH_KEY = 'kkdm.refreshToken';

export async function saveRefreshToken(token: string) {
  if (Platform.OS === 'web') return sessionStorage.setItem(REFRESH_KEY, token);
  await SecureStore.setItemAsync(REFRESH_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

export async function readRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') return sessionStorage.getItem(REFRESH_KEY);
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearRefreshToken() {
  if (Platform.OS === 'web') return sessionStorage.removeItem(REFRESH_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/** Non-sensitive preferences (onboarding seen, last selected shop, etc.). */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(`kkdm.${key}`);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown) {
    await AsyncStorage.setItem(`kkdm.${key}`, JSON.stringify(value));
  },
  async remove(key: string) {
    await AsyncStorage.removeItem(`kkdm.${key}`);
  },
};
