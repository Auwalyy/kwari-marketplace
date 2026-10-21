import type { PlatformRole } from '@kkdm/shared';

export interface AuthContext {
  userId: string;
  sessionId: string;
  fullName: string;
  platformRoles: PlatformRole[];
  managedMarketIds: string[];
  managedSectionIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
      /** Raw body bytes, captured only for payment webhooks (signature verification). */
      rawBody?: Buffer;
    }
  }
}

export {};
