import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/store/auth';

/** UI gate only — every admin endpoint is independently authorised by the API. */
export default function AdminLayout() {
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  if (status === 'loading') return null;
  if (!user || !(user.platformRoles.includes('admin') || user.platformRoles.includes('market_manager'))) return <Redirect href="/(tabs)/account" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
