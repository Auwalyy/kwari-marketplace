import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react-native';
import type { ReviewDto } from '@kkdm/shared';
import { EmptyState, ErrorState, ListSkeleton, Screen } from '@/components/ui';
import { ReviewCard } from '@/features/reviews';
import { api } from '@/lib/api';

export default function MyReviews() {
  const q = useQuery({ queryKey: ['reviews', 'mine'], queryFn: () => api.get<ReviewDto[]>('/reviews/mine') });
  return (
    <Screen title="My reviews" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isPending ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon={Star} title="No reviews yet" message="After an order is delivered or collected you can review it from the order page." /> : null}
      {q.data?.map((r) => <ReviewCard key={r.id} r={r} />)}
    </Screen>
  );
}
