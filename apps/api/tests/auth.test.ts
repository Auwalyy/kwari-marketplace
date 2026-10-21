import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { api, auth, lastCode, registerUser, useTestDatabase } from './helpers';
import { User } from '../src/modules/users/user.model';
import { env } from '../src/config/env';

useTestDatabase();

describe('authentication', () => {
  it('registers, returns tokens, and never exposes the password hash', async () => {
    const res = await api().post('/api/v1/auth/register').send({ fullName: 'Amina Bello', email: 'amina@example.com', phone: '0803 123 4567', password: 'Secur3pass' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('amina@example.com');
    expect(res.body.data.user.phone).toBe('+2348031234567');
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const dup = await api().post('/api/v1/auth/register').send({ fullName: 'Other', email: 'amina@example.com', password: 'Secur3pass' });
    expect(dup.status).toBe(409);
  });

  it('rejects weak passwords and missing identifiers', async () => {
    const weak = await api().post('/api/v1/auth/register').send({ fullName: 'X Y', email: 'weak@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    const none = await api().post('/api/v1/auth/register').send({ fullName: 'X Y', password: 'Passw0rdok' });
    expect(none.status).toBe(400);
  });

  it('logs in with email or phone and rejects wrong passwords with a generic error', async () => {
    const u = await registerUser('Login User', { phone: '08091112222' });
    const byEmail = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password });
    expect(byEmail.status).toBe(200);
    const byPhone = await api().post('/api/v1/auth/login').send({ identifier: '+2348091112222', password: u.password });
    expect(byPhone.status).toBe(200);
    const bad = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: 'wrongpass1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await api().post('/api/v1/auth/login').send({ identifier: 'nobody@example.com', password: 'wrongpass1' });
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures', async () => {
    const u = await registerUser();
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/login').send({ identifier: u.email, password: 'wrongpass1' });
    const locked = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password });
    expect(locked.status).toBe(423);
  });

  it('rejects expired and tampered access tokens', async () => {
    const u = await registerUser();
    const claims = jwt.decode(u.token) as jwt.JwtPayload;
    const expired = jwt.sign({ sid: claims.sid, tv: 0, typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_ACCESS_SECRET!, { subject: u.id, issuer: 'kkdm-api' });
    const r1 = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${expired}`);
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe('TOKEN_EXPIRED');
    const forged = jwt.sign({ sid: claims.sid, tv: 0, typ: 'access' }, 'not-the-secret', { subject: u.id, issuer: 'kkdm-api' });
    const r2 = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${forged}`);
    expect(r2.status).toBe(401);
  });

  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const u = await registerUser();
    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(first.status).toBe(200);
    const rotated = first.body.data.refreshToken;
    expect(rotated).not.toBe(u.refreshToken);
    // Reusing the original (already rotated) token is theft detection.
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The whole session is gone, including the newest token and access tokens of that session.
    const after = await api().post('/api/v1/auth/refresh').send({ refreshToken: rotated });
    expect(after.status).toBe(401);
    const me = await api().get('/api/v1/users/me').set('Authorization', `Bearer ${first.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const u = await registerUser();
    expect((await api().post('/api/v1/auth/logout').set(auth(u))).status).toBe(200);
    expect((await api().get('/api/v1/users/me').set(auth(u))).status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
  });

  it('verifies email with a one-time code', async () => {
    const u = await registerUser();
    const code = lastCode(u.email, 'verify_email');
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await api().post('/api/v1/auth/verification/confirm').set(auth(u)).send({ channel: 'email', code: '000000' === code ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await api().post('/api/v1/auth/verification/confirm').set(auth(u)).send({ channel: 'email', code });
    expect(ok.status).toBe(200);
    expect((await User.findById(u.id))!.emailVerified).toBe(true);
  });

  it('resets the password and revokes all existing sessions', async () => {
    const u = await registerUser();
    const forgot = await api().post('/api/v1/auth/password/forgot').send({ identifier: u.email });
    expect(forgot.status).toBe(200);
    const unknown = await api().post('/api/v1/auth/password/forgot').send({ identifier: 'ghost@example.com' });
    expect(unknown.status).toBe(200); // non-revealing
    const code = lastCode(u.email, 'password_reset');
    const reset = await api().post('/api/v1/auth/password/reset').send({ identifier: u.email, code, newPassword: 'N3wPassword' });
    expect(reset.status).toBe(200);
    expect((await api().get('/api/v1/users/me').set(auth(u))).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ identifier: u.email, password: 'N3wPassword' })).status).toBe(200);
    expect((await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password })).status).toBe(401);
  });

  it('blocks non-admins from admin routes and rejects operator injection', async () => {
    const u = await registerUser();
    expect((await api().get('/api/v1/admin/dashboard').set(auth(u))).status).toBe(403);
    expect((await api().post('/api/v1/markets').set(auth(u)).send({ name: 'X market', slug: 'x', region: 'Kano', city: 'Kano' })).status).toBe(403);
    const inj = await api().post('/api/v1/auth/login').send({ identifier: { $gt: '' }, password: 'x' });
    expect(inj.status).toBe(400);
  });

  it('deletes an account, anonymises it and revokes sessions', async () => {
    const u = await registerUser('To Delete');
    const res = await api().delete('/api/v1/users/me').set(auth(u)).send({ password: u.password });
    expect(res.status).toBe(200);
    const doc = await User.findById(u.id).lean();
    expect(doc!.status).toBe('deleted');
    expect(doc!.email).toBeUndefined();
    expect(doc!.fullName).toBe('Deleted user');
    expect((await api().get('/api/v1/users/me').set(auth(u))).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password })).status).toBe(401);
  });
});
