import express, { Request } from 'express';
import { body } from 'express-validator';
import { z } from 'zod';
import { createItem, type CreateItemInput } from './service';

const app = express();

app.post('/login', (req, res) => {
  const { email, password, remember = false } = req.body;
  res.json({ email, password, remember });
});

app.get('/items', listItems);
function listItems(req: Request, res: any) {
  const page = req.query.page;
  const sort = req.query['sort'];
  res.json({ page, sort, owner: req.body?.owner });
}

app.post('/validated', body('email').isEmail(), body('age').isInt().optional(), body('address.city').isString(), (req, res) => res.end());

const createSchema = z.object({ name: z.string(), age: z.number().optional(), role: z.enum(['a', 'b']), tags: z.array(z.string()) });
function validate(schema: unknown) {
  return (req: any, res: any, next: any) => next();
}
app.post('/zod', validate(createSchema), (req, res) => res.end());

app.put('/typed/:id', (req: Request<{ id: string }, {}, { title: string; done?: boolean }>, res) => {
  res.json(req.body.title);
});

app.post('/via-service', (req, res) => {
  res.json(createItem(req.body));
});

app.post('/api/client-only', (req, res) => res.end());
