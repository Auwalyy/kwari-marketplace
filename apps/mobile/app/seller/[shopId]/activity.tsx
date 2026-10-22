import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PaginatedList, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';

interface Activity { id: string; action: string; actorName: string; reason?: string; at: string }

/** Audit trail of staff actions in the shop (owner only). */
export default function ShopActivity() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  return (
    <Screen title="Staff activity" scroll={false} padded={false}>
      <PaginatedList<Activity>
        queryKey={['shop-activity', shopId]}
        fetchPage={(page) => api.page<Activity>(`/shops/${shopId}/activity`, { page })}
        keyOf={(a) => a.id}
        renderItem={(a) => (
          <View className="border-b border-line py-3">
            <Text className="text-sm font-semibold text-ink-900">{titleCase(a.action)}</Text>
            <Text className="text-xs text-ink-500">{a.actorName} · {formatDateTime(a.at)}{a.reason ? ` · ${a.reason}` : ''}</Text>
          </View>
        )}
        empty={{ title: 'No activity yet' }}
      />
    </Screen>
  );
}
