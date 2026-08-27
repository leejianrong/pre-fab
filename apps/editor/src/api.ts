import { ApiClient } from "@prefab/api-client";

// No token, no explicit cookie — the browser's own cookie jar carries the
// session automatically via credentials: "include" (ApiClient's default
// when no token is set). This is the one client in the repo that gets to
// rely on that; the CLI has no such jar and manages the cookie itself.
//
// Empty string, not an absolute URL: requests go to this same origin,
// where vite.config.ts's dev-server proxy forwards /v1/* to the API. See
// that file for why cross-origin cookies are the thing being avoided.
export const api = new ApiClient({ baseUrl: import.meta.env.VITE_PREFAB_API_URL ?? "" });
