import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '@/store/auth';
import { prefs } from '@/lib/secureStorage';
import { API_CONFIG_ERROR } from '@/lib/config';

/** Entry: first-run onboarding, then the main tabs (guests can browse without an account). */
export default function Index() {
  const status = useAuth((s) => s.status);
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    void prefs.get('onboardingSeen', false).then(setSeen);
  }, []);
  if (API_CONFIG_ERROR) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-700 px-8">
        <Text className="text-center text-xl font-bold text-white">App not configured</Text>
        <Text className="mt-2 text-center text-sm text-brand-100">{API_CONFIG_ERROR}</Text>
      </View>
    );
  }
  if (status === 'loading' || seen === null) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-700">
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }
  if (!seen) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
