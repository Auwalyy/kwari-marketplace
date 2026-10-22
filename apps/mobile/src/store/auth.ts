import { create } from 'zustand';
import type { AuthResponse, AuthTokens, MeDto } from '@kkdm/shared';
import { api, authHttp, configureApiAuth, toApiError } from '@/lib/api';
import { clearRefreshToken, readRefreshToken, saveRefreshToken } from '@/lib/secureStorage';
import { queryClient } from '@/lib/queryClient';
import { configureSocket, disconnectSocket, reconnectSocket } from '@/lib/socket';

type Status = 'loading' | 'authenticated' | 'guest';

interface AuthState {
  status: Status;
  user: MeDto | null;
  accessToken: string | null;
  bootstrap: () => Promise<void>;
  applyAuth: (res: AuthResponse) => Promise<void>;
  applyTokens: (tokens: AuthTokens) => Promise<void>;
  refreshUser: () => Promise<MeDto | null>;
  refreshTokens: () => Promise<AuthTokens | null>;
  logout: (opts?: { everywhere?: boolean; remote?: boolean }) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  accessToken: null,

  /** Restores a session from the stored refresh token, or continues as a guest. */
  async bootstrap() {
    const tokens = await get().refreshTokens();
    if (!tokens) {
      set({ status: 'guest', user: null, accessToken: null });
      return;
    }
    const user = await get().refreshUser();
    set({ status: user ? 'authenticated' : 'guest' });
  },

  async applyAuth(res) {
    await saveRefreshToken(res.tokens.refreshToken);
    set({ status: 'authenticated', user: res.user, accessToken: res.tokens.accessToken });
    reconnectSocket();
  },

  async applyTokens(tokens) {
    await saveRefreshToken(tokens.refreshToken);
    set({ accessToken: tokens.accessToken });
    reconnectSocket();
  },

  async refreshUser() {
    try {
      const user = await api.get<MeDto>('/users/me');
      set({ user });
      return user;
    } catch {
      return null;
    }
  },

  async refreshTokens() {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await authHttp.post('/auth/refresh', { refreshToken });
      const tokens = res.data.data as AuthTokens;
      await saveRefreshToken(tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      reconnectSocket();
      return tokens;
    } catch (err) {
      const e = toApiError(err);
      // Only drop the session for auth failures, not for network errors while offline.
      if (!e.isNetwork) await clearRefreshToken();
      if (e.isNetwork && get().accessToken) return null;
      return null;
    }
  },

  async logout(opts = {}) {
    const { accessToken } = get();
    if (opts.remote !== false && accessToken) {
      await authHttp
        .post(opts.everywhere ? '/auth/logout-all' : '/auth/logout', {}, { headers: { Authorization: `Bearer ${accessToken}` } })
        .catch(() => undefined);
    }
    await clearRefreshToken();
    disconnectSocket();
    queryClient.clear();
    set({ status: 'guest', user: null, accessToken: null });
  },
}));

configureApiAuth({
  getAccessToken: () => useAuth.getState().accessToken,
  refresh: () => useAuth.getState().refreshTokens(),
  onSessionExpired: () => {
    if (useAuth.getState().status === 'authenticated') void useAuth.getState().logout({ remote: false });
  },
});

export const useUser = () => useAuth((s) => s.user);
export const useIsAuthed = () => useAuth((s) => s.status === 'authenticated');

configureSocket(
  () => useAuth.getState().accessToken,
  () => useAuth.getState().refreshTokens(),
);
