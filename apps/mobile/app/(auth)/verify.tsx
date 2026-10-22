import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Mail, Phone } from 'lucide-react-native';
import { Badge, Body, Button, Card, Heading, Screen, TextField, Title, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** Email / phone verification with one-time codes (sent when the account was created). */
export default function Verify() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const user = useAuth((s) => s.user);
  const refreshUser = useAuth((s) => s.refreshUser);
  const [codes, setCodes] = useState<Record<string, string>>({ email: '', phone: '' });

  const request = useMutation({
    mutationFn: (channel: 'email' | 'phone') => api.post('/auth/verification/request', { channel }),
    onSuccess: () => toast.success('Code sent'),
    onError: (e) => toast.apiError(e),
  });
  const confirm = useMutation({
    mutationFn: (channel: 'email' | 'phone') => api.post('/auth/verification/confirm', { channel, code: codes[channel] }),
    onSuccess: async () => {
      toast.success('Verified');
      await refreshUser();
    },
    onError: (e) => toast.apiError(e),
  });

  if (!user) return null;
  const channels = [
    { key: 'email' as const, value: user.email, verified: user.emailVerified, icon: Mail, label: 'Email' },
    { key: 'phone' as const, value: user.phone, verified: user.phoneVerified, icon: Phone, label: 'Phone' },
  ].filter((c) => c.value);

  return (
    <Screen title={first ? '' : 'Verify your contacts'} back={!first}>
      {first ? (
        <View className="pt-4">
          <Title>Verify your account</Title>
          <Body className="mb-5 mt-1">We sent a 6-digit code to each contact you added. Verification helps sellers and buyers trust each other.</Body>
        </View>
      ) : null}
      {channels.map((c) => (
        <Card key={c.key} className="mb-4">
          <View className="mb-3 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center">
              <c.icon size={18} color="#174F33" />
              <Heading className="ml-2 flex-1" numberOfLines={1}>
                {c.value}
              </Heading>
            </View>
            {c.verified ? <Badge label="Verified" tone="success" /> : <Badge label="Not verified" tone="warning" />}
          </View>
          {c.verified ? (
            <View className="flex-row items-center">
              <CheckCircle2 size={16} color="#2B7D4F" />
              <Body className="ml-2">This {c.label.toLowerCase()} is verified.</Body>
            </View>
          ) : (
            <>
              <TextField value={codes[c.key]} onChangeText={(t) => setCodes((s) => ({ ...s, [c.key]: t.replace(/\D/g, '').slice(0, 6) }))} keyboardType="number-pad" placeholder="6-digit code" maxLength={6} textContentType="oneTimeCode" />
              <View className="flex-row">
                <Button title="Resend code" variant="outline" size="sm" onPress={() => request.mutate(c.key)} loading={request.isPending && request.variables === c.key} className="mr-2" />
                <Button title="Verify" size="sm" disabled={codes[c.key].length !== 6} onPress={() => confirm.mutate(c.key)} loading={confirm.isPending && confirm.variables === c.key} />
              </View>
            </>
          )}
        </Card>
      ))}
      <Button title={first ? 'Continue' : 'Done'} variant={first ? 'primary' : 'outline'} onPress={() => (first ? router.replace('/(tabs)') : router.back())} fullWidth />
    </Screen>
  );
}
