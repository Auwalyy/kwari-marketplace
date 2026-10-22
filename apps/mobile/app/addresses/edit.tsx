import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { addressSchema, type AddressDto } from '@kkdm/shared';
import { Button, FormField, Screen, SwitchRow, toast } from '@/components/ui';
import { api } from '@/lib/api';

type Form = z.input<typeof addressSchema>;

export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<AddressDto[]>('/users/me/addresses'), enabled: !!id });
  const { control, handleSubmit, reset } = useForm<Form>({
    resolver: zodResolver(addressSchema),
    defaultValues: { label: 'Home', recipientName: '', phone: '', line1: '', line2: '', city: 'Kano', state: 'Kano', landmark: '', isDefault: false },
  });
  useEffect(() => {
    const a = list.data?.find((x) => x.id === id);
    if (a) reset({ label: a.label, recipientName: a.recipientName, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', city: a.city, state: a.state, landmark: a.landmark ?? '', isDefault: a.isDefault });
  }, [list.data, id, reset]);
  const save = useMutation({
    mutationFn: (v: unknown) => (id ? api.patch(`/users/me/addresses/${id}`, v) : api.post('/users/me/addresses', v)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['addresses'] });
      toast.success('Address saved');
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title={id ? 'Edit address' : 'New address'} footer={<Button title="Save address" onPress={() => void handleSubmit((v) => save.mutate({ ...v, line2: v.line2 || undefined, landmark: v.landmark || undefined }))()} loading={save.isPending} fullWidth />}>
      <FormField control={control} name="label" label="Label" placeholder="Home, Office, Shop…" />
      <FormField control={control} name="recipientName" label="Recipient name" autoComplete="name" />
      <FormField control={control} name="phone" label="Recipient phone" keyboardType="phone-pad" autoComplete="tel" />
      <FormField control={control} name="line1" label="Street address" placeholder="House number and street" />
      <FormField control={control} name="line2" label="Apartment / area (optional)" />
      <FormField control={control} name="landmark" label="Nearest landmark (optional)" placeholder="e.g. opposite Kano Club" />
      <FormField control={control} name="city" label="City / town" />
      <FormField control={control} name="state" label="State" />
      <Controller control={control} name="isDefault" render={({ field }) => <SwitchRow label="Use as default address" value={!!field.value} onChange={field.onChange} />} />
    </Screen>
  );
}
