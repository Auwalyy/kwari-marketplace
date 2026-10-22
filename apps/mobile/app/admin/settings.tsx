import { Text } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, KeyValue, Notice, Screen, SectionHeader, TextField, toast } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';

interface Settings { keys: string[]; values: Record<string, unknown> }

/** Platform settings and a read-only view of which external services are configured. */
export default function AdminSettings() {
  const config = useAppConfig();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<Settings>('/admin/settings') });
  const [autoComplete, setAutoComplete] = useDerivedState(q.data, (d) => (typeof d.values['orders.autoCompleteDays'] === 'number' ? String(d.values['orders.autoCompleteDays']) : '7'), '7');
  const [support, setSupport] = useDerivedState(q.data, (d) => ({ phone: '', email: '', whatsapp: '', ...((d.values['support.contact'] as object) ?? {}) }), { phone: '', email: '', whatsapp: '' });

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/admin/settings/orders.autoCompleteDays', { value: Number(autoComplete) });
      await api.put('/admin/settings/support.contact', { value: { phone: support.phone || undefined, email: support.email || undefined, whatsapp: support.whatsapp || undefined } });
    },
    onSuccess: () => toast.success('Settings saved'),
    onError: (e) => toast.apiError(e),
  });
  const f = config.data?.features;
  return (
    <Screen title="Platform settings" footer={<Button title="Save settings" onPress={() => save.mutate()} loading={save.isPending} fullWidth />}>
      <SectionHeader title="Service configuration" />
      <Card className="mb-3">
        <KeyValue label="Visual search" value={f ? (f.visualSearch.available ? `${f.visualSearch.provider}${f.visualSearch.developmentOnly ? ' (development baseline)' : ''}` : 'Not configured') : '…'} />
        <KeyValue label="Online payments" value={f ? (f.onlinePayment.available ? f.onlinePayment.provider! : 'Not configured') : '…'} />
        <KeyValue label="Push notifications" value={f ? (f.pushNotifications ? 'Enabled' : 'Disabled') : '…'} />
        <KeyValue label="Maps" value={f ? (f.maps ? 'Configured' : 'Not configured (written directions shown)') : '…'} />
      </Card>
      <Notice tone="info">Provider keys and secrets are set in the server environment (see docs/), never in the app.</Notice>
      <SectionHeader title="Orders" />
      <TextField label="Auto-complete delivered orders after (days)" keyboardType="number-pad" value={autoComplete} onChangeText={setAutoComplete} />
      <SectionHeader title="Support contact" />
      <TextField label="Phone" value={support.phone} onChangeText={(t) => setSupport((s) => ({ ...s, phone: t }))} />
      <TextField label="Email" value={support.email} onChangeText={(t) => setSupport((s) => ({ ...s, email: t }))} autoCapitalize="none" />
      <TextField label="WhatsApp" value={support.whatsapp} onChangeText={(t) => setSupport((s) => ({ ...s, whatsapp: t }))} />
      <Text className="text-xs text-ink-500">Every settings change is recorded in the audit log.</Text>
    </Screen>
  );
}
