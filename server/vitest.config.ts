import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests assert behaviour, not log output; pino noise would bury failures.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Hermetic: tests never depend on whatever secret a developer's .env holds.
      JWT_ACCESS_SECRET: 'test-only-access-secret-0123456789abcdef0123456789',
      ALLOW_UNVERIFIED_LOGIN: 'false',
    },
    include: ['tests/**/*.test.ts'],
    // Integration tests talk to a real MySQL; they must not race each other.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
