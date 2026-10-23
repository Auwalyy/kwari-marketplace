import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BriefcaseBusiness, Home, MessageCircle, ShoppingCart, Store, UserRound } from 'lucide-react-native';
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
  // Sellers get their own tab; everyone else never sees it.
  const hasShop = useAuth((s) => (s.user?.shops.length ?? 0) > 0);
  const isReseller = useAuth((s) => s.user?.reseller?.status === 'approved');
  // The bar grows by the device's bottom inset (iPhone home indicator, Android gesture bar) so labels
  // are never hidden behind it. A fixed height would clip them on notched devices.
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 56 + bottomPad,
          paddingTop: 6,
          paddingBottom: bottomPad,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Home size={22} color={color} /> }} />
      <Tabs.Screen name="market" options={{ title: 'Market', tabBarIcon: ({ color }) => <Store size={22} color={color} /> }} />
      <Tabs.Screen
        name="cart"
        options={{ title: 'Cart', tabBarIcon: ({ color }) => <ShoppingCart size={22} color={color} />, tabBarBadge: cart.data?.itemCount || undefined }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Chats', tabBarIcon: ({ color }) => <MessageCircle size={22} color={color} />, tabBarBadge: chatBadge || undefined }} />
      <Tabs.Screen name="shop" options={{ title: hasShop ? 'My shop' : 'Reselling', href: hasShop || isReseller ? undefined : null, tabBarIcon: ({ color }) => <BriefcaseBusiness size={22} color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <UserRound size={22} color={color} /> }} />
    </Tabs>
  );
}
