import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Body, Button, Card, KeyValue, LoadingView, Notice, Screen, SectionHeader, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface Report { id: string; reporter: { fullName?: string }; targetType: string; targetId: string; shopId: string | null; category: string; description: string; status: string; actions: { action: string; note?: string; at: string }[]; resolution?: string; createdAt: string }

const ACTIONS_FOR: Record<string, { action: string; label: string; destructive?: boolean }[]> = {
  message: [{ action: 'hide_message', label: 'Hide message', destructive: true }],
  review: [{ action: 'remove_review', label: 'Remove review', destructive: true }],
  product: [{ action: 'flag_product', label: 'Flag product' }, { action: 'remove_product', label: 'Remove product', destructive: true }],
  shop: [{ action: 'suspend_shop', label: 'Suspend shop', destructive: true }],
  user: [{ action: 'suspend_user', label: 'Suspend user', destructive: true }],
  order: [],
};

/** Report review: see the reported content, take moderation action, resolve or dismiss. */
export default function AdminReport() {
  const { id, data } = useLocalSearchParams<{ id: string; data?: string }>();
  const report: Report | null = data ? JSON.parse(data) : null;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = useAuth((s) => s.user?.platformRoles.includes('admin'));
  const context = useQuery({ queryKey: ['admin', 'report-context', id], queryFn: () => api.get<{ context: any }>(`/admin/reports/${id}/context`) });
  const act = useMutation({
    mutationFn: ({ action, note }: { action: string; note: string }) => api.post<{ status: string }>(`/admin/reports/${id}/action`, { action, note }),
    onSuccess: () => {
      toast.success('Action recorded');
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  const run = async (action: string, label: string, destructive?: boolean) => {
    const r = await confirm({ title: `${label}?`, destructive, reason: { placeholder: 'Note (shared as the outcome where appropriate; audited)', required: true }, confirmLabel: label });
    if (r.confirmed && r.reason) act.mutate({ action, note: r.reason });
  };
  if (!report) return <Screen title="Report"><LoadingView /></Screen>;
  const ctx = context.data?.context;
  return (
    <Screen title="Report" subtitle={titleCase(report.category)}>
      <Card className="mb-3">
        <KeyValue label="Status" value={<Badge label={report.status} />} />
        <KeyValue label="Reporter" value={report.reporter.fullName ?? ''} />
        <KeyValue label="Target" value={report.targetType} />
        <KeyValue label="Reported" value={formatDateTime(report.createdAt)} />
        <Body className="mt-2 text-sm">{report.description}</Body>
      </Card>
      <SectionHeader title="Reported content" />
      <Card className="mb-3">
        {context.isPending ? <LoadingView /> : ctx ? (
          <>
            {ctx.text !== undefined ? <Text className="text-sm text-ink-800">“{ctx.text}” {ctx.hidden ? '(hidden)' : ''}</Text> : null}
            {ctx.rating !== undefined ? <Text className="text-sm text-ink-800">{'★'.repeat(ctx.rating)} {ctx.text} · {ctx.status}</Text> : null}
            {ctx.name ? <Text className="text-sm font-semibold text-ink-900">{ctx.name}</Text> : null}
            {ctx.fullName ? <Text className="text-sm text-ink-800">{ctx.fullName} · {ctx.status}</Text> : null}
            {ctx.reference ? <Text className="text-sm text-ink-800">Order {ctx.reference} · {ctx.status}</Text> : null}
            {report.targetType === 'product' ? <Button title="Open product" size="sm" variant="ghost" className="mt-1 self-start" onPress={() => router.push(`/product/${report.targetId}`)} /> : null}
            {report.targetType === 'shop' && ctx.slug ? <Button title="Open shop" size="sm" variant="ghost" className="mt-1 self-start" onPress={() => router.push(`/shop/${ctx.slug}`)} /> : null}
          </>
        ) : (
          <Text className="text-sm text-ink-500">The content no longer exists.</Text>
        )}
        <Text className="mt-2 text-xs text-ink-400">Viewing reported content is recorded in the audit log.</Text>
      </Card>
      {report.status === 'open' || report.status === 'investigating' ? (
        <>
          <View className="flex-row flex-wrap">
            {(ACTIONS_FOR[report.targetType] ?? []).filter((a) => a.action !== 'suspend_user' || isAdmin).map((a) => (
              <Button key={a.action} title={a.label} variant={a.destructive ? 'danger' : 'secondary'} size="sm" className="mb-2 mr-2" onPress={() => void run(a.action, a.label, a.destructive)} />
            ))}
            {report.shopId && report.targetType !== 'shop' ? <Button title="Suspend shop" variant="danger" size="sm" className="mb-2 mr-2" onPress={() => void run('suspend_shop', 'Suspend shop', true)} /> : null}
          </View>
          <View className="flex-row flex-wrap">
            {report.status === 'open' ? <Button title="Mark investigating" variant="outline" size="sm" className="mb-2 mr-2" onPress={() => void run('investigate', 'Mark investigating')} /> : null}
            <Button title="Resolve (no further action)" variant="outline" size="sm" className="mb-2 mr-2" onPress={() => void run('resolve', 'Resolve')} />
            <Button title="Dismiss" variant="ghost" size="sm" className="mb-2" onPress={() => void run('dismiss', 'Dismiss')} />
          </View>
        </>
      ) : (
        <Notice tone="info" title="Closed">{report.resolution ?? ''}</Notice>
      )}
      {report.actions.length ? (
        <>
          <SectionHeader title="Actions" />
          {report.actions.map((a, i) => <Text key={i} className="mb-1 text-xs text-ink-600">{formatDateTime(a.at)} · {a.action}{a.note ? ` — ${a.note}` : ''}</Text>)}
        </>
      ) : null}
    </Screen>
  );
}
