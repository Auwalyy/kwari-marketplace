import { Tabs } from 'expo-router';
import { Home, MessageCircle, ShoppingCart, Store, UserRound } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import type { CartDto } from '@kkdm/shared';
import { colors } from '@/constants/theme';
import { useUnreadCounts } from '@/hooks';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function TabsLayout() {
  const authed = useAuth((s) => s.status === 'authenticated');
  const unread = useUnreadCounts();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.get<CartDto>('/cart'), enabled: authed });
  const chatBadge = unread.customerChats + unread.shopChatsTotal;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: { backgroundColor: colors.creamLight, borderTopColor: colors.line, height: 62, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Home size={22} color={color} /> }} />
      <Tabs.Screen name="market" options={{ title: 'Market', tabBarIcon: ({ color }) => <Store size={22} color={color} /> }} />
      <Tabs.Screen
        name="cart"
        options={{ title: 'Cart', tabBarIcon: ({ color }) => <ShoppingCart size={22} color={color} />, tabBarBadge: cart.data?.itemCount || undefined, tabBarBadgeStyle: { backgroundColor: colors.brand } }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Chats', tabBarIcon: ({ color }) => <MessageCircle size={22} color={color} />, tabBarBadge: chatBadge || undefined }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <UserRound size={22} color={color} /> }} />
    </Tabs>
  );
}
