/**
 * Deterministic IDs. Inputs are workspace-relative paths and stable symbol identities only;
 * absolute paths never appear in IDs.
 */
export const symId = (path: string, qualified: string): string => `sym:${path}#${qualified}`;
export const routerId = (path: string, name: string): string => `route:${path}#${name}`;
export const endpointId = (method: string, fullPath: string, file: string, line: number): string => `endpoint:${method} ${fullPath}@${file}:${line}`;
export const requestId = (file: string, line: number, column: number): string => `request:${file}:${line}:${column}`;
export const modelId = (name: string): string => `model:${name}`;
export const databaseId = (name: string): string => `database:${name}`;
export const queueId = (name: string): string => `queue:${name}`;
export const externalId = (host: string): string => `external:${host}`;
export const unknownId = (text: string): string => `unknown:${text}`;
export const edgeId = (kind: string, source: string, target: string): string => `${kind}|${source}|${target}`;
