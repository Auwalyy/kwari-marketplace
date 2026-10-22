import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import type { HouseDto } from '@kkdm/shared';
import { Card, VerificationBadge } from '@/components/ui';
import { colors } from '@/constants/theme';

/** Opens the device's maps app at coordinates (no API key needed); otherwise the written description is shown. */
export function openInMaps(lat: number, lng: number, _label?: string) {
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
}

export function HouseRow({ h }: { h: HouseDto }) {
  return (
    <Card className="mb-2 flex-row items-center" onPress={() => router.push(`/house/${h.id}`)}>
      <View className="mr-3 h-12 w-14 items-center justify-center rounded-xl bg-brand-50">
        <Text className="text-xs font-bold text-brand-800">{h.houseNumber}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-semibold text-ink-900">{h.name}</Text>
        <Text numberOfLines={1} className="text-xs text-ink-500">
          {h.breadcrumb.label} · {h.shopCount} shops
        </Text>
        {h.verificationStatus === 'verified' ? (
          <View className="mt-1">
            <VerificationBadge status="verified" />
          </View>
        ) : null}
      </View>
      <ChevronRight size={18} color={colors.inkFaint} />
    </Card>
  );
}

