import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Store } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import { ShopHome } from '@/components/ShopHome';
import { useAuth } from '@/store/auth';
import { useSelectedShop } from '@/store/shop';
import { cx } from '@/components/ui/primitives';

/** "My shop" tab: the seller's home for the selected shop, with a switcher when they belong to several. */
export default function MyShopTab() {
  const insets = useSafeAreaInsets();
  const shops = useAuth((s) => s.user?.shops ?? []);
  const selected = useSelectedShop((s) => s.shopId);
  const select = useSelectedShop((s) => s.select);
  const current = shops.find((s) => s.shopId === selected) ?? shops.find((s) => s.role === 'owner') ?? shops[0];

  if (!current) {
    return (
      <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
        <EmptyState icon={Store} title="Sell on Kantin Kwari" message="Register your shop with the invitation code from your house head, or join a shop as a worker." />
        <View className="px-6">
          <Button title="Register my shop" onPress={() => router.push('/seller/register')} fullWidth className="mb-3" />
          <Button title="Join a shop as a worker" variant="outline" onPress={() => router.push('/seller/join')} fullWidth />
        </View>
      </View>
    );
  }

  const switcher =
    shops.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 mb-3">
        {shops.map((s) => (
          <Pressable
            key={s.shopId}
            onPress={() => select(s.shopId)}
            className={cx('mx-1 rounded-full px-3.5 py-1.5', s.shopId === current.shopId ? 'bg-white' : 'bg-white/15')}
            accessibilityRole="tab"
            accessibilityState={{ selected: s.shopId === current.shopId }}
          >
            <Text className={cx('text-sm font-semibold', s.shopId === current.shopId ? 'text-brand-800' : 'text-white')}>{s.shopName}</Text>
          </Pressable>
        ))}
      </ScrollView>
    ) : null;

  return <ShopHome key={current.shopId} shopId={current.shopId} topInset={insets.top} switcher={switcher} />;
}
