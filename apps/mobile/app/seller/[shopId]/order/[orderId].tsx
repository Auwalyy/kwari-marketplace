import { useLocalSearchParams } from 'expo-router';
import { OrderDetail } from '@/features/orders/OrderDetail';

export default function SellerOrder() {
  const { shopId, orderId } = useLocalSearchParams<{ shopId: string; orderId: string }>();
  return <OrderDetail orderId={orderId} shopId={shopId} />;
}
