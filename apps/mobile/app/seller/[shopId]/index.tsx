import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { IconButton } from '@/components/ui';
import { ShopHome } from '@/components/ShopHome';
import { colors } from '@/constants/theme';

/** Shop home opened from a link or notification (the "My shop" tab shows the same screen). */
export default function ShopDashboard() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-cream-100">
      <ShopHome
        shopId={shopId}
        topInset={insets.top}
        switcher={<IconButton icon={ChevronLeft} label="Back" color={colors.white} className="-ml-2 mb-1" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/shop'))} />}
      />
    </View>
  );
}
