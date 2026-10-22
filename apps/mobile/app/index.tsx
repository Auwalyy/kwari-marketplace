import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/store/auth';
import { prefs } from '@/lib/secureStorage';
import { LoadingView } from '@/components/ui';

/** Entry: first-run onboarding, then the main tabs (guests can browse without an account). */
export default function Index() {
  const status = useAuth((s) => s.status);
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    void prefs.get('onboardingSeen', false).then(setSeen);
  }, []);
  if (status === 'loading' || seen === null) {
    return (
      <View className="flex-1 bg-brand-800">
        <LoadingView />
      </View>
    );
  }
  if (!seen) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
