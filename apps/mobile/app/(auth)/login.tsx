import { Pressable, Text, View } from 'react-native';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { Lock, Mail } from 'lucide-react-native';
import { loginSchema, type AuthResponse, type LoginInput } from '@kkdm/shared';
import { Body, Button, ErrorState, FormField, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function Login() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const applyAuth = useAuth((s) => s.applyAuth);
  const { control, handleSubmit } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: '', password: '' } });
  const login = useMutation({
    mutationFn: (v: LoginInput) => api.post<AuthResponse>('/auth/login', { ...v, deviceName: Device.deviceName ?? Device.modelName ?? undefined }),
    onSuccess: async (res) => {
      await applyAuth(res);
      if (next && next !== '/login') router.replace(next as never);
      else router.replace('/(tabs)');
    },
  });

  return (
    <Screen title="" back>
      <View className="pt-4">
        <Title>Welcome back</Title>
        <Body className="mb-6 mt-1">Sign in with your email address or phone number.</Body>
        {login.error ? (
          <View className="mb-4">
            <ErrorState error={login.error} compact />
          </View>
        ) : null}
        <FormField control={control} name="identifier" label="Email or phone" icon={Mail} autoCapitalize="none" autoComplete="username" keyboardType="email-address" placeholder="you@example.com or 0803…" />
        <FormField control={control} name="password" label="Password" icon={Lock} secureTextEntry autoComplete="current-password" placeholder="Your password" />
        <Pressable onPress={() => router.push('/(auth)/forgot-password')} className="mb-6 self-end" hitSlop={8}>
          <Text className="font-semibold text-brand-700">Forgot password?</Text>
        </Pressable>
        <Button title="Sign in" onPress={() => void handleSubmit((v) => login.mutate(v))()} loading={login.isPending} fullWidth size="lg" />
        <View className="mt-6 flex-row justify-center">
          <Text className="text-ink-600">New here? </Text>
          <Link href="/(auth)/register" replace>
            <Text className="font-semibold text-brand-700">Create an account</Text>
          </Link>
        </View>
      </View>
    </Screen>
  );
}
