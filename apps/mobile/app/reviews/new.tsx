import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto } from '@kkdm/shared';
import { Button, Card, ChoiceChips, ErrorState, Heading, LoadingView, Screen, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';

/** Review a delivered/collected order: the shop, or one of the products in it. */
export default function NewReview() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['orders', 'detail', orderId], queryFn: () => api.get<OrderDto>(`/orders/${orderId}`) });
  const [scope, setScope] = useState<string>('shop');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post('/reviews', { orderId, productId: scope === 'shop' ? undefined : scope, rating, text: text || undefined }),
    onSuccess: () => {
      toast.success('Thank you for your review');
      void qc.invalidateQueries({ queryKey: ['orders'] });
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  if (order.isPending) return <Screen title="Write a review"><LoadingView /></Screen>;
  if (order.isError) return <Screen title="Write a review"><ErrorState error={order.error} /></Screen>;
  const o = order.data;
  return (
    <Screen title="Write a review" subtitle={o.reference} footer={<Button title="Submit review" onPress={() => submit.mutate()} disabled={!rating} loading={submit.isPending} fullWidth />}>
      <ChoiceChips label="What are you reviewing?" options={[{ value: 'shop', label: `The shop (${o.shop.name})` }, ...o.items.map((i) => ({ value: i.productId, label: i.productName }))]} value={scope} onChange={(v) => v && setScope(v)} />
      <Card className="mb-4 items-center">
        <Heading className="mb-2">Your rating</Heading>
        <View className="flex-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} accessibilityLabel={`${n} stars`} className="px-1.5">
              <Text className={`text-4xl ${n <= rating ? 'text-gold-500' : 'text-cream-300'}`}>★</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <TextField label="Tell others about the quality, accuracy and service (optional)" value={text} onChangeText={setText} multiline maxLength={2000} />
    </Screen>
  );
}
