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

import { mockServices } from '@backstage/backend-test-utils';

import express from 'express';

import { WorkflowLogsProvidersRegistry } from '../providers/WorkflowLogsProvidersRegistry';
import { DevModeService } from '../service/DevModeService';
import { createBackendRouter } from '../service/router';
import { createRouter } from './index';

jest.mock('../service/DevModeService');
jest.mock('../service/router', () => ({
  createBackendRouter: jest.fn(),
}));

describe('createRouter', () => {
  const mockRouter = express.Router();
  const logger = mockServices.logger.mock();
  const baseArgs = {
    config: mockServices.rootConfig({
      data: {
        orchestrator: {
          dataIndexService: { url: 'http://data-index' },
        },
      },
    }),
    logger,
    auditor: mockServices.auditor.mock(),
    discovery: mockServices.discovery.mock(),
    urlReader: mockServices.urlReader.mock(),
    scheduler: mockServices.scheduler.mock(),
    permissions: mockServices.permissions.mock(),
    httpAuth: mockServices.httpAuth.mock(),
    userInfo: mockServices.userInfo.mock(),
    workflowLogsProvidersRegistry: new WorkflowLogsProvidersRegistry(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createBackendRouter as jest.Mock).mockResolvedValue(mockRouter);
  });

  it('delegates to createBackendRouter when autoStart is disabled', async () => {
    const router = await createRouter(baseArgs);

    expect(DevModeService).not.toHaveBeenCalled();
    expect(createBackendRouter).toHaveBeenCalledWith(baseArgs);
    expect(router).toBe(mockRouter);
  });

  it('launches dev mode when autoStart is enabled and SonataFlow is up', async () => {
    const launchDevMode = jest.fn().mockResolvedValue(true);
    (DevModeService as jest.Mock).mockImplementation(() => ({
      launchDevMode,
    }));

    const args = {
      ...baseArgs,
      config: mockServices.rootConfig({
        data: {
          orchestrator: {
            dataIndexService: { url: 'http://data-index' },
            sonataFlowService: { autoStart: true },
          },
        },
      }),
    };

    await createRouter(args);

    expect(DevModeService).toHaveBeenCalledWith(args.config, logger);
    expect(launchDevMode).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(createBackendRouter).toHaveBeenCalledWith(args);
  });

  it('logs error when autoStart is enabled but SonataFlow fails to start', async () => {
    const launchDevMode = jest.fn().mockResolvedValue(false);
    (DevModeService as jest.Mock).mockImplementation(() => ({
      launchDevMode,
    }));

    const args = {
      ...baseArgs,
      config: mockServices.rootConfig({
        data: {
          orchestrator: {
            dataIndexService: { url: 'http://data-index' },
            sonataFlowService: { autoStart: true },
          },
        },
      }),
    };

    await createRouter(args);

    expect(logger.error).toHaveBeenCalledWith(
      'SonataFlow is not up. Check your configuration.',
    );
  });
});
