import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle } from 'lucide-react-native';
import type { ConversationDto } from '@kkdm/shared';
import { Chip, EmptyState, PaginatedList } from '@/components/ui';
import { ConversationRow } from '@/components/chat';
import { api } from '@/lib/api';
import { useUnreadCounts } from '@/hooks';
import { useAuth } from '@/store/auth';

/** Chat list: personal conversations plus the inbox of each shop the user can answer for. */
export default function Inbox() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const unread = useUnreadCounts();
  const shopInboxes = (user?.shops ?? []).filter((s) => s.role === 'owner' || s.permissions.includes('chats.manage'));
  const [inbox, setInbox] = useState<string>('customer');

  if (!user) {
    return (
      <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
        <EmptyState icon={MessageCircle} title="Sign in to chat with sellers" message="Ask about prices, request wholesale quotations and negotiate directly with shops." action="Sign in" onAction={() => router.push('/(auth)/login')} />
      </View>
    );
  }
  const side = inbox === 'customer' ? 'customer' : 'shop';
  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-2">
        <Text className="mb-3 text-2xl font-bold text-ink-900">Chats</Text>
        {shopInboxes.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chip label={`My chats${unread.customerChats ? ` (${unread.customerChats})` : ''}`} selected={inbox === 'customer'} onPress={() => setInbox('customer')} />
            {shopInboxes.map((s) => {
              const n = unread.shopChats[s.shopId] ?? 0;
              return <Chip key={s.shopId} label={`${s.shopName}${n ? ` (${n})` : ''}`} selected={inbox === s.shopId} onPress={() => setInbox(s.shopId)} />;
            })}
          </ScrollView>
        ) : null}
      </View>
      <PaginatedList<ConversationDto>
        key={inbox}
        queryKey={['conversations', inbox]}
        fetchPage={(page) => api.page<ConversationDto>('/conversations', side === 'customer' ? { as: 'customer', page } : { as: 'shop', shopId: inbox, page })}
        keyOf={(c) => c.id}
        renderItem={(c) => <ConversationRow c={c} side={side} />}
        empty={{ title: 'No conversations yet', message: side === 'customer' ? 'Start a chat from any shop or product page.' : 'Customer enquiries for this shop will appear here.' }}
      />
    </View>
  );
}
