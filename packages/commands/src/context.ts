import { ApiClient } from "@prefab/api-client";

export interface CommandContext {
  api: ApiClient;
}

export interface CreateContextOptions {
  apiUrl: string;
  token?: string;
  cookie?: string;
}

export function createContext(options: CreateContextOptions): CommandContext {
  return { api: new ApiClient({ baseUrl: options.apiUrl, token: options.token, cookie: options.cookie }) };
}
