import axios from 'axios';

const client = axios.create({ baseURL: process.env.API_BASE_URL });
const fallback = process.env.API_ORIGIN ?? 'http://localhost:4000';

export const ambiguous = () => fetch('/api/items');
export const specific = () => fetch('/api/users/me');
export const dynamicSeg = (id: string) => fetch(`/api/users/${id}`);
export const partial = (name: string) => fetch(`/api/files/${name}.json`);
export const unknownMethod = (m: string) => fetch('/api/things', { method: m });
export const holeVsLiteral = (id: string) => fetch(`/api/only-me/${id}`);
export const viaFallback = () => fetch(`${fallback}/api/things`, { method: 'POST' });
export const viaClient = () => client.get('/api/items');
export const wrongMethod = () => fetch('/api/things');
