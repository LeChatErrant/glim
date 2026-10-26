// API routes read their secrets from the server environment (EAS Hosting).
declare const process: { env: Record<string, string | undefined> };
