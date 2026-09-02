/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export interface Config {
  secureTokenStorage?: {
    /** Enables the secure token storage broker. Defaults to false. */
    enabled?: boolean;
  };
}
