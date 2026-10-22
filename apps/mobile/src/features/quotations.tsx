import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { QuotationDto } from '@kkdm/shared';
import { Badge, Card } from '@/components/ui';
import { formatDate, formatNaira } from '@/lib/format';

export const QUOTATION_TONE: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  requested: 'warning',
  offered: 'info',
  countered: 'warning',
  accepted: 'success',
  converted: 'success',
  rejected: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};

export function QuotationRow({ q, shopView }: { q: QuotationDto; shopView?: boolean }) {
  return (
    <Card className="mb-3" onPress={() => router.push(`/quotations/${q.id}`)}>
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-ink-900">{q.reference}</Text>
        <Badge label={q.status.replace('_', ' ')} tone={QUOTATION_TONE[q.status] ?? 'neutral'} />
      </View>
      <Text className="mt-1 text-sm text-ink-700">{shopView ? q.customer.fullName : q.shop.name}</Text>
      <Text numberOfLines={1} className="text-xs text-ink-500">
        {q.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')}
      </Text>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-xs text-ink-400">{formatDate(q.updatedAt)}</Text>
        {q.totalOfferedKobo != null ? <Text className="font-bold text-ink-900">{formatNaira(q.totalOfferedKobo)}</Text> : null}
      </View>
    </Card>
  );
}

