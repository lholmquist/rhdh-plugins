## API Report File for "@red-hat-developer-hub/backstage-plugin-qe-theme"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

import { BackstagePlugin } from '@backstage/core-plugin-api';
import { default as DarkIcon } from '@material-ui/icons/Brightness2';
import { JSX as JSX_2 } from 'react/jsx-runtime';
import { default as LightIcon } from '@material-ui/icons/WbSunny';
import { ReactNode } from 'react';

export { DarkIcon }

// @public (undocumented)
export const darkThemeProvider: ({ children }: {
    children: ReactNode;
}) => JSX_2.Element;

export { LightIcon }

// @public (undocumented)
export const lightThemeProvider: ({ children }: {
    children: ReactNode;
}) => JSX_2.Element;

// @public (undocumented)
const qeThemePlugin: BackstagePlugin<    {}, {}, {}>;
export default qeThemePlugin;

// (No @packageDocumentation comment for this package)

```
