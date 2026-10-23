import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, History, Megaphone, Settings, ShieldCheck, Truck, Users } from 'lucide-react-native';
import { ErrorState, ListItem, LoadingView, Screen } from '@/components/ui';
import { useStaffShop } from '@/components/seller';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</Text>
      <View className="overflow-hidden border-y border-line">{children}</View>
    </View>
  );
}

/** Owner-only settings, in one place: how the shop looks, how customers get their goods, and who works there. */
export default function ShopSettings() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const shop = useStaffShop(shopId);
  const go = (path: string) => () => router.push(`/seller/${shopId}/${path}` as never);
  if (shop.isPending) return <Screen title="Shop settings"><LoadingView /></Screen>;
  if (shop.isError) return <Screen title="Shop settings"><ErrorState error={shop.error} onRetry={() => shop.refetch()} /></Screen>;
  const s = shop.data;
  if (!shop.isOwner) return <Screen title="Shop settings"><ErrorState error={new Error('Only the shop owner can change settings')} /></Screen>;

  return (
    <Screen title="Shop settings" subtitle={s.name} padded={false}>
      <Group title="Your shop">
        <ListItem icon={Settings} title="Shop profile" subtitle="Name, logo, cover photo, description, opening hours" onPress={go('profile')} />
        <ListItem icon={Truck} title="Pickup, delivery & payment" subtitle="How customers collect and pay" onPress={go('fulfilment')} />
        <ListItem icon={Megaphone} title="Promotions" subtitle="Feature your shop or products" onPress={go('promotions')} />
      </Group>
      <Group title="People">
        <ListItem icon={Users} title="Staff & permissions" subtitle="Add workers, choose what each can do" onPress={go('workers')} />
        <ListItem icon={History} title="Staff activity" subtitle="Who changed what" onPress={go('activity')} />
      </Group>
      <Group title="Trust">
        <ListItem icon={BadgeCheck} title="Verification & ownership" subtitle={s.verificationStatus === 'verified' ? 'Verified' : 'Get the verified badge'} onPress={go('verification')} />
        <ListItem icon={ShieldCheck} title="House membership" subtitle={`House ${s.breadcrumb.houseNumber}${s.breadcrumb.houseName ? ` · ${s.breadcrumb.houseName}` : ''}`} onPress={go('membership')} />
      </Group>
    </Screen>
  );
}
