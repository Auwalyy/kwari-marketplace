import { useState } from 'react';
import { Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { NOTIFICATION_PREFERENCE_GROUPS, type MeDto, type NotificationPreferenceGroup } from '@kkdm/shared';
import { Button, Notice, Screen, SectionHeader, SwitchRow, toast } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { api } from '@/lib/api';
import { registerForPush, unregisterPush } from '@/lib/push';
import { prefs } from '@/lib/secureStorage';
import { useAuth } from '@/store/auth';

const GROUP_LABEL: Record<NotificationPreferenceGroup, [string, string]> = {
  orders: ['Orders', 'New orders, acceptance, dispatch and delivery'],
  payments: ['Payments', 'Payment confirmations and refunds'],
  messages: ['Messages', 'New chat messages'],
  quotations: ['Quotations', 'Quotation requests, offers and replies'],
  shop: ['Shop & house', 'Invitations, memberships, workers, stock alerts, reviews'],
  trust: ['Trust & verification', 'Verification and report outcomes'],
  announcements: ['Announcements', 'Market news from administrators'],
};

/** Push preferences. In-app notification history is always kept; these control push delivery. */
export default function NotificationSettings() {
  const user = useAuth((s) => s.user)!;
  const config = useAppConfig();
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: { push?: boolean; groups?: Partial<Record<NotificationPreferenceGroup, boolean>> }) => api.patch<MeDto>('/users/me/notification-preferences', body),
    onSuccess: (me) => useAuth.setState({ user: me }),
    onError: (e) => toast.apiError(e),
  });
  const pushOn = user.notificationPreferences.push;

  return (
    <Screen title="Notification preferences">
      {config.data && !config.data.features.pushNotifications ? <Notice tone="warning">Push notifications are not enabled on this server yet. You’ll still see everything in the in-app Notifications screen.</Notice> : null}
      <SwitchRow
        label="Push notifications"
        description="Alerts on this phone"
        value={pushOn}
        onChange={async (v) => {
          update.mutate({ push: v });
          await prefs.set('pushOptIn', v);
          if (v) {
            const r = await registerForPush();
            setRegisterMsg(r.ok ? 'This device is registered for push.' : (r.reason ?? null));
          } else await unregisterPush();
        }}
      />
      {registerMsg ? <Text className="-mt-1 mb-3 text-xs text-ink-500">{registerMsg}</Text> : null}
      <SectionHeader title="Notify me about" />
      {NOTIFICATION_PREFERENCE_GROUPS.map((g) => (
        <SwitchRow key={g} label={GROUP_LABEL[g][0]} description={GROUP_LABEL[g][1]} value={user.notificationPreferences.groups[g] !== false} disabled={!pushOn} onChange={(v) => update.mutate({ groups: { [g]: v } })} />
      ))}
      <Button title="Re-register this device" variant="ghost" onPress={async () => { const r = await registerForPush(); setRegisterMsg(r.ok ? 'This device is registered for push.' : (r.reason ?? 'Could not register')); }} />
    </Screen>
  );
}
