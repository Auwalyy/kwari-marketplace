import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { queryClient } from '@/lib/queryClient';
import { useAuth } from '@/store/auth';
import { ConfirmProvider } from '@/components/ui';
import { colors } from '@/constants/theme';
import { registerForPush } from '@/lib/push';
import { prefs } from '@/lib/secureStorage';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Maps a notification's data payload to the screen it refers to. */
function routeForNotification(data: Record<string, string | undefined>) {
  if (data.conversationId) return `/chat/${data.conversationId}`;
  if (data.quotationId) return `/quotations/${data.quotationId}`;
  if (data.orderId && data.shopId) return `/seller/${data.shopId}/order/${data.orderId}`;
  if (data.orderId) return `/orders/${data.orderId}`;
  if (data.membershipId && data.houseId) return `/house-admin/${data.houseId}/membership/${data.membershipId}`;
  if (data.shopId) return `/seller/${data.shopId}`;
  return '/notifications';
}

export default function RootLayout() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
    if (status === 'authenticated') {
      void (async () => {
        if (await prefs.get('pushOptIn', true)) await registerForPush();
      })();
    }
  }, [status]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      router.push(routeForNotification(data) as never);
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <ConfirmProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream }, animation: 'slide_from_right' }} />
              <Toaster position="top-center" richColors />
            </ConfirmProvider>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
