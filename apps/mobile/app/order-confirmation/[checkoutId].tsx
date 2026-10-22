import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react-native';
import { PAYMENT_METHOD_LABELS, type CheckoutResultDto } from '@kkdm/shared';
import { Button, Card, KeyValue, OrderStatusBadge, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { formatNaira } from '@/lib/format';

export default function OrderConfirmation() {
  const { checkoutId } = useLocalSearchParams<{ checkoutId: string }>();
  const data = useQueryClient().getQueryData<CheckoutResultDto>(['checkout', checkoutId]);
  return (
    <Screen title="Order placed" back={false} footer={<Button title="View my orders" onPress={() => router.replace('/orders')} fullWidth size="lg" />}>
      <View className="items-center py-6">
        <CheckCircle2 size={56} color={colors.brandMid} />
        <Text className="mt-3 text-2xl font-bold text-ink-900">Thank you!</Text>
        <Text className="mt-1 text-center text-sm text-ink-600">Your order{(data?.orders.length ?? 0) > 1 ? 's were' : ' was'} sent to the seller{(data?.orders.length ?? 0) > 1 ? 's' : ''}. You’ll be notified when they accept.</Text>
      </View>
      {data?.orders.map((o) => (
        <Card key={o.id} className="mb-3" onPress={() => router.push(`/orders/${o.id}`)}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink-900">{o.reference}</Text>
            <OrderStatusBadge status={o.status} />
          </View>
          <KeyValue label="Shop" value={o.shop.name} />
          <KeyValue label="Fulfilment" value={o.fulfilmentMethod === 'pickup' ? 'Pickup at shop' : 'Delivery'} />
          <KeyValue label="Payment" value={PAYMENT_METHOD_LABELS[o.paymentMethod]} />
          <KeyValue label="Total" value={o.delivery?.status === 'awaiting_quote' ? `${formatNaira(o.totalKobo)} + delivery (quoted)` : formatNaira(o.totalKobo)} strong />
        </Card>
      ))}
      <Button title="Continue shopping" variant="ghost" onPress={() => router.replace('/(tabs)')} fullWidth />
    </Screen>
  );
}
