import { get, ping } from './http';
export const items = () => get('/api/items');
export const other = () => ping('/api/other');
