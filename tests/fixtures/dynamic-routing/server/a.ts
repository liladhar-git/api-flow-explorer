import { Router } from 'express';
export const a = Router();
a.get('/items', (req, res) => res.json(['a']));
a.get('/users/me', (req, res) => res.json({}));
a.get('/users/:id', (req, res) => res.json({}));
a.get('/files/:name', (req, res) => res.end());
a.get('/only-me/me', (req, res) => res.end());
a.post('/things', (req, res) => res.end());
