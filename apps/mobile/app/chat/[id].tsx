import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FileText, ImagePlus, MoreVertical, Package, Send } from 'lucide-react-native';
import { SOCKET_EVENTS, type ConversationDto, type MessageDto } from '@kkdm/shared';
import { ActionSheet, ErrorState, Header, IconButton, LoadingView, pickImages, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSocketEvent } from '@/hooks';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { formatNaira, formatTime, unitLabel, uuid } from '@/lib/format';
import { emitWithAck, joinConversation, leaveConversation, onReconnect } from '@/lib/socket';
import { useAuth } from '@/store/auth';

type UiMessage = MessageDto & { pending?: boolean; failed?: boolean };

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const menu = useRef<SheetHandle>(null);
  const token = useAuth((s) => s.accessToken);
  const me = useAuth((s) => s.user);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api.get<ConversationDto & { viewerSide: 'customer' | 'shop' }>(`/conversations/${id}`) });
  const side = conv.data?.viewerSide;

  const merge = useCallback((incoming: MessageDto[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.clientMessageId ?? m.id, m]));
      for (const m of incoming) {
        const key = m.clientMessageId ?? m.id;
        map.set(key, { ...map.get(key), ...m, pending: false, failed: false });
      }
      return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const loadLatest = useCallback(async () => {
    const res = await api.get<{ messages: MessageDto[]; hasMore: boolean }>(`/conversations/${id}/messages`, { limit: 30 });
    merge(res.messages);
    setHasMore((h) => h || res.hasMore);
    void api.post(`/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['conversations'] }));
  }, [id, merge, qc]);

  useEffect(() => {
    void loadLatest().then(() => undefined, () => undefined);
    void joinConversation(id).then((r) => r.ok && setOtherOnline(!!r.data?.otherSideOnline));
    // After a reconnect, fetch anything missed while offline (sockets are not the source of truth).
    const off = onReconnect(() => void loadLatest());
    return () => {
      off();
      leaveConversation(id);
    };
  }, [id, loadLatest]);

  useSocketEvent(SOCKET_EVENTS.messageNew, (m: MessageDto) => {
    if (m.conversationId !== id) return;
    merge([m]);
    if (m.senderSide !== side) void emitWithAck(SOCKET_EVENTS.messageRead, { conversationId: id });
  });
  useSocketEvent(SOCKET_EVENTS.messageRead, (p: { conversationId: string; side: string }) => {
    if (p.conversationId === id && p.side !== side) setMessages((ms) => ms.map((m) => (m.senderSide === side ? { ...m, readByOtherSide: true } : m)));
  });
  useSocketEvent(SOCKET_EVENTS.conversationTyping, (p: { conversationId: string; typing: boolean; side: string }) => {
    if (p.conversationId !== id || p.side === side) return;
    setOtherTyping(p.typing);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (p.typing) typingTimer.current = setTimeout(() => setOtherTyping(false), 6000);
  });
  useSocketEvent(SOCKET_EVENTS.conversationPresence, (p: { conversationId: string; online: boolean; side: string }) => {
    if (p.conversationId === id && p.side !== side) setOtherOnline(p.online);
  });

  const loadOlder = async () => {
    if (!hasMore || loadingOlder || !messages.length) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[messages.length - 1].createdAt;
      const res = await api.get<{ messages: MessageDto[]; hasMore: boolean }>(`/conversations/${id}/messages`, { before: oldest, limit: 30 });
      merge(res.messages);
      setHasMore(res.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (body: string, clientMessageId = `m-${uuid()}`) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setText('');
    const optimistic: UiMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId: id,
      senderId: me?.id ?? '',
      senderName: me?.fullName ?? '',
      senderSide: side ?? 'customer',
      type: 'text',
      text: trimmed,
      readByOtherSide: false,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((ms) => [optimistic, ...ms.filter((m) => m.clientMessageId !== clientMessageId)]);
    const payload = { conversationId: id, clientMessageId, type: 'text', text: trimmed };
    const viaSocket = await emitWithAck<MessageDto>(SOCKET_EVENTS.messageSend, payload);
    if (viaSocket.ok && viaSocket.data) return merge([viaSocket.data]);
    if (viaSocket.error && !['OFFLINE', 'TIMEOUT'].includes(viaSocket.error.code)) {
      setMessages((ms) => ms.map((m) => (m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m)));
      return toast.error(viaSocket.error.message);
    }
    // Socket unavailable: fall back to REST with the same clientMessageId (server de-duplicates).
    try {
      merge([await api.post<MessageDto>(`/conversations/${id}/messages`, { clientMessageId, type: 'text', text: trimmed })]);
    } catch (e) {
      setMessages((ms) => ms.map((m) => (m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m)));
      toast.apiError(e);
    }
  };

  const sendImage = async () => {
    const [img] = await pickImages('library');
    if (!img) return;
    const clientMessageId = `i-${uuid()}`;
    try {
      merge([await api.upload<MessageDto>(`/conversations/${id}/images`, [{ field: 'image', uri: img.uri, name: img.name, type: img.type }], { clientMessageId })]);
    } catch (e) {
      toast.apiError(e);
    }
  };

  const onType = (t: string) => {
    setText(t);
    const now = Date.now();
    if (now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      void emitWithAck(SOCKET_EVENTS.conversationTyping, { conversationId: id, typing: t.length > 0 }, 2000);
    }
  };

  const block = async () => {
    const r = await confirm({ title: 'Block this conversation?', message: 'Neither side will be able to send messages until you unblock (Account → Reports & blocked accounts).', destructive: true, confirmLabel: 'Block' });
    if (!r.confirmed) return;
    try {
      await api.post(`/blocks/conversation/${id}`);
      toast.success('Blocked');
      void conv.refetch();
    } catch (e) {
      toast.apiError(e);
    }
  };

  const title = conv.data ? (side === 'customer' ? conv.data.shop.name : conv.data.customer.fullName) : '';
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  if (conv.isPending) return <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}><LoadingView /></View>;
  if (conv.isError) return <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}><Header title="Chat" /><ErrorState error={conv.error} onRetry={() => conv.refetch()} /></View>;

  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      <Header
        title={title}
        subtitle={otherTyping ? 'typing…' : otherOnline ? 'online' : side === 'customer' ? 'Shop' : 'Customer'}
        right={<IconButton icon={MoreVertical} label="Conversation options" onPress={() => menu.current?.open()} />}
      />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 56}>
        <FlatList
          data={messages}
          inverted
          keyExtractor={(m) => m.clientMessageId ?? m.id}
          contentContainerStyle={{ padding: 12 }}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.brand} style={{ margin: 12 }} /> : undefined}
          renderItem={({ item }) => <Bubble m={item} mine={item.senderSide === side} headers={headers} onRetry={() => item.text && void send(item.text, item.clientMessageId)} />}
          ListEmptyComponent={<Text className="mt-10 text-center text-sm text-ink-500">Say hello — ask about price, colours or availability.</Text>}
        />
        {conv.data?.blocked ? (
          <View className="border-t border-line bg-white p-4" style={{ paddingBottom: insets.bottom + 8 }}>
            <Text className="text-center text-sm text-ink-600">Messaging is blocked in this conversation.</Text>
          </View>
        ) : (
          <View className="flex-row items-end border-t border-line bg-white px-2 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
            <IconButton icon={ImagePlus} label="Send a photo" color={colors.brand} onPress={() => void sendImage()} />
            {side === 'customer' ? <IconButton icon={FileText} label="Request quotation" color={colors.brand} onPress={() => router.push({ pathname: '/quotations/new', params: { shopId: conv.data!.shop.id } })} /> : null}
            <TextInput
              value={text}
              onChangeText={onType}
              placeholder="Message"
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={4000}
              className="mx-1 max-h-28 min-h-[40px] flex-1 rounded-2xl bg-cream-100 px-3 py-2 text-base text-ink-900"
              accessibilityLabel="Message"
            />
            <IconButton icon={Send} label="Send" color={text.trim() ? colors.brand : colors.inkFaint} onPress={() => void send(text)} />
          </View>
        )}
      </KeyboardAvoidingView>
      <ActionSheet
        ref={menu}
        actions={[
          ...(side === 'customer' ? [{ label: 'View shop', onPress: () => router.push(`/shop/${conv.data!.shop.slug}`) }] : []),
          { label: 'Report conversation', onPress: () => router.push({ pathname: '/report', params: { targetType: side === 'customer' ? 'shop' : 'user', targetId: side === 'customer' ? conv.data!.shop.id : conv.data!.customer.id, label: title } }) },
          { label: 'Block', destructive: true, onPress: () => void block() },
        ]}
      />
    </View>
  );
}

function Bubble({ m, mine, headers, onRetry }: { m: UiMessage; mine: boolean; headers?: Record<string, string>; onRetry: () => void }) {
  if (m.senderSide === 'system') {
    return (
      <Pressable onPress={() => m.quotationRef && router.push(`/quotations/${m.quotationRef.id}`)} className="my-2 self-center rounded-full bg-cream-200 px-3 py-1.5">
        <Text className="text-center text-xs text-ink-600">{m.text}</Text>
      </Pressable>
    );
  }
  return (
    <View className={`my-1 max-w-[82%] ${mine ? 'self-end' : 'self-start'}`}>
      <View className={`rounded-2xl px-3 py-2 ${mine ? 'rounded-br-md bg-brand-700' : 'rounded-bl-md border border-line bg-white'}`}>
        {m.product ? (
          <Pressable onPress={() => router.push(`/product/${m.product!.id}`)} className="mb-1 flex-row items-center rounded-xl bg-white/90 p-2">
            {m.product.thumbnailUrl ? <Image source={{ uri: m.product.thumbnailUrl }} style={{ width: 44, height: 44, borderRadius: 8 }} /> : <Package size={20} color={colors.brand} />}
            <View className="ml-2 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{m.product.name}</Text>
              <Text className="text-xs text-ink-600">{formatNaira(m.product.retailPriceKobo)} / {unitLabel(m.product.unit)}</Text>
            </View>
          </Pressable>
        ) : null}
        {m.quotationRef ? (
          <Pressable onPress={() => router.push(`/quotations/${m.quotationRef!.id}`)} className="mb-1 rounded-xl bg-white/90 p-2">
            <Text className="text-sm font-semibold text-ink-900">Quotation {m.quotationRef.reference}</Text>
            <Text className="text-xs text-ink-600">Status: {m.quotationRef.status} · tap to open</Text>
          </Pressable>
        ) : null}
        {m.orderRef ? (
          <Pressable onPress={() => router.push(`/orders/${m.orderRef!.id}`)} className="mb-1 rounded-xl bg-white/90 p-2">
            <Text className="text-sm font-semibold text-ink-900">Order {m.orderRef.reference}</Text>
          </Pressable>
        ) : null}
        {m.imageUrl ? <Image source={{ uri: `${API_URL}${m.imageUrl}`, headers }} style={{ width: 220, height: 220, borderRadius: 12 }} contentFit="cover" /> : null}
        {m.text ? <Text className={`text-base ${mine ? 'text-white' : 'text-ink-900'}`}>{m.text}</Text> : null}
      </View>
      <View className={`mt-0.5 flex-row items-center ${mine ? 'justify-end' : ''}`}>
        {m.pending ? <Clock size={10} color={colors.inkFaint} /> : null}
        <Text className="ml-1 text-[10px] text-ink-400">
          {formatTime(m.createdAt)}
          {mine && !m.pending && !m.failed ? (m.readByOtherSide ? ' · Read' : ' · Sent') : ''}
        </Text>
        {m.failed ? (
          <Text onPress={onRetry} className="ml-2 text-[11px] font-semibold text-danger-500">
            Not sent — tap to retry
          </Text>
        ) : null}
      </View>
    </View>
  );
}
