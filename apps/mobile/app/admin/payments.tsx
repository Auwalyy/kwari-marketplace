import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { PaymentDto, PaymentStatus } from '@kkdm/shared';
import { Card, Chip, KeyValue, Notice, PaginatedList, PaymentStatusBadge, Screen, SectionHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira } from '@/lib/format';

type AdminPayment = PaymentDto & { method: string; confirmedBySeller: boolean; failureReason?: string };

/** Payment monitoring. Gateway-verified and seller-confirmed payments are always shown separately. */
export default function AdminPayments() {
  const [status, setStatus] = useState<PaymentStatus | undefined>();
  const config = useQuery({ queryKey: ['payments-config'], queryFn: () => api.get<{ onlineAvailable: boolean; provider: string | null }>('/payments/config') });
  const refunds = useQuery({ queryKey: ['admin', 'payments', 'refunds'], queryFn: async () => (await api.page<AdminPayment>('/admin/payments', { limit: 1 })).meta.openRefunds as { id: string; orderId: string; amountKobo: number; status: string; provider: string }[] });
  return (
    <Screen title="Payments" scroll={false} padded={false}>
      <PaginatedList<AdminPayment>
        queryKey={['admin', 'payments', status]}
        fetchPage={(page) => api.page<AdminPayment>('/admin/payments', { status, page })}
        keyOf={(p) => p.id}
        header={
          <View>
            <Notice tone={config.data?.onlineAvailable ? 'success' : 'warning'} title="Gateway">
              {config.data?.onlineAvailable ? `Online payments via ${config.data.provider}.` : 'No payment gateway configured. Customers can use cash on pickup and bank transfer only.'}
            </Notice>
            {refunds.data?.length ? (
              <>
                <SectionHeader title="Open refunds" />
                <Card className="mb-2">{refunds.data.map((r) => <KeyValue key={r.id} label={`Order ${r.orderId.slice(-6)} · ${r.provider}`} value={`${formatNaira(r.amountKobo)} · ${r.status}`} />)}</Card>
              </>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
              {([undefined, 'paid', 'seller_confirmed', 'pending', 'failed', 'refunded'] as (PaymentStatus | undefined)[]).map((s) => <Chip key={s ?? 'all'} label={s ? s.replace('_', ' ') : 'All'} selected={status === s} onPress={() => setStatus(s)} />)}
            </ScrollView>
          </View>
        }
        renderItem={(p) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{formatNaira(p.amountKobo)}</Text>
              <PaymentStatusBadge status={p.status} />
            </View>
            <Text className="text-xs text-ink-500">{p.provider} · {p.method.replace(/_/g, ' ')} · {formatDateTime(p.createdAt)}</Text>
            <Text className="text-xs text-ink-400">Ref {p.reference}{p.verified ? ' · verified with provider' : p.confirmedBySeller ? ' · seller-confirmed only' : ''}</Text>
            {p.failureReason ? <Text className="text-xs text-danger-700">{p.failureReason}</Text> : null}
          </Card>
        )}
        empty={{ title: 'No payments' }}
      />
    </Screen>
  );
}
