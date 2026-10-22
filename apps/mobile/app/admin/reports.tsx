import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Card, PaginatedList, Screen, SegmentedControl } from '@/components/ui';
import { api } from '@/lib/api';
import { timeAgo, titleCase } from '@/lib/format';

interface AdminReport {
  id: string;
  reporter: { id: string; fullName?: string };
  targetType: string;
  targetId: string;
  shopId: string | null;
  category: string;
  description: string;
  status: string;
  actions: { action: string; note?: string; at: string }[];
  resolution?: string;
  createdAt: string;
}

export default function AdminReports() {
  const [status, setStatus] = useState<'open' | 'investigating' | 'resolved' | 'dismissed'>('open');
  return (
    <Screen title="Reports" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'open', label: 'Open' }, { value: 'investigating', label: 'Investigating' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }]} value={status} onChange={setStatus} />
      </View>
      <PaginatedList<AdminReport>
        key={status}
        queryKey={['admin', 'reports', status]}
        fetchPage={(page) => api.page<AdminReport>('/admin/reports', { status, page })}
        keyOf={(r) => r.id}
        renderItem={(r) => (
          <Card className="mb-2" onPress={() => router.push({ pathname: '/admin/report/[id]', params: { id: r.id, data: JSON.stringify(r) } })}>
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{titleCase(r.category)} · {r.targetType}</Text>
              <Badge label={r.status} tone={r.status === 'open' ? 'danger' : r.status === 'investigating' ? 'warning' : 'neutral'} />
            </View>
            <Text numberOfLines={2} className="mt-1 text-sm text-ink-700">{r.description}</Text>
            <Text className="text-xs text-ink-400">{r.reporter.fullName} · {timeAgo(r.createdAt)}</Text>
          </Card>
        )}
        empty={{ title: 'No reports here' }}
      />
    </Screen>
  );
}
