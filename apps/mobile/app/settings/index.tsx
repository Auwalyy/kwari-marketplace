import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Laptop, Smartphone } from 'lucide-react-native';
import { passwordSchema, type AuthTokens, type MeDto, type SessionDto } from '@kkdm/shared';
import { Avatar, Badge, Button, Card, Divider, Notice, Screen, SectionHeader, TextField, pickImages, toast, useConfirm } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/store/auth';

export default function Settings() {
  const user = useAuth((s) => s.user)!;
  const applyTokens = useAuth((s) => s.applyTokens);
  const logout = useAuth((s) => s.logout);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [profile, setProfile] = useDerivedState(user, (u) => ({ fullName: u.fullName, email: u.email ?? '', phone: u.phone ?? '' }), { fullName: '', email: '', phone: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [deletePw, setDeletePw] = useState('');

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionDto[]>('/auth/sessions') });
  const setUser = (me: MeDto) => useAuth.setState({ user: me });
  const saveProfile = useMutation({
    mutationFn: () => api.patch<MeDto>('/users/me', { fullName: profile.fullName, email: profile.email || undefined, phone: profile.phone || undefined }),
    onSuccess: (me) => {
      setUser(me);
      toast.success('Profile saved');
    },
    onError: (e) => toast.apiError(e),
  });
  const avatar = useMutation({
    mutationFn: async () => {
      const [img] = await pickImages('library', { crop: true });
      if (!img) return null;
      return api.upload<MeDto>('/users/me/avatar', [{ field: 'image', uri: img.uri, name: img.name, type: img.type }]);
    },
    onSuccess: (me) => me && setUser(me),
    onError: (e) => toast.apiError(e),
  });
  const changePw = useMutation({
    mutationFn: () => api.post<AuthTokens>('/auth/password/change', { currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: async (tokens) => {
      await applyTokens(tokens);
      setPw({ current: '', next: '' });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Password changed. Other devices were signed out.');
    },
    onError: (e) => toast.apiError(e),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const deleteAccount = useMutation({
    mutationFn: (reason?: string) => api.del('/users/me', { password: deletePw, reason }),
    onSuccess: async () => {
      await logout({ remote: false });
      toast.success('Your account was deleted');
      router.replace('/(tabs)');
    },
    onError: (e) => toast.apiError(e),
  });

  if (!user) return null;
  const pwOk = passwordSchema.safeParse(pw.next).success;
  const ownsShop = user.shops.some((s) => s.role === 'owner' && s.shopStatus !== 'closed' && s.shopStatus !== 'rejected');

  return (
    <Screen title="Profile & security">
      <View className="mb-4 items-center">
        <Pressable onPress={() => avatar.mutate()} accessibilityLabel="Change photo">
          {user.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={{ width: 84, height: 84, borderRadius: 42 }} /> : <Avatar name={user.fullName} size={84} />}
          <View className="absolute bottom-0 right-0 h-7 w-7 items-center justify-center rounded-full bg-brand-700">
            <Camera size={14} color={colors.white} />
          </View>
        </Pressable>
      </View>

      <SectionHeader title="Profile" />
      <TextField label="Full name" value={profile.fullName} onChangeText={(t) => setProfile((p) => ({ ...p, fullName: t }))} />
      <TextField label="Email" value={profile.email} onChangeText={(t) => setProfile((p) => ({ ...p, email: t }))} keyboardType="email-address" autoCapitalize="none" right={user.email ? <Badge label={user.emailVerified ? 'Verified' : 'Unverified'} tone={user.emailVerified ? 'success' : 'warning'} /> : undefined} />
      <TextField label="Phone" value={profile.phone} onChangeText={(t) => setProfile((p) => ({ ...p, phone: t }))} keyboardType="phone-pad" right={user.phone ? <Badge label={user.phoneVerified ? 'Verified' : 'Unverified'} tone={user.phoneVerified ? 'success' : 'warning'} /> : undefined} />
      <Text className="-mt-2 mb-3 text-xs text-ink-500">Changing your email or phone requires verifying it again.</Text>
      <View className="flex-row">
        <Button title="Save profile" onPress={() => saveProfile.mutate()} loading={saveProfile.isPending} className="mr-2" />
        <Button title="Verify contacts" variant="outline" onPress={() => router.push('/(auth)/verify')} />
      </View>

      <SectionHeader title="Change password" />
      <TextField label="Current password" value={pw.current} onChangeText={(t) => setPw((p) => ({ ...p, current: t }))} secureTextEntry />
      <TextField label="New password" value={pw.next} onChangeText={(t) => setPw((p) => ({ ...p, next: t }))} secureTextEntry hint="At least 8 characters with a letter and a number" error={pw.next && !pwOk ? 'Password is too weak' : undefined} />
      <Button title="Change password" variant="secondary" onPress={() => changePw.mutate()} disabled={!pw.current || !pwOk} loading={changePw.isPending} />

      <SectionHeader title="Signed-in devices" />
      <Card>
        {sessions.data?.map((s, i) => (
          <View key={s.id}>
            {i ? <Divider /> : null}
            <View className="flex-row items-center">
              {/Mobile|Android|iPhone|okhttp|Expo/i.test(s.userAgent ?? '') ? <Smartphone size={18} color={colors.inkMuted} /> : <Laptop size={18} color={colors.inkMuted} />}
              <View className="ml-3 flex-1">
                <Text className="font-semibold text-ink-900">{s.deviceName ?? 'Unknown device'}{s.current ? ' (this device)' : ''}</Text>
                <Text className="text-xs text-ink-500">Last active {formatDateTime(s.lastUsedAt)}</Text>
              </View>
              {!s.current ? <Button title="Sign out" size="sm" variant="ghost" onPress={() => revoke.mutate(s.id)} /> : null}
            </View>
          </View>
        ))}
      </Card>
      <Button
        title="Sign out of all devices"
        variant="outline"
        className="mt-3"
        onPress={async () => {
          if (!(await confirm({ title: 'Sign out everywhere?', message: 'You will need to sign in again on every device, including this one.', confirmLabel: 'Sign out all' })).confirmed) return;
          await logout({ everywhere: true });
          router.replace('/(tabs)');
        }}
      />

      <SectionHeader title="Delete account" />
      {ownsShop ? (
        <Notice tone="warning">You own a shop. Close it or transfer ownership before deleting your account.</Notice>
      ) : (
        <>
          <Text className="mb-3 text-sm text-ink-600">Deleting removes your profile, addresses, favourites and history and signs you out everywhere. Order and review records are kept in anonymised form for legal and dispute purposes.</Text>
          <TextField label="Confirm with your password" value={deletePw} onChangeText={setDeletePw} secureTextEntry />
          <Button
            title="Delete my account"
            variant="danger"
            disabled={!deletePw}
            loading={deleteAccount.isPending}
            onPress={async () => {
              const r = await confirm({ title: 'Permanently delete your account?', message: 'This cannot be undone.', destructive: true, confirmLabel: 'Delete', reason: { placeholder: 'Why are you leaving? (optional)' } });
              if (r.confirmed) deleteAccount.mutate(r.reason);
            }}
          />
        </>
      )}
    </Screen>
  );
}
