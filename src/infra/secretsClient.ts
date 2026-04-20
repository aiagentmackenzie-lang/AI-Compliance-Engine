// src/infra/secretsClient.ts
// Abstraction over HashiCorp Vault, AWS Secrets Manager, or GCP Secret Manager.
// Implements caching with TTL to reduce latency on hot paths.

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

  constructor(vaultAddr?: string, vaultToken?: string, ttlMs = CACHE_TTL_MS) {
    this.vaultAddr = vaultAddr ?? process.env.VAULT_ADDR ?? 'http://localhost:8200';
    this.vaultToken = vaultToken ?? process.env.VAULT_TOKEN ?? '';
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

  constructor(_region?: string, ttlMs = CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  async get(secretName: string): Promise<string> {
    const cached = this.cache.get(secretName);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // AWS SDK would be imported here
    // For now, this is a placeholder that falls back to env vars
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

// Environment-based client (development fallback)
class EnvSecretsClient implements SecretsClient {
  async get(secretName: string): Promise<string> {
    const value = process.env[secretName];
    
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

// Factory to create appropriate client based on environment
function createSecretsClient(): SecretsClient {
  const provider = process.env.SECRETS_PROVIDER ?? 'env';
  
  switch (provider) {
    case 'vault':
      return new VaultSecretsClient();
    case 'aws':
      return new AwsSecretsClient();
    case 'env':
    default:
      return new EnvSecretsClient();
  }
}

// Singleton instance
export const secretsClient = createSecretsClient();
