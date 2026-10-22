import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PaginatedList, Screen, Chip } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';

interface Entry { id: string; action: string; category: string; outcome: string; actor: { id: string; fullName?: string } | null; targetType?: string; reason?: string; ip?: string; at: string }
const CATEGORIES = [undefined, 'auth', 'admin', 'house', 'invitation', 'shop', 'product', 'order', 'payment', 'trust', 'account'];

export default function AuditLog() {
  const [category, setCategory] = useState<string | undefined>();
  const [failures, setFailures] = useState(false);
  const params = { category, outcome: failures ? 'failure' : undefined };
  return (
    <Screen title="Audit log" scroll={false} padded={false}>
      <ScrollView horizontal className="max-h-14 pt-3" contentContainerStyle={{ paddingHorizontal: 16 }} showsHorizontalScrollIndicator={false}>
        <Chip label="Failures only" selected={failures} onPress={() => setFailures((v) => !v)} />
        {CATEGORIES.map((c) => <Chip key={c ?? 'all'} label={c ? titleCase(c) : 'All'} selected={category === c} onPress={() => setCategory(c)} />)}
      </ScrollView>
      <PaginatedList<Entry>
        queryKey={['admin', 'audit', params]}
        fetchPage={(page) => api.page<Entry>('/admin/audit', { ...params, page })}
        keyOf={(e) => e.id}
        renderItem={(e) => (
          <View className="border-b border-line py-2.5">
            <Text className={`text-sm font-semibold ${e.outcome === 'failure' ? 'text-danger-700' : 'text-ink-900'}`}>{e.action}</Text>
            <Text className="text-xs text-ink-500">
              {formatDateTime(e.at)} · {e.actor?.fullName ?? 'system'}{e.targetType ? ` · ${e.targetType}` : ''}{e.ip ? ` · ${e.ip}` : ''}
            </Text>
            {e.reason ? <Text className="text-xs text-ink-600">{e.reason}</Text> : null}
          </View>
        )}
        empty={{ title: 'No entries' }}
      />
    </Screen>
  );
}
