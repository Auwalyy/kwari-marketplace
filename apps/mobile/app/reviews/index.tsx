import { useLocalSearchParams } from 'expo-router';
import type { ReviewDto } from '@kkdm/shared';
import { PaginatedList, Screen } from '@/components/ui';
import { ReviewCard } from '@/features/reviews';
import { api } from '@/lib/api';

export default function Reviews() {
  const { shopId, productId, title } = useLocalSearchParams<{ shopId?: string; productId?: string; title?: string }>();
  return (
    <Screen title="Reviews" subtitle={title} scroll={false} padded={false}>
      <PaginatedList<ReviewDto>
        queryKey={['reviews', shopId ?? productId]}
        fetchPage={(page) => api.page<ReviewDto>('/reviews', { shopId, productId, page })}
        keyOf={(r) => r.id}
        renderItem={(r) => <ReviewCard r={r} />}
        empty={{ title: 'No reviews yet', message: 'Only customers with delivered or collected orders can leave reviews.' }}
      />
    </Screen>
  );
}
