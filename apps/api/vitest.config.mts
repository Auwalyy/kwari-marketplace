import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: true,
    env: {
      NODE_ENV: 'test',
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: path.join(os.tmpdir(), 'kkdm-test-uploads'),
      API_BASE_URL: 'http://localhost:4000',
      IMAGE_EMBEDDING_PROVIDER: 'none',
      PAYMENT_PROVIDER: 'none',
      JOBS_ENABLED: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
