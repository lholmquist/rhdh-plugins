/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createExtensionPoint,
  type BackstageCredentials,
  type BackstageServicePrincipal,
} from '@backstage/backend-plugin-api';
import type { ProviderTokenGrantReference } from '@red-hat-developer-hub/backstage-plugin-orchestrator-common';
import { WorkflowLogProvider } from './api';

/**
 * @public
 */
export interface WorkflowLogsExtensionPoint {
  addWorkflowLogProvider(
    ...workflowLogProviders: Array<WorkflowLogProvider>
  ): void;
}

/**
 * @public
 */
export const workflowLogsExtensionEndpoint =
  createExtensionPoint<WorkflowLogsExtensionPoint>({
    id: 'orchestrator.workflowlogs',
  });

/**
 * Resolves an opaque provider-token grant for a trusted backend caller.
 *
 * Implementations must enforce grant ownership and caller authorization before
 * returning access-token material. Refresh tokens must never be returned.
 *
 * @public
 */
export interface ProviderTokenGrantResolver {
  /** Resolves one grant into a short-lived access token. */
  getAccessToken(options: {
    grantId: string;
    provider: string;
    caller: BackstageCredentials<BackstageServicePrincipal>;
  }): Promise<{
    accessToken: string;
    expiresAt?: Date;
    scopes: string[];
  }>;
}

/**
 * Extension point for the backend that owns provider-token grants.
 *
 * @public
 */
export interface ProviderTokenGrantExtensionPoint {
  /** Registers the resolver used by workflow execution. */
  setProviderTokenGrantResolver(resolver: ProviderTokenGrantResolver): void;
}

/**
 * Registers the provider-token grant resolver used by workflow execution.
 *
 * @public
 */
export const providerTokenGrantExtensionPoint =
  createExtensionPoint<ProviderTokenGrantExtensionPoint>({
    id: 'orchestrator.provider-token-grants',
  });

/**
 * Keeps the grant reference type discoverable from the Orchestrator node
 * package for extension implementations.
 *
 * @public
 */
export type { ProviderTokenGrantReference };
