import axios from 'axios';

export const createClientOnly = (name: string) => axios.post('/api/client-only', { name, count: 3, nested: { a: 1 }, active: true }, { params: { dryRun: true } });
