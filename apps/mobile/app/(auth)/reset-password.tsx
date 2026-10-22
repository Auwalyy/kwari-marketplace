import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Lock } from 'lucide-react-native';
import { passwordSchema } from '@kkdm/shared';
import { Body, Button, ErrorState, Screen, TextField, Title, toast } from '@/components/ui';
import { api } from '@/lib/api';

export default function ResetPassword() {
  const { identifier = '' } = useLocalSearchParams<{ identifier?: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const pwCheck = passwordSchema.safeParse(password);
  const m = useMutation({
    mutationFn: () => api.post('/auth/password/reset', { identifier, code, newPassword: password }),
    onSuccess: () => {
      toast.success('Password updated. Sign in with your new password.');
      router.replace('/(auth)/login');
    },
  });
  return (
    <Screen title="" back>
      <View className="pt-4">
        <Title>Enter the code</Title>
        <Body className="mb-6 mt-1">We sent a 6-digit code to {identifier}. Resetting your password signs you out on all devices.</Body>
        {m.error ? (
          <View className="mb-4">
            <ErrorState error={m.error} compact />
          </View>
        ) : null}
        <TextField label="Reset code" icon={KeyRound} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" />
        <TextField label="New password" icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" error={password && !pwCheck.success ? pwCheck.error.issues[0].message : undefined} hint="At least 8 characters with a letter and a number" />
        <Button title="Update password" onPress={() => m.mutate()} loading={m.isPending} disabled={code.length !== 6 || !pwCheck.success} fullWidth size="lg" />
      </View>
    </Screen>
  );
}
