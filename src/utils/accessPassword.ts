export const DEFAULT_ACCESS_PASSWORD = "1234";
const ACCESS_PASSWORD_REGEX = /^[a-z0-9]{4}$/;

export function sanitizeAccessPassword(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
}

export function isValidAccessPassword(value: string): boolean {
  return ACCESS_PASSWORD_REGEX.test(value);
}

export function normalizeStoredAccessPassword(value: unknown): string {
  const sanitized = sanitizeAccessPassword(String(value ?? ""));
  return isValidAccessPassword(sanitized) ? sanitized : DEFAULT_ACCESS_PASSWORD;
}

export function canUnlockWithAccessPassword(input: string, expected: string, master: string): boolean {
  const normalizedInput = sanitizeAccessPassword(input);
  return normalizedInput === expected || normalizedInput === master;
}
