import { AxiosError, create as createAxios, type AxiosRequestConfig } from 'axios';
import type { ApiErrorBody, AuthTokens, PageMeta } from '@kkdm/shared';
import { API_V1 } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
  get isNetwork() {
    return this.code === 'NETWORK_ERROR';
  }
}

/**
 * Token handling is injected by the auth store to avoid a circular import. The access token lives only
 * in memory; the refresh token in SecureStore.
 */
interface TokenHooks {
  getAccessToken: () => string | null;
  refresh: () => Promise<AuthTokens | null>;
  onSessionExpired: () => void;
}
let hooks: TokenHooks = { getAccessToken: () => null, refresh: async () => null, onSessionExpired: () => undefined };
export function configureApiAuth(h: TokenHooks) {
  hooks = h;
}

export const http = createAxios({ baseURL: API_V1, timeout: 30_000 });

http.interceptors.request.use((config) => {
  const token = hooks.getAccessToken();
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Single-flight refresh: concurrent 401s share one refresh request. */
let refreshing: Promise<AuthTokens | null> | null = null;

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    const expired = error.response?.status === 401 && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN');
    if (expired && original && !original._retried && !original.url?.includes('/auth/')) {
      original._retried = true;
      refreshing ??= hooks.refresh().finally(() => {
        refreshing = null;
      });
      const tokens = await refreshing;
      if (tokens) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${tokens.accessToken}` };
        return http.request(original);
      }
      hooks.onSessionExpired();
    } else if (error.response?.status === 401 && ['SESSION_ENDED', 'TOKEN_REVOKED', 'ACCOUNT_INACTIVE'].includes(code ?? '')) {
      hooks.onSessionExpired();
    }
    throw toApiError(error);
  },
);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const ax = error as AxiosError<ApiErrorBody>;
  if (ax?.isAxiosError) {
    const body = ax.response?.data?.error;
    if (body) return new ApiError(body.message, body.code, ax.response!.status, body.details);
    if (!ax.response) return new ApiError('No connection. Check your internet and try again.', 'NETWORK_ERROR', 0);
    return new ApiError('Something went wrong. Please try again.', 'HTTP_ERROR', ax.response.status);
  }
  return new ApiError((error as Error)?.message ?? 'Unexpected error', 'UNKNOWN', 0);
}

export interface Page<T> {
  items: T[];
  meta: PageMeta & Record<string, unknown>;
}

type Params = Record<string, string | number | boolean | undefined | null>;
const clean = (p?: Params) => (p ? Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined);

export const api = {
  async get<T>(url: string, params?: Params): Promise<T> {
    return (await http.get(url, { params: clean(params) })).data.data as T;
  },
  async page<T>(url: string, params?: Params): Promise<Page<T>> {
    const body = (await http.get(url, { params: clean(params) })).data;
    return { items: body.data as T[], meta: body.meta };
  },
  async post<T>(url: string, body?: unknown, params?: Params): Promise<T> {
    return (await http.post(url, body ?? {}, { params: clean(params) })).data.data as T;
  },
  async patch<T>(url: string, body?: unknown): Promise<T> {
    return (await http.patch(url, body ?? {})).data.data as T;
  },
  async put<T>(url: string, body?: unknown): Promise<T> {
    return (await http.put(url, body ?? {})).data.data as T;
  },
  async del<T>(url: string, body?: unknown, params?: Params): Promise<T> {
    return (await http.delete(url, { data: body, params: clean(params) })).data.data as T;
  },
  /** Multipart upload of local images (uris from the image picker). */
  async upload<T>(url: string, files: { field: string; uri: string; name?: string; type?: string }[], fields: Record<string, string> = {}, params?: Params): Promise<T> {
    const form = new FormData();
    for (const f of files) {
      if (f.uri.startsWith('blob:') || f.uri.startsWith('data:')) {
        // Web preview: convert to a Blob.
        const blob = await (await fetch(f.uri)).blob();
        form.append(f.field, blob, f.name ?? 'image.jpg');
      } else {
        form.append(f.field, { uri: f.uri, name: f.name ?? 'image.jpg', type: f.type ?? 'image/jpeg' } as unknown as Blob);
      }
    }
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await http.post(url, form, { params: clean(params), headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
    return res.data.data as T;
  },
};

/** Raw axios auth calls that must not trigger the refresh interceptor loop. */
export const authHttp = createAxios({ baseURL: API_V1, timeout: 20_000 });
