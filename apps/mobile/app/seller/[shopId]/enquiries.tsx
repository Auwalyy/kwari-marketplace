import { useLocalSearchParams } from 'expo-router';
import type { ConversationDto } from '@kkdm/shared';
import { PaginatedList, Screen } from '@/components/ui';
import { ConversationRow } from '@/components/chat';
import { api } from '@/lib/api';

/** Customer enquiries for one shop (owner + workers with chat permission). */
export default function Enquiries() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  return (
    <Screen title="Customer enquiries" scroll={false} padded={false}>
      <PaginatedList<ConversationDto>
        queryKey={['conversations', shopId]}
        fetchPage={(page) => api.page<ConversationDto>('/conversations', { as: 'shop', shopId, page })}
        keyOf={(c) => c.id}
        renderItem={(c) => <ConversationRow c={c} side="shop" />}
        empty={{ title: 'No enquiries yet', message: 'When customers message your shop, conversations appear here.' }}
      />
    </Screen>
  );
}
