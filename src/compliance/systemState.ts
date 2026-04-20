// src/compliance/systemState.ts
// System state type definitions and collectors interface

import type { SystemState } from '../ai/types.js';

// Interface for system state collectors
export interface SystemStateCollector {
  // Unique identifier for this collector
  readonly id: string;
  
  // Platform this collector supports
  readonly platform: SystemState['platform'];
  
  // Collect system state for the given scope
  collect(scope: string): Promise<Partial<SystemState>>;
}

// Registry of available collectors
const collectors = new Map<string, SystemStateCollector>();

export function registerCollector(collector: SystemStateCollector): void {
  collectors.set(collector.id, collector);
}

export function getCollector(id: string): SystemStateCollector | undefined {
  return collectors.get(id);
}

export function getCollectorsByPlatform(platform: SystemState['platform']): SystemStateCollector[] {
  return Array.from(collectors.values()).filter(c => c.platform === platform);
}

// Collect complete system state using registered collectors
export async function collectSystemState(
  platform: SystemState['platform'],
  scope: string,
): Promise<SystemState> {
  const platformCollectors = getCollectorsByPlatform(platform);
  
  if (platformCollectors.length === 0) {
    throw new Error(`No collectors registered for platform: ${platform}`);
  }
  
  const partialStates = await Promise.all(
    platformCollectors.map(c => c.collect(scope))
  );
  
  // Merge partial states
  const merged: SystemState = {
    platform,
    snapshotAt: new Date().toISOString(),
    snapshotVersion: '1.0.0',
  };
  
  for (const partial of partialStates) {
    if (partial.awsS3Buckets) {
      merged.awsS3Buckets = [...(merged.awsS3Buckets ?? []), ...partial.awsS3Buckets];
    }
    if (partial.iamRoles) {
      merged.iamRoles = [...(merged.iamRoles ?? []), ...partial.iamRoles];
    }
    if (partial.linuxHosts) {
      merged.linuxHosts = [...(merged.linuxHosts ?? []), ...partial.linuxHosts];
    }
  }
  
  return merged;
}

// Mock collector for testing
export class MockCollector implements SystemStateCollector {
  readonly id = 'mock';
  readonly platform = 'AWS' as const;
  
  async collect(): Promise<Partial<SystemState>> {
    return {
      awsS3Buckets: [
        {
          bucketName: 'test-bucket',
          region: 'us-east-1',
          publicAccessBlockEnabled: true,
          blockPublicAcls: true,
          blockPublicPolicy: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: true,
          encryptionEnabled: true,
          encryptionAlgorithm: 'AES256',
          versioningEnabled: true,
          mfaDeleteEnabled: false,
          loggingEnabled: true,
        },
      ],
      iamRoles: [
        {
          roleName: 'TestRole',
          arn: 'arn:aws:iam::123456789012:role/TestRole',
          attachedManagedPolicies: [],
          inlinePolicies: [],
          trustPolicy: {},
          hasAdminAccess: false,
        },
      ],
    };
  }
}

// Register mock collector for testing
registerCollector(new MockCollector());
