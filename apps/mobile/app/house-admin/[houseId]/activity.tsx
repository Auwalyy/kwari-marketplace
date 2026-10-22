import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PaginatedList, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';

interface Activity { id: string; action: string; outcome: string; reason?: string; targetType?: string; at: string }

export default function HouseActivity() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  return (
    <Screen title="House activity" scroll={false} padded={false}>
      <PaginatedList<Activity>
        queryKey={['house-activity', houseId]}
        fetchPage={(page) => api.page<Activity>(`/houses/${houseId}/activity`, { page })}
        keyOf={(a) => a.id}
        renderItem={(a) => (
          <View className="border-b border-line py-3">
            <Text className="text-sm font-semibold text-ink-900">{titleCase(a.action)}{a.outcome === 'failure' ? ' (failed)' : ''}</Text>
            <Text className="text-xs text-ink-500">{formatDateTime(a.at)}{a.reason ? ` · ${a.reason}` : ''}</Text>
          </View>
        )}
        empty={{ title: 'No activity yet' }}
      />
    </Screen>
  );
}
