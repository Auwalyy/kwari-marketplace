import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { UserDto } from '@kkdm/shared';
import { Avatar, Badge, Card, Chip, PaginatedList, Screen } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';

export default function AdminUsers() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [role, setRole] = useState<string | undefined>();
  const params = { q: q || undefined, status, role };
  return (
    <Screen title="Users" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Name, email or phone" />
        <View className="mt-2 flex-row flex-wrap">
          <Chip label="Suspended" selected={status === 'suspended'} onPress={() => setStatus(status === 'suspended' ? undefined : 'suspended')} />
          <Chip label="Admins" selected={role === 'admin'} onPress={() => setRole(role === 'admin' ? undefined : 'admin')} />
          <Chip label="Market managers" selected={role === 'market_manager'} onPress={() => setRole(role === 'market_manager' ? undefined : 'market_manager')} />
        </View>
      </View>
      <PaginatedList<UserDto>
        queryKey={['admin', 'users', params]}
        fetchPage={(page) => api.page<UserDto>('/admin/users', { ...params, page })}
        keyOf={(u) => u.id}
        renderItem={(u) => (
          <Card className="mb-2 flex-row items-center" onPress={() => router.push(`/admin/user/${u.id}`)}>
            <Avatar name={u.fullName} />
            <View className="ml-3 flex-1">
              <Text className="font-semibold text-ink-900">{u.fullName}</Text>
              <Text className="text-xs text-ink-500">{u.email ?? u.phone}</Text>
            </View>
            {u.status !== 'active' ? <Badge label={u.status} tone="danger" /> : u.platformRoles.length ? <Badge label={u.platformRoles.join(', ')} tone="info" /> : null}
          </Card>
        )}
        empty={{ title: 'No users found' }}
      />
    </Screen>
  );
}
