import { Text, View } from 'react-native';
import type { ReviewDto } from '@kkdm/shared';
import { Body, Card } from '@/components/ui';
import { formatDate } from '@/lib/format';

export function ReviewCard({ r }: { r: ReviewDto }) {
  return (
    <Card className="mb-2">
      <View className="flex-row justify-between">
        <Text className="font-semibold text-ink-900">{r.author.fullName}</Text>
        <Text className="text-gold-500">{'★'.repeat(r.rating)}<Text className="text-cream-300">{'★'.repeat(5 - r.rating)}</Text></Text>
      </View>
      {r.text ? <Body className="mt-1 text-sm">{r.text}</Body> : null}
      <Text className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)} · verified purchase</Text>
      {r.response ? <Text className="mt-2 rounded-lg bg-cream-100 p-2 text-sm text-ink-700">Shop reply: {r.response.text}</Text> : null}
    </Card>
  );
}

