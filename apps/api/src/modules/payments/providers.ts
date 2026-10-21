import crypto from 'node:crypto';
import { env } from '../../config/env';
import { timingSafeEqualStr } from '../../utils/crypto';

export interface InitializeInput {
  reference: string;
  amountKobo: number;
  email: string;
  callbackUrl?: string;
  metadata: Record<string, string>;
}

export interface VerifyResult {
  status: 'success' | 'failed' | 'pending' | 'abandoned';
  amountKobo: number;
  currency: string;
  transactionId?: string;
  paidAt?: Date;
  channel?: string;
  rawStatus: string;
}

export interface WebhookEvent {
  /** Unique per provider event; used for idempotent processing. */
  eventKey: string;
  type: string;
  reference?: string;
  kind: 'charge' | 'refund' | 'other';
}

/**
 * Payment provider abstraction. The order system depends only on this interface, so Paystack,
 * Flutterwave or another gateway can be configured without touching checkout or orders.
 */
export interface PaymentProvider {
  readonly name: string;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string; accessCode?: string }>;
  verify(reference: string): Promise<VerifyResult>;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: any): WebhookEvent;
  refund(input: { reference: string; transactionId?: string; amountKobo: number }): Promise<{ refundId: string; status: 'pending' | 'processing' | 'completed' | 'failed' }>;
}

export class PaymentProviderError extends Error {}

async function call(url: string, init: RequestInit & { secret: string }) {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${init.secret}`, 'content-type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PaymentProviderError(`Payment provider unreachable: ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new PaymentProviderError(json?.message ?? `Payment provider HTTP ${res.status}`);
  return json;
}

class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly base = 'https://api.paystack.co';
  constructor(private readonly secret: string) {}

  async initialize(input: InitializeInput) {
    const json = await call(`${this.base}/transaction/initialize`, {
      method: 'POST',
      secret: this.secret,
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo, // Paystack amounts are in kobo
        currency: 'NGN',
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: json.data.authorization_url as string, accessCode: json.data.access_code as string };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const json = await call(`${this.base}/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET', secret: this.secret });
    const d = json.data ?? {};
    const status = d.status === 'success' ? 'success' : d.status === 'failed' ? 'failed' : d.status === 'abandoned' ? 'abandoned' : 'pending';
    return { status, amountKobo: Number(d.amount ?? 0), currency: d.currency ?? 'NGN', transactionId: d.id ? String(d.id) : undefined, paidAt: d.paid_at ? new Date(d.paid_at) : undefined, channel: d.channel, rawStatus: String(d.status) };
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = headers['x-paystack-signature'];
    if (typeof sig !== 'string') return false;
    const expected = crypto.createHmac('sha512', this.secret).update(rawBody).digest('hex');
    return timingSafeEqualStr(expected, sig);
  }

  parseWebhook(body: any): WebhookEvent {
    const type = String(body?.event ?? 'unknown');
    const data = body?.data ?? {};
    const reference = data.reference ?? data.transaction_reference ?? data.transaction?.reference;
    const kind = type.startsWith('charge.') ? 'charge' : type.startsWith('refund.') ? 'refund' : 'other';
    return { eventKey: `${type}:${data.id ?? reference}:${data.status ?? ''}`, type, reference, kind };
  }

  async refund(input: { reference: string; amountKobo: number }) {
    const json = await call(`${this.base}/refund`, { method: 'POST', secret: this.secret, body: JSON.stringify({ transaction: input.reference, amount: input.amountKobo }) });
    const status = json.data?.status === 'processed' ? 'completed' : 'processing';
    return { refundId: String(json.data?.id ?? ''), status: status as 'completed' | 'processing' };
  }
}

class FlutterwaveProvider implements PaymentProvider {
  readonly name = 'flutterwave';
  private readonly base = 'https://api.flutterwave.com/v3';
  constructor(private readonly secret: string, private readonly webhookHash: string) {}

  async initialize(input: InitializeInput) {
    const json = await call(`${this.base}/payments`, {
      method: 'POST',
      secret: this.secret,
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: (input.amountKobo / 100).toFixed(2), // Flutterwave amounts are in naira
        currency: 'NGN',
        redirect_url: input.callbackUrl,
        customer: { email: input.email },
        meta: input.metadata,
      }),
    });
    return { authorizationUrl: json.data.link as string };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const json = await call(`${this.base}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { method: 'GET', secret: this.secret });
    const d = json.data ?? {};
    const status = d.status === 'successful' ? 'success' : d.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      amountKobo: Math.round(Number(d.amount ?? 0) * 100),
      currency: d.currency ?? 'NGN',
      transactionId: d.id ? String(d.id) : undefined,
      paidAt: d.created_at ? new Date(d.created_at) : undefined,
      channel: d.payment_type,
      rawStatus: String(d.status),
    };
  }

  verifyWebhookSignature(_raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = headers['verif-hash'];
    return typeof sig === 'string' && timingSafeEqualStr(sig, this.webhookHash);
  }

  parseWebhook(body: any): WebhookEvent {
    const type = String(body?.event ?? body?.['event.type'] ?? 'unknown');
    const data = body?.data ?? {};
    const kind = type.startsWith('charge.') ? 'charge' : type.includes('refund') ? 'refund' : 'other';
    return { eventKey: `${type}:${data.id ?? data.tx_ref}:${data.status ?? ''}`, type, reference: data.tx_ref, kind };
  }

  async refund(input: { transactionId?: string; amountKobo: number }) {
    if (!input.transactionId) throw new PaymentProviderError('Missing transaction id for refund');
    const json = await call(`${this.base}/transactions/${input.transactionId}/refund`, { method: 'POST', secret: this.secret, body: JSON.stringify({ amount: (input.amountKobo / 100).toFixed(2) }) });
    return { refundId: String(json.data?.id ?? ''), status: (json.data?.status === 'completed' ? 'completed' : 'processing') as 'completed' | 'processing' };
  }
}

let instance: PaymentProvider | null | undefined;

/** The configured provider, or null when online payment is not configured (never simulated). */
export function paymentProvider(): PaymentProvider | null {
  if (instance !== undefined) return instance;
  if (env.PAYMENT_PROVIDER === 'paystack' && env.PAYSTACK_SECRET_KEY) instance = new PaystackProvider(env.PAYSTACK_SECRET_KEY);
  else if (env.PAYMENT_PROVIDER === 'flutterwave' && env.FLUTTERWAVE_SECRET_KEY && env.PAYMENT_WEBHOOK_SECRET) {
    instance = new FlutterwaveProvider(env.FLUTTERWAVE_SECRET_KEY, env.PAYMENT_WEBHOOK_SECRET);
  } else instance = null;
  return instance;
}

/** Test hook for injecting a mock provider. */
export function setPaymentProvider(p: PaymentProvider | null | undefined) {
  instance = p;
}
