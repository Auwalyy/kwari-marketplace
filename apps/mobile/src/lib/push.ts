import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { EAS_PROJECT_ID } from './config';
import { prefs } from './secureStorage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/**
 * Requests permission and registers this device's Expo push token with the API. Push requires a
 * physical device and an EAS project id; the result explains why when it is unavailable.
 */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'Push notifications are not available on web.' };
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device.' };
  if (!EAS_PROJECT_ID) return { ok: false, reason: 'Push is not configured for this build (missing EAS project id).' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { ok: false, reason: 'Notification permission was not granted.' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
    await api.post('/notifications/devices', { token, platform: Platform.OS, deviceName: Device.deviceName ?? undefined });
    await prefs.set('pushToken', token);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export async function unregisterPush() {
  const token = await prefs.get<string | null>('pushToken', null);
  if (token) await api.del('/notifications/devices', { token }).catch(() => undefined);
  await prefs.remove('pushToken');
}
