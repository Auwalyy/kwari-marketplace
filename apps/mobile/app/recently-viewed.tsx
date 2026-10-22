import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import type { ProductSummaryDto } from '@kkdm/shared';
import { IconButton, PaginatedList, ProductGridSkeleton, Screen, toast, useConfirm } from '@/components/ui';
import { ProductCard } from '@/components/cards';
import { api } from '@/lib/api';

/** Viewing history (kept for 90 days on the server; can be cleared at any time). */
export default function RecentlyViewed() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const clear = useMutation({
    mutationFn: () => api.del('/favorites/recently-viewed'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recently-viewed'] });
      void qc.invalidateQueries({ queryKey: ['discovery'] });
      toast.success('History cleared');
    },
  });
  return (
    <Screen
      title="Recently viewed"
      scroll={false}
      padded={false}
      right={<IconButton icon={Trash2} label="Clear history" onPress={async () => (await confirm({ title: 'Clear viewing history?', confirmLabel: 'Clear', destructive: true })).confirmed && clear.mutate()} />}
    >
      <PaginatedList<ProductSummaryDto>
        queryKey={['recently-viewed']}
        fetchPage={(page) => api.page<ProductSummaryDto>('/favorites/recently-viewed', { page })}
        keyOf={(p) => p.id}
        numColumns={2}
        contentPadding={12}
        skeleton={<View className="px-4"><ProductGridSkeleton /></View>}
        renderItem={(p) => (
          <View className="flex-1 px-1">
            <ProductCard product={p} />
          </View>
        )}
        empty={{ title: 'Nothing here yet', message: 'Products you open will show here. History is private to you and kept for 90 days.' }}
      />
    </Screen>
  );
}
