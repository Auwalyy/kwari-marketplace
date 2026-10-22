import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react-native';
import { Body, Button, ErrorState, Screen, TextField, Title } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/auth/password/forgot', { identifier }),
    onSuccess: () => router.push({ pathname: '/(auth)/reset-password', params: { identifier } }),
  });
  return (
    <Screen title="" back>
      <View className="pt-4">
        <Title>Reset your password</Title>
        <Body className="mb-6 mt-1">Enter the email or phone number on your account. If it matches an account, we’ll send a reset code.</Body>
        {m.error ? (
          <View className="mb-4">
            <ErrorState error={m.error} compact />
          </View>
        ) : null}
        <TextField label="Email or phone" icon={Mail} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" keyboardType="email-address" />
        <Button title="Send reset code" onPress={() => m.mutate()} loading={m.isPending} disabled={identifier.trim().length < 3} fullWidth size="lg" />
      </View>
    </Screen>
  );
}
