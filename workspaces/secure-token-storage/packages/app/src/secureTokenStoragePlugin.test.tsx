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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { secureTokenStoragePlugin } from './secureTokenStoragePlugin';

describe('secure-token-storage frontend plugin', () => {
  it('registers the secure-token-storage page extension', () => {
    expect(
      secureTokenStoragePlugin.getExtension('page:secure-token-storage'),
    ).toBeDefined();
  });

  it('declares an icon so the page is discoverable in app navigation', () => {
    const source = readFileSync(
      resolve(__dirname, 'secureTokenStoragePlugin.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /PageBlueprint\.make\(\{[\s\S]*?title:\s*'Provider connections'[\s\S]*?icon:\s*<VpnKeyIcon\s+fontSize="inherit"\s*\/>/,
    );
  });
});
