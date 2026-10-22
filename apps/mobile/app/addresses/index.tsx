import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react-native';
import type { AddressDto } from '@kkdm/shared';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Screen, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';

export default function Addresses() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<AddressDto[]>('/users/me/addresses') });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/users/me/addresses/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }), onError: (e) => toast.apiError(e) });
  const makeDefault = useMutation({ mutationFn: (id: string) => api.patch(`/users/me/addresses/${id}`, { isDefault: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }) });
  return (
    <Screen title="Delivery addresses" onRefresh={() => void q.refetch()} refreshing={q.isRefetching} footer={<Button title="Add address" icon={Plus} onPress={() => router.push('/addresses/edit')} fullWidth />}>
      {q.isPending ? <ListSkeleton rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon={MapPin} title="No saved addresses" message="Add an address to choose delivery at checkout." /> : null}
      {q.data?.map((a) => (
        <Card key={a.id} className="mb-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-ink-900">{a.label}</Text>
            {a.isDefault ? <Badge label="Default" tone="success" /> : null}
          </View>
          <Text className="mt-1 text-sm text-ink-700">{a.recipientName} · {a.phone}</Text>
          <Text className="text-sm text-ink-600">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state}</Text>
          {a.landmark ? <Text className="text-xs text-ink-500">Landmark: {a.landmark}</Text> : null}
          <View className="mt-3 flex-row">
            <Button title="Edit" size="sm" variant="outline" className="mr-2" onPress={() => router.push({ pathname: '/addresses/edit', params: { id: a.id } })} />
            {!a.isDefault ? <Button title="Make default" size="sm" variant="ghost" className="mr-2" onPress={() => makeDefault.mutate(a.id)} /> : null}
            <Button
              title="Delete"
              size="sm"
              variant="ghost"
              onPress={async () => {
                if ((await confirm({ title: 'Delete this address?', destructive: true, confirmLabel: 'Delete' })).confirmed) remove.mutate(a.id);
              }}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
