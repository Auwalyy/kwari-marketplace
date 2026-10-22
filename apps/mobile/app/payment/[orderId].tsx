import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, XCircle } from 'lucide-react-native';
import type { OrderDto, PaymentDto } from '@kkdm/shared';
import { Body, Button, Card, ErrorState, KeyValue, LoadingView, Notice, PaymentStatusBadge, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api, toApiError } from '@/lib/api';
import { formatNaira, uuid } from '@/lib/format';

/**
 * Online payment: the server creates the payment (amount from the stored order), the provider's hosted
 * page collects card/bank details, then the server verifies the result with the provider. The app never
 * decides that a payment succeeded.
 */
export default function Payment() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const qc = useQueryClient();
  const [idempotencyKey] = useState(uuid);
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order = useQuery({ queryKey: ['orders', 'detail', orderId], queryFn: () => api.get<OrderDto>(`/orders/${orderId}`) });

  const verify = useMutation({
    mutationFn: (ref: string) => api.post<PaymentDto>(`/payments/${ref}/verify`),
    onSuccess: (p) => {
      setPayment(p);
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => setError(toApiError(e).message),
  });
  const start = useMutation({
    mutationFn: () => api.post<PaymentDto>('/payments/initialize', { orderId, idempotencyKey }),
    onSuccess: async (p) => {
      setPayment(p);
      setError(null);
      if (!p.authorizationUrl) return;
      await WebBrowser.openAuthSessionAsync(p.authorizationUrl, 'kantinkwari://payment-complete');
      // Whatever the browser reports, ask the server — it verifies with the provider.
      verify.mutate(p.reference);
    },
    onError: (e) => setError(toApiError(e).message),
  });

  if (order.isPending) return <Screen title="Payment"><LoadingView /></Screen>;
  if (order.isError) return <Screen title="Payment"><ErrorState error={order.error} onRetry={() => order.refetch()} /></Screen>;
  const o = order.data;
  const paid = payment?.status === 'paid' || o.paymentStatus === 'paid';

  return (
    <Screen title="Pay online" subtitle={o.reference}>
      <Card className="mb-4">
        <KeyValue label="Shop" value={o.shop.name} />
        <KeyValue label="Amount" value={formatNaira(o.totalKobo)} strong />
        <View className="mt-2 flex-row justify-end">
          <PaymentStatusBadge status={payment?.status ?? o.paymentStatus} />
        </View>
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {paid ? (
        <View className="items-center py-6">
          <CheckCircle2 size={52} color={colors.brandMid} />
          <Text className="mt-3 text-xl font-bold text-ink-900">Payment verified</Text>
          <Body className="mt-1 text-center text-sm">The payment provider confirmed your payment. The seller has been notified.</Body>
          <Button title="Back to order" className="mt-6" onPress={() => router.back()} />
        </View>
      ) : payment && payment.status === 'pending' ? (
        <View>
          <Notice tone="info" title="Waiting for confirmation">If you completed payment, it can take a moment to confirm. We also check automatically in the background.</Notice>
          <Button title="Check payment status" onPress={() => verify.mutate(payment.reference)} loading={verify.isPending} fullWidth className="mb-3" />
          {payment.authorizationUrl ? <Button title="Reopen payment page" variant="outline" onPress={() => void WebBrowser.openAuthSessionAsync(payment.authorizationUrl!, 'kantinkwari://payment-complete').then(() => verify.mutate(payment.reference))} fullWidth /> : null}
        </View>
      ) : payment && ['failed', 'cancelled'].includes(payment.status) ? (
        <View className="items-center py-4">
          <XCircle size={44} color={colors.danger} />
          <Text className="mt-2 text-lg font-bold text-ink-900">Payment not completed</Text>
          <Button title="Try again" className="mt-4" onPress={() => { setPayment(null); router.replace(`/payment/${orderId}`); }} />
        </View>
      ) : (
        <>
          <Body className="mb-4 text-sm">You’ll be taken to the secure payment page of our payment provider. We never see or store your card details.</Body>
          <Button title={`Pay ${formatNaira(o.totalKobo)}`} icon={CreditCard} onPress={() => start.mutate()} loading={start.isPending || verify.isPending} fullWidth size="lg" />
        </>
      )}
    </Screen>
  );
}
