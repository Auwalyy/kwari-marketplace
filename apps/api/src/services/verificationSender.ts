import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { serviceUnavailable } from '../utils/http';

/**
 * Delivers one-time codes. `console` providers (development only) print the code to the server log;
 * production requires SMTP for email and Termii for SMS (enforced by assertRuntimeConfig).
 */

/** Codes sent during tests are captured here so tests can complete verification flows. */
export const testOutbox: { channel: 'email' | 'phone'; to: string; code: string; purpose: string }[] = [];

let transporter: Transporter | null = null;
function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

const purposeText: Record<string, string> = {
  verify_email: 'verify your email address',
  verify_phone: 'verify your phone number',
  password_reset: 'reset your password',
};

export async function sendCode(channel: 'email' | 'phone', to: string, code: string, purpose: string): Promise<void> {
  const text = `Your Kantin Kwari Digital Market code to ${purposeText[purpose] ?? purpose} is ${code}. It expires in 10 minutes. Do not share it with anyone.`;
  if (isTest) {
    testOutbox.push({ channel, to, code, purpose });
    return;
  }
  if (channel === 'email') {
    switch (env.VERIFICATION_EMAIL_PROVIDER) {
      case 'smtp':
        await smtp().sendMail({ from: env.SMTP_FROM, to, subject: 'Your Kantin Kwari verification code', text });
        return;
      case 'console':
        logger.warn({ to, purpose, devCode: code }, 'DEV ONLY: verification email not sent; code printed to log');
        return;
      default:
        throw serviceUnavailable('Email verification is not configured', 'EMAIL_NOT_CONFIGURED');
    }
  }
  switch (env.VERIFICATION_SMS_PROVIDER) {
    case 'termii': {
      const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: env.TERMII_API_KEY, to: to.replace('+', ''), from: env.TERMII_SENDER_ID, sms: text, type: 'plain', channel: 'dnd' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.error({ status: res.status }, 'Termii SMS send failed');
        throw serviceUnavailable('We could not send the SMS. Please try again shortly.', 'SMS_FAILED');
      }
      return;
    }
    case 'console':
      logger.warn({ to, purpose, devCode: code }, 'DEV ONLY: verification SMS not sent; code printed to log');
      return;
    default:
      throw serviceUnavailable('SMS verification is not configured', 'SMS_NOT_CONFIGURED');
  }
}
