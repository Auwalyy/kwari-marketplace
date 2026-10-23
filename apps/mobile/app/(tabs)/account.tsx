import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Ban,
  Bell,
  Briefcase,
  Building2,
  ClipboardList,
  Clock,
  FileText,
  Heart,
  KeyRound,
  LogOut,
  MapPin,
  Plus,
  Settings,
  Shield,
  ShieldCheck,
  Star,
  Store,
  UserPlus,
} from 'lucide-react-native';
import { Avatar, Badge, Button, ListItem, useConfirm } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useSelectedShop } from '@/store/shop';
import { unregisterPush } from '@/lib/push';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</Text>
      <View className="overflow-hidden border-y border-line">{children}</View>
    </View>
  );
}

/** Role-aware hub. Only shows dashboards the server says the user holds (from /users/me). */
export default function Account() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const confirm = useConfirm();
  const selectShop = useSelectedShop((s) => s.select);

  if (!user) {
    return (
      <View className="flex-1 bg-cream-100 px-6" style={{ paddingTop: insets.top + 32 }}>
        <Text className="text-2xl font-bold text-ink-900">Your account</Text>
        <Text className="mb-6 mt-2 text-base text-ink-600">Sign in to order, chat with sellers, save favourites, register your shop or manage your house.</Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/login')} fullWidth size="lg" className="mb-3" />
        <Button title="Create an account" variant="outline" onPress={() => router.push('/(auth)/register')} fullWidth />
      </View>
    );
  }
  const isAdmin = user.platformRoles.includes('admin');
  const isManager = user.platformRoles.includes('market_manager');
  const unverified = (user.email && !user.emailVerified) || (user.phone && !user.phoneVerified);

  return (
    <ScrollView className="flex-1 bg-cream-100" contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}>
      <View className="flex-row items-center px-4 py-3">
        <Avatar name={user.fullName} size={56} />
        <View className="ml-3 flex-1">
          <Text className="text-xl font-bold text-ink-900">{user.fullName}</Text>
          <Text className="text-sm text-ink-500">{user.email ?? user.phone}</Text>
          <View className="mt-1 flex-row flex-wrap">
            {isAdmin ? <Badge label="Administrator" tone="info" className="mr-1" /> : null}
            {isManager ? <Badge label="Market manager" tone="info" className="mr-1" /> : null}
            {unverified ? <Badge label="Verify contacts" tone="warning" /> : null}
          </View>
        </View>
      </View>

      <Group title="Shopping">
        <ListItem icon={ClipboardList} title="My orders" onPress={() => router.push('/orders')} />
        <ListItem icon={FileText} title="Quotations" subtitle="Wholesale price requests" onPress={() => router.push('/quotations')} />
        <ListItem icon={Heart} title="Favourites" onPress={() => router.push('/favorites')} />
        <ListItem icon={Clock} title="Recently viewed" onPress={() => router.push('/recently-viewed')} />
        <ListItem icon={MapPin} title="Delivery addresses" onPress={() => router.push('/addresses')} />
        <ListItem icon={Star} title="My reviews" onPress={() => router.push('/reviews/mine')} />
      </Group>

      <Group title="Selling">
        {user.shops.map((s) => (
          <ListItem
            key={s.shopId}
            icon={Store}
            title={s.shopName}
            subtitle={`${s.role === 'owner' ? 'Owner' : 'Staff'} · ${s.shopStatus === 'active' ? 'Open in My shop' : s.shopStatus.replace('_', ' ')}`}
            onPress={() => {
              selectShop(s.shopId);
              router.push('/(tabs)/shop');
            }}
          />
        ))}
        <ListItem icon={Plus} title="Register a physical shop" subtitle="Requires an invitation code from your house head" onPress={() => router.push('/seller/register')} />
        <ListItem icon={UserPlus} title="Join a shop as a worker" subtitle="Enter the code from the shop owner" onPress={() => router.push('/seller/join')} />
      </Group>

      <Group title="House management">
        {user.houses.map((h) => (
          <ListItem key={h.houseId} icon={Building2} title={`House ${h.houseNumber}`} subtitle={`${h.houseName} · head ${h.verificationStatus === 'verified' ? 'verified' : h.verificationStatus}`} onPress={() => router.push(`/house-admin/${h.houseId}`)} />
        ))}
        <ListItem icon={Briefcase} title="Claim a house" subtitle="For house heads whose house has no head yet" onPress={() => router.push('/house-claim')} />
      </Group>

      {isAdmin || isManager ? (
        <Group title="Administration">
          <ListItem icon={Shield} title="Administration dashboard" onPress={() => router.push('/admin')} />
        </Group>
      ) : null}

      <Group title="Account">
        <ListItem icon={Bell} title="Notifications" onPress={() => router.push('/notifications')} />
        <ListItem icon={ShieldCheck} title="Verify email / phone" onPress={() => router.push('/(auth)/verify')} />
        <ListItem icon={KeyRound} title="Profile & security" onPress={() => router.push('/settings')} />
        <ListItem icon={Ban} title="Reports & blocked accounts" onPress={() => router.push('/trust')} />
        <ListItem icon={Settings} title="Notification preferences" onPress={() => router.push('/settings/notifications')} />
        <ListItem
          icon={LogOut}
          title="Sign out"
          danger
          onPress={async () => {
            const r = await confirm({ title: 'Sign out?', confirmLabel: 'Sign out' });
            if (!r.confirmed) return;
            await unregisterPush();
            await logout();
            router.replace('/(tabs)');
          }}
        />
      </Group>
      <Text className="mt-6 text-center text-xs text-ink-400">Kantin Kwari Digital Market · v1.0.0</Text>
    </ScrollView>
  );
}
