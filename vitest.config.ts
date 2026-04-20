import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      EMBEDDING_API_KEY: 'test-embedding-key-for-testing-only',
      REASONING_MODEL_API_KEY: 'test-reasoning-key-for-testing-only',
      JWT_SECRET: 'this-is-a-test-jwt-secret-that-is-exactly-32-chars!',
      OIDC_ISSUER_URL: 'https://test-issuer.example.com',
      OIDC_CLIENT_ID: 'test-client-id',
      OIDC_CLIENT_SECRET: 'test-client-secret-for-testing-only',
    },
  },
});
