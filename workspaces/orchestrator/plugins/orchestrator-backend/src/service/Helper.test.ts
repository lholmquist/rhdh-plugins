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

import fs from 'fs-extra';

import {
  ProcessInstance,
  ProcessInstanceState,
} from '@red-hat-developer-hub/backstage-plugin-orchestrator-common';

import {
  delay,
  executeWithRetry,
  getWorkflowRunStats,
  getWorkingDirectory,
  groupByProcessIdAndVersion,
  retryAsyncFunction,
} from './Helper';

describe('retryAsyncFunction', () => {
  const successfulResponse = 'Success';
  it('should be successful in the first attempt', async () => {
    const asyncFnSuccess = jest.fn().mockResolvedValueOnce(successfulResponse);

    const result = await retryAsyncFunction({
      asyncFn: asyncFnSuccess,
      maxAttempts: 3,
      delayMs: 100,
    });

    expect(result).toBe(successfulResponse);
    expect(asyncFnSuccess).toHaveBeenCalledTimes(1);
  });

  it('should throw an error after maximum attempts', async () => {
    const asyncFnFailure = jest.fn().mockResolvedValue(undefined);

    await expect(
      retryAsyncFunction({
        asyncFn: asyncFnFailure,
        maxAttempts: 5,
        delayMs: 100,
      }),
    ).rejects.toThrow();

    expect(asyncFnFailure).toHaveBeenCalledTimes(5);
  });

  it('should retry until successful after getting some undefined responses', async () => {
    const asyncFns = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(successfulResponse);

    const result = await retryAsyncFunction({
      asyncFn: asyncFns,
      maxAttempts: 5,
      delayMs: 100,
    });

    expect(result).toBe(successfulResponse);
    expect(asyncFns).toHaveBeenCalledTimes(4);
  });
});

describe('getWorkflowRunStats', () => {
  const createProcessInstance = (
    overrides: Partial<ProcessInstance> &
      Pick<ProcessInstance, 'id' | 'processId'>,
  ): ProcessInstance => ({
    endpoint: 'http://example.com',
    nodes: [],
    version: '1.0',
    state: ProcessInstanceState.Completed,
    ...overrides,
  });

  it('calculates averageTimeToComplete from instance start and end times', () => {
    const tenMinutesMs = 10 * 60 * 1000;
    const twentyMinutesMs = 20 * 60 * 1000;

    const result = getWorkflowRunStats({
      'workflow-a-1.0': [
        createProcessInstance({
          id: 'instance-1',
          processId: 'workflow-a',
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-01-01T00:10:00.000Z',
        }),
        createProcessInstance({
          id: 'instance-2',
          processId: 'workflow-a',
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-01-01T00:20:00.000Z',
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].averageTimeToComplete).toBe(
      (tenMinutesMs + twentyMinutesMs) / 2,
    );
  });

  it('treats instances without start or end as zero duration when calculating averageTimeToComplete', () => {
    const tenMinutesMs = 10 * 60 * 1000;

    const result = getWorkflowRunStats({
      'workflow-a-1.0': [
        createProcessInstance({
          id: 'instance-1',
          processId: 'workflow-a',
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-01-01T00:10:00.000Z',
        }),
        createProcessInstance({
          id: 'instance-2',
          processId: 'workflow-a',
          start: '2024-01-01T00:00:00.000Z',
        }),
      ],
    });

    expect(result[0].averageTimeToComplete).toBe(tenMinutesMs / 2);
  });

  it('calculates success and error counts and runsLastMonth', () => {
    const recentStart = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const oldStart = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = getWorkflowRunStats({
      'workflow-a-1.0': [
        createProcessInstance({
          id: '1',
          processId: 'workflow-a',
          state: ProcessInstanceState.Completed,
          start: recentStart,
          end: '2024-01-01T01:00:00.000Z',
        }),
        createProcessInstance({
          id: '2',
          processId: 'workflow-a',
          state: ProcessInstanceState.Error,
          start: oldStart,
        }),
      ],
    });

    expect(result[0].successCount).toBe(1);
    expect(result[0].errorCount).toBe(1);
    expect(result[0].totalCount).toBe(2);
    expect(result[0].successRatio).toBe(0.5);
    expect(result[0].runsLastMonth).toBe(1);
  });
});

describe('groupByProcessIdAndVersion', () => {
  it('groups instances by processId and version', () => {
    const instances: ProcessInstance[] = [
      {
        id: '1',
        processId: 'wf-a',
        version: '1.0',
        endpoint: 'e',
        nodes: [],
      },
      {
        id: '2',
        processId: 'wf-a',
        version: '1.0',
        endpoint: 'e',
        nodes: [],
      },
      {
        id: '3',
        processId: 'wf-b',
        version: '2.0',
        endpoint: 'e',
        nodes: [],
      },
    ];

    const grouped = groupByProcessIdAndVersion(instances);

    expect(grouped['wf-a-1.0']).toHaveLength(2);
    expect(grouped['wf-b-2.0']).toHaveLength(1);
  });
});

describe('getWorkingDirectory', () => {
  it('returns os tmpdir when backend.workingDirectory is not configured', async () => {
    const config = mockServices.rootConfig();
    const logger = mockServices.logger.mock();

    const dir = await getWorkingDirectory(config, logger);

    expect(typeof dir).toBe('string');
    expect(dir.length).toBeGreaterThan(0);
  });

  it('returns configured working directory when it exists and is writable', async () => {
    const workingDirectory = '/tmp/orchestrator-test-wd';
    jest.spyOn(fs, 'access').mockResolvedValue(undefined);
    const config = mockServices.rootConfig({
      data: { backend: { workingDirectory } },
    });
    const logger = mockServices.logger.mock();

    const dir = await getWorkingDirectory(config, logger);

    expect(dir).toBe(workingDirectory);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(workingDirectory),
    );
  });

  it('throws when configured working directory does not exist', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    jest.spyOn(fs, 'access').mockRejectedValue(err);
    const config = mockServices.rootConfig({
      data: { backend: { workingDirectory: '/missing/path' } },
    });
    const logger = mockServices.logger.mock();

    await expect(getWorkingDirectory(config, logger)).rejects.toThrow('ENOENT');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('does not exist'),
    );
  });

  it('throws when configured working directory is not writable', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    jest.spyOn(fs, 'access').mockRejectedValue(err);
    const config = mockServices.rootConfig({
      data: { backend: { workingDirectory: '/readonly/path' } },
    });
    const logger = mockServices.logger.mock();

    await expect(getWorkingDirectory(config, logger)).rejects.toThrow('EACCES');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('is not writable'),
    );
  });
});

describe('executeWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns response when action succeeds', async () => {
    const response = { status: 200 } as Response;
    const action = jest.fn().mockResolvedValue(response);

    const resultPromise = executeWithRetry(action, 3);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(response);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('retries on HTTP error responses until success', async () => {
    const action = jest
      .fn()
      .mockResolvedValueOnce({ status: 500 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);

    const resultPromise = executeWithRetry(action, 3);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe(200);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('throws after exceeding max errors', async () => {
    const action = jest.fn().mockRejectedValue(new Error('network'));

    const resultPromise = executeWithRetry(action, 2);
    await Promise.all([
      jest.runAllTimersAsync(),
      expect(resultPromise).rejects.toThrow('Unable to execute query.'),
    ]);
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe('delay', () => {
  it('resolves after the specified time', async () => {
    jest.useFakeTimers();
    const promise = delay(1000);
    jest.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
