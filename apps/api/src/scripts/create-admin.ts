/**
 * Creates the first platform administrator, or promotes an existing account.
 *
 *   npm run admin:create -- --email admin@example.com --name "Platform Admin" --password "S3cure-pass"
 *   npm run admin:create -- --email existing@example.com          (promote existing user)
 */
import { parseArgs } from 'node:util';
import { passwordSchema } from '@kkdm/shared';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { logger } from '../config/logger';
import { User } from '../modules/users/user.model';
import { hashPassword } from '../modules/auth/password';
import { audit } from '../services/audit';

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } } });
  if (!values.email) throw new Error('--email is required');
  const email = values.email.toLowerCase();
  await connectDatabase();
  let user = await User.findOne({ email });
  if (user) {
    if (!user.platformRoles.includes('admin')) user.platformRoles.push('admin');
    await user.save();
    logger.info({ email }, 'Existing user promoted to administrator');
  } else {
    if (!values.name || !values.password) throw new Error('--name and --password are required to create a new account');
    passwordSchema.parse(values.password);
    user = await User.create({ fullName: values.name, email, emailVerified: true, passwordHash: await hashPassword(values.password), platformRoles: ['admin'] });
    logger.info({ email }, 'Administrator created');
  }
  await audit({ actorId: user._id, action: 'admin.bootstrap', category: 'admin', targetType: 'user', targetId: user._id });
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'create-admin failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
