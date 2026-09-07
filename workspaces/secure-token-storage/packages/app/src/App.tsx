/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import orchestratorPlugin, {
  orchestratorTranslationsModule,
} from '@red-hat-developer-hub/backstage-plugin-orchestrator';
import orchestratorFormWidgetsPlugin from '@red-hat-developer-hub/backstage-plugin-orchestrator-form-widgets';
import { rhdhThemeModule } from '@red-hat-developer-hub/backstage-plugin-theme/alpha';

export default createApp({
  features: [
    rhdhThemeModule,
    catalogPlugin,
    userSettingsPlugin,
    orchestratorPlugin,
    orchestratorTranslationsModule,
    orchestratorFormWidgetsPlugin,
  ],
});
