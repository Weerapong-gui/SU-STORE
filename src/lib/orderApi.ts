// Base URL of the Python order-api, for server-side code only (no trailing slash).
// Empty when the env var is missing, e.g. in a build without a backend.
export const ORDER_API_BASE = (process.env.ORDER_API_BASE_URL ?? "").replace(/\/$/, "");
