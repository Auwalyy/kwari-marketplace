import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import type { ConversationDto } from '@kkdm/shared';
import { Avatar } from '@/components/ui';
import { timeAgo } from '@/lib/format';

export function ConversationRow({ c, side }: { c: ConversationDto; side: 'customer' | 'shop' }) {
  const name = side === 'customer' ? c.shop.name : c.customer.fullName;
  return (
    <Pressable onPress={() => router.push(`/chat/${c.id}`)} className="flex-row items-center border-b border-line py-3 active:bg-cream-50" accessibilityRole="button">
      {side === 'customer' && c.shop.logoUrl ? <Image source={{ uri: c.shop.logoUrl }} style={{ width: 44, height: 44, borderRadius: 22 }} /> : <Avatar name={name} size={44} />}
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text numberOfLines={1} className={`flex-1 text-base ${c.unreadCount ? 'font-bold' : 'font-semibold'} text-ink-900`}>
            {name}
          </Text>
          <Text className="ml-2 text-xs text-ink-400">{timeAgo(c.lastMessage?.at ?? c.updatedAt)}</Text>
        </View>
        <View className="mt-0.5 flex-row items-center">
          <Text numberOfLines={1} className={`flex-1 text-sm ${c.unreadCount ? 'text-ink-800' : 'text-ink-500'}`}>
            {c.blocked ? 'Blocked' : (c.lastMessage?.text ?? 'No messages yet')}
          </Text>
          {c.unreadCount ? (
            <View className="ml-2 min-w-[20px] items-center rounded-full bg-brand-700 px-1.5">
              <Text className="text-xs font-bold text-white">{c.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

