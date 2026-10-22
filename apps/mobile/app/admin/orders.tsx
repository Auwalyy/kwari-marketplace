import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, type OrderDto, type OrderStatus } from '@kkdm/shared';
import { Button, Card, Chip, OrderStatusBadge, PaginatedList, PaymentStatusBadge, Screen, toast, useConfirm } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';
import { formatDate, formatNaira } from '@/lib/format';

const FILTERS: (OrderStatus | undefined)[] = [undefined, 'pending_acceptance', 'disputed', 'refund_pending', 'cancelled', 'completed'];

/** Order monitoring with admin interventions (disputes, refunds). */
export default function AdminOrders() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<OrderStatus | undefined>();
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const params = { status, reference: reference || undefined };
  const transition = useMutation({
    mutationFn: ({ id, to, reason }: { id: string; to: OrderStatus; reason: string }) => api.post(`/admin/orders/${id}/transition`, { status: to, reason }),
    onSuccess: () => { toast.success('Order updated'); void qc.invalidateQueries({ queryKey: ['admin', 'orders'] }); },
    onError: (e) => toast.apiError(e),
  });
  const refund = useMutation({
    mutationFn: ({ id, mode, note }: { id: string; mode: 'gateway' | 'manual'; note: string }) => api.post(`/admin/orders/${id}/refund`, { mode, note }),
    onSuccess: () => { toast.success('Refund processed'); void qc.invalidateQueries({ queryKey: ['admin', 'orders'] }); },
    onError: (e) => toast.apiError(e),
  });
  const act = async (o: OrderDto, to: OrderStatus) => {
    const r = await confirm({ title: `Set ${o.reference} to “${ORDER_STATUS_LABELS[to]}”?`, reason: { placeholder: 'Reason (audited, shown to both parties)', required: true }, confirmLabel: 'Confirm' });
    if (r.confirmed && r.reason) transition.mutate({ id: o.id, to, reason: r.reason });
  };
  const doRefund = async (o: OrderDto, mode: 'gateway' | 'manual') => {
    const r = await confirm({ title: mode === 'gateway' ? 'Refund through the payment provider?' : 'Record a refund made outside the gateway?', reason: { placeholder: 'Note', required: true }, confirmLabel: 'Refund' });
    if (r.confirmed && r.reason) refund.mutate({ id: o.id, mode, note: r.reason });
  };
  return (
    <Screen title="Orders" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setReference(text.trim().toUpperCase())} placeholder="Order reference" />
        <ScrollView horizontal className="mt-2" showsHorizontalScrollIndicator={false}>
          {FILTERS.map((s) => <Chip key={s ?? 'all'} label={s ? ORDER_STATUS_LABELS[s] : 'All'} selected={status === s} onPress={() => setStatus(s)} />)}
        </ScrollView>
      </View>
      <PaginatedList<OrderDto>
        queryKey={['admin', 'orders', params]}
        fetchPage={(page) => api.page<OrderDto>('/admin/orders', { ...params, page })}
        keyOf={(o) => o.id}
        renderItem={(o) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{o.reference}</Text>
              <OrderStatusBadge status={o.status} />
            </View>
            <Text className="text-xs text-ink-500">{o.customer.fullName} → {o.shop.name} · {formatDate(o.createdAt)}</Text>
            <View className="mt-1 flex-row items-center justify-between">
              <Text className="font-bold text-ink-900">{formatNaira(o.totalKobo)}</Text>
              <PaymentStatusBadge status={o.paymentStatus} />
            </View>
            <View className="mt-2 flex-row flex-wrap">
              {o.allowedTransitions.map((t) => <Button key={t} title={ORDER_STATUS_LABELS[t]} size="sm" variant="outline" className="mb-1 mr-2" onPress={() => void act(o, t)} />)}
              {o.status === 'refund_pending' ? (
                <>
                  <Button title="Refund via gateway" size="sm" className="mb-1 mr-2" onPress={() => void doRefund(o, 'gateway')} />
                  <Button title="Record manual refund" size="sm" variant="ghost" className="mb-1" onPress={() => void doRefund(o, 'manual')} />
                </>
              ) : null}
            </View>
          </Card>
        )}
        empty={{ title: 'No orders' }}
      />
    </Screen>
  );
}
