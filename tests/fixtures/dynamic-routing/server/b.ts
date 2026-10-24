import { Router } from 'express';
export const b = Router();
b.get('/items', (req, res) => res.json(['b']));
