import { useLocalSearchParams } from 'expo-router';
import { OrderDetail } from '@/features/orders/OrderDetail';

export default function CustomerOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderDetail orderId={id} />;
}
