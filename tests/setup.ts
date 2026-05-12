// tests/setup.ts
// Load test environment variables before any test runs
import { config } from 'dotenv';

// Load .env.test first, then fall back to .env
config({ path: '.env.test' });
config(); // .env as fallback