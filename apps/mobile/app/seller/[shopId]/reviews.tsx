import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewDto } from '@kkdm/shared';
import { Button, Chip, PaginatedList, Screen, toast, useConfirm } from '@/components/ui';
import { ReviewCard } from '@/features/reviews';
import { useShopRole } from '@/hooks';
import { api } from '@/lib/api';

export default function ShopReviews() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const role = useShopRole(shopId);
  const [unanswered, setUnanswered] = useState(false);
  const respond = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.post(`/reviews/${id}/response`, { text }),
    onSuccess: () => {
      toast.success('Response posted');
      void qc.invalidateQueries({ queryKey: ['shop-reviews', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Reviews" scroll={false} padded={false}>
      <View className="flex-row px-4 pt-3">
        <Chip label="Needs a reply" selected={unanswered} onPress={() => setUnanswered((v) => !v)} />
      </View>
      <PaginatedList<ReviewDto>
        key={String(unanswered)}
        queryKey={['shop-reviews', shopId, unanswered]}
        fetchPage={(page) => api.page<ReviewDto>(`/reviews/shop/${shopId}`, { unanswered: unanswered || undefined, page })}
        keyOf={(r) => r.id}
        renderItem={(r) => (
          <View>
            <ReviewCard r={r} />
            {!r.response && role.isOwner ? (
              <Button
                title="Reply publicly"
                size="sm"
                variant="ghost"
                className="-mt-1 mb-2 self-start"
                onPress={async () => {
                  const res = await confirm({ title: 'Reply to review', reason: { placeholder: 'Your public reply', required: true, minLength: 2 }, confirmLabel: 'Post reply' });
                  if (res.confirmed && res.reason) respond.mutate({ id: r.id, text: res.reason });
                }}
              />
            ) : null}
          </View>
        )}
        empty={{ title: 'No reviews yet', message: 'Customers can review after an order is delivered or collected.' }}
      />
    </Screen>
  );
}
