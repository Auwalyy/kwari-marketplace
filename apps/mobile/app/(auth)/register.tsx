import { Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Lock, Mail, Phone, User } from 'lucide-react-native';
import { registerSchema, type AuthResponse } from '@kkdm/shared';
import { Body, Button, ErrorState, FormField, Notice, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

const formSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name'),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    password: z.string(),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type Form = z.infer<typeof formSchema>;

export default function Register() {
  const applyAuth = useAuth((s) => s.applyAuth);
  const { control, handleSubmit, setError } = useForm<Form>({ resolver: zodResolver(formSchema), defaultValues: { fullName: '', email: '', phone: '', password: '', confirm: '' } });
  const register = useMutation({
    mutationFn: (body: unknown) => api.post<AuthResponse>('/auth/register', body),
    onSuccess: async (res) => {
      await applyAuth(res);
      router.replace({ pathname: '/(auth)/verify', params: { first: '1' } });
    },
  });

  const submit = (v: Form) => {
    // Validate against the shared API schema so messages match server rules exactly.
    const parsed = registerSchema.safeParse({ fullName: v.fullName, email: v.email || undefined, phone: v.phone || undefined, password: v.password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) setError(issue.path[0] as keyof Form, { message: issue.message });
      return;
    }
    register.mutate(parsed.data);
  };

  return (
    <Screen title="" back>
      <View className="pt-4">
        <Title>Create your account</Title>
        <Body className="mb-5 mt-1">One account works for shopping, running a shop and managing a house.</Body>
        {register.error ? (
          <View className="mb-4">
            <ErrorState error={register.error} compact />
          </View>
        ) : null}
        <FormField control={control} name="fullName" label="Full name" icon={User} autoComplete="name" placeholder="e.g. Aisha Bello" />
        <FormField control={control} name="email" label="Email (optional if you add a phone)" icon={Mail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@example.com" />
        <FormField control={control} name="phone" label="Phone number" icon={Phone} keyboardType="phone-pad" autoComplete="tel" placeholder="0803 123 4567" />
        <FormField control={control} name="password" label="Password" icon={Lock} secureTextEntry autoComplete="new-password" hint="At least 8 characters with a letter and a number" />
        <FormField control={control} name="confirm" label="Confirm password" icon={Lock} secureTextEntry autoComplete="new-password" />
        <Notice tone="info">Registering a physical shop? Create your account first, then use the invitation code from your house head under Account → Register a shop.</Notice>
        <Button title="Create account" onPress={() => void handleSubmit(submit)()} loading={register.isPending} fullWidth size="lg" />
        <View className="mt-6 flex-row justify-center">
          <Text className="text-ink-600">Already have an account? </Text>
          <Link href="/(auth)/login" replace>
            <Text className="font-semibold text-brand-700">Sign in</Text>
          </Link>
        </View>
      </View>
    </Screen>
  );
}
