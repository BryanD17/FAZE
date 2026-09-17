import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests assert behaviour, not log output; pino noise would bury failures.
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    include: ['tests/**/*.test.ts'],
    // Integration tests talk to a real MySQL; they must not race each other.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
