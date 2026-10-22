import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { REPORT_CATEGORIES, type ReportTarget } from '@kkdm/shared';
import { Body, Button, ChoiceChips, Notice, Screen, SwitchRow, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { titleCase } from '@/lib/format';

/** Report a shop, product, message, review, order or account — optionally blocking at the same time. */
export default function Report() {
  const params = useLocalSearchParams<{ targetType: ReportTarget; targetId: string; label?: string; block?: string }>();
  const [category, setCategory] = useState<string | undefined>();
  const [description, setDescription] = useState('');
  const [block, setBlock] = useState(params.block === '1');
  const canBlock = params.targetType === 'shop' || params.targetType === 'user';
  const submit = useMutation({
    mutationFn: async () => {
      if (category) await api.post('/reports', { targetType: params.targetType, targetId: params.targetId, category, description });
      if (block && canBlock) await api.post('/blocks', { blockedType: params.targetType, blockedId: params.targetId });
    },
    onSuccess: () => {
      toast.success(category ? 'Report submitted. Our team will review it.' : 'Blocked');
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  const reportReady = !!category && description.trim().length >= 5;
  return (
    <Screen
      title={params.block === '1' ? 'Block' : 'Report'}
      subtitle={params.label}
      footer={<Button title={category ? 'Submit report' : block ? 'Block' : 'Submit'} onPress={() => submit.mutate()} loading={submit.isPending} disabled={!(reportReady || (block && canBlock && !category))} fullWidth />}
    >
      <Notice tone="info">Reports are reviewed by market administrators. False reports may lead to action on your account.</Notice>
      {canBlock ? <SwitchRow label={`Block this ${params.targetType === 'shop' ? 'shop' : 'person'}`} description="They won’t be able to message you, and you won’t see their messages." value={block} onChange={setBlock} /> : null}
      <ChoiceChips label="Reason for reporting (optional if only blocking)" options={REPORT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} value={category} onChange={setCategory} />
      {category ? <TextField label="What happened?" multiline value={description} onChangeText={setDescription} maxLength={2000} hint="At least 5 characters" /> : <Body className="text-sm">Choose a reason to file a report.</Body>}
    </Screen>
  );
}
