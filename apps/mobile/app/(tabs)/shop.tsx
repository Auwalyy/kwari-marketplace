import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Store } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import { ShopHome } from '@/components/ShopHome';
import { ResellerHome } from '@/components/reseller';
import { useAuth } from '@/store/auth';
import { useSelectedShop } from '@/store/shop';
import { cx } from '@/components/ui/primitives';

/** "My shop" tab: the seller's home for the selected shop, with a switcher when they belong to several. */
export default function MyShopTab() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const selected = useSelectedShop((s) => s.shopId);
  const select = useSelectedShop((s) => s.select);
  // Every business this person runs: their shops, and their reselling if approved.
  const options = [
    ...(user?.shops ?? []).map((s) => ({ id: s.shopId, label: s.shopName, owner: s.role === 'owner' })),
    ...(user?.reseller?.status === 'approved' ? [{ id: 'reseller', label: `${user.reseller.businessName} (reselling)`, owner: true }] : []),
  ];
  const current = options.find((o) => o.id === selected) ?? options.find((o) => o.owner) ?? options[0];

  if (!current) {
    return (
      <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
        <EmptyState icon={Store} title="Sell on Kantin Kwari" message="Register your shop with the invitation code from your house head, or join a shop as a worker." />
        <View className="px-6">
          <Button title="Register my shop" onPress={() => router.push('/seller/register')} fullWidth className="mb-3" />
          <Button title="Join a shop as a worker" variant="outline" onPress={() => router.push('/seller/join')} fullWidth className="mb-3" />
          <Button title="Become a reseller (no shop needed)" variant="ghost" onPress={() => router.push('/reseller/apply')} fullWidth />
        </View>
      </View>
    );
  }

  const switcher =
    options.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 mb-3">
        {options.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => select(o.id)}
            className={cx('mx-1 rounded-full px-3.5 py-1.5', o.id === current.id ? 'bg-white' : 'bg-white/15')}
            accessibilityRole="tab"
            accessibilityState={{ selected: o.id === current.id }}
          >
            <Text className={cx('text-sm font-semibold', o.id === current.id ? 'text-brand-800' : 'text-white')}>{o.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    ) : null;

  if (current.id === 'reseller') return <ResellerHome topInset={insets.top} switcher={switcher} />;
  return <ShopHome key={current.id} shopId={current.id} topInset={insets.top} switcher={switcher} />;
}
