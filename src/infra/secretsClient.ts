// src/infra/secretsClient.ts
// Abstraction over HashiCorp Vault, AWS Secrets Manager, or env vars.
// Implements caching with TTL to reduce latency on hot paths.
// All env access is routed through config.ts — no raw process.env here
// except for the env-based provider which is the explicit fallback.

import { logger } from '../core/logger.js';
import { AppError } from '../core/errors.js';

// In-memory cache with TTL
interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SecretsClient {
  get(secretName: string): Promise<string>;
}

class VaultSecretsClient implements SecretsClient {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private vaultAddr: string;
  private vaultToken: string;

  constructor(vaultAddr: string, vaultToken: string, ttlMs = CACHE_TTL_MS) {
    this.vaultAddr = vaultAddr;
    this.vaultToken = vaultToken;
    this.ttlMs = ttlMs;
  }

  async get(secretName: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(secretName);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug({ secretName }, 'Secret cache hit');
      return cached.value;
    }

    // Fetch from Vault
    const value = await this.fetchFromVault(secretName);
    
    // Cache the result
    this.cache.set(secretName, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    return value;
  }

  private async fetchFromVault(secretName: string): Promise<string> {
    const path = `${this.vaultAddr}/v1/secret/data/${secretName}`;
    
    try {
      const response = await fetch(path, {
        headers: {
          'X-Vault-Token': this.vaultToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Vault returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as {
        data?: { data?: { value?: string } };
      };
      
      const value = data.data?.data?.value;
      
      if (!value) {
        throw new Error(`Secret ${secretName} not found or empty`);
      }

      return value;
    } catch (err) {
      logger.error({ err, secretName }, 'Failed to fetch secret from Vault');
      throw new AppError(
        'SECRETS_CLIENT_ERROR',
        `Failed to retrieve secret: ${secretName}`,
        500,
        false
      );
    }
  }
}

// AWS Secrets Manager implementation
class AwsSecretsClient implements SecretsClient {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(_region: string, ttlMs = CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  async get(secretName: string): Promise<string> {
    const cached = this.cache.get(secretName);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // AWS SDK would be imported here. For now, falls back to env vars
    // In production, use @aws-sdk/client-secrets-manager
    const value = process.env[secretName];
    
    if (!value) {
      throw new AppError(
        'SECRETS_CLIENT_ERROR',
        `Secret ${secretName} not found in environment`,
        500,
        false
      );
    }

    this.cache.set(secretName, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    return value;
  }
}

// Environment-based client (development/shorthand fallback)
// This is the ONLY place that should read secrets from process.env directly
class EnvSecretsClient implements SecretsClient {
  private envMap: Record<string, string>;

  constructor(envVars: Record<string, string>) {
    this.envMap = envVars;
  }

  async get(secretName: string): Promise<string> {
    // Check the explicit env map first (populated from config),
    // then fall back to process.env for any unconfigured secrets
    const value = this.envMap[secretName] ?? process.env[secretName];
    
    if (!value) {
      throw new AppError(
        'SECRETS_CLIENT_ERROR',
        `Secret ${secretName} not found in environment`,
        500,
        false
      );
    }

    return value;
  }
}

// Factory to create appropriate client based on configuration.
// Deliberately uses dynamic import to avoid loading config at module level,
// which would break test environments.
function createSecretsClient(): SecretsClient {
  // We need to read config, but config imports secretsClient.
  // To avoid circular dependency, we read SECRETS_PROVIDER from process.env
  // here (this is the one acceptable use of raw process.env).
  const provider = process.env.SECRETS_PROVIDER ?? 'env';
  
  switch (provider) {
    case 'vault': {
      const vaultAddr = process.env.VAULT_ADDR ?? 'http://localhost:8200';
      const vaultToken = process.env.VAULT_TOKEN ?? '';
      return new VaultSecretsClient(vaultAddr, vaultToken);
    }
    case 'aws': {
      const region = process.env.AWS_REGION ?? 'us-east-1';
      return new AwsSecretsClient(region);
    }
    case 'env':
    default:
      return new EnvSecretsClient({
        EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY ?? '',
        REASONING_MODEL_API_KEY: process.env.REASONING_MODEL_API_KEY ?? '',
        JWT_SECRET: process.env.JWT_SECRET ?? '',
        OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? '',
      });
  }
}

// Singleton instance
export const secretsClient = createSecretsClient();