import crypto from 'node:crypto';

/** Unambiguous alphabet (no 0/O, 1/I/L) for human-entered codes. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length = 10, alphabet = CODE_ALPHABET): string {
  const out: string[] = [];
  // Rejection sampling avoids modulo bias.
  const max = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const b of bytes) {
      if (b < max && out.length < length) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

export function randomDigits(length = 6): string {
  return randomCode(length, '0123456789');
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Keyed hash for lookup of secrets such as invitation codes and refresh tokens. */
export function hashSecret(value: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(value).digest('hex');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Groups a code for display: ABCD-EFGH-JK */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function codePreview(code: string): string {
  return `${code.slice(0, 2)}••••${code.slice(-2)}`;
}
