import { api } from './client';

export const fetchUsers = () => api.get('/users');
export const fetchUser = (id: string) => api.get(`/users/${id}`);
export const createUser = (data: unknown) => api.post('/users', data);
