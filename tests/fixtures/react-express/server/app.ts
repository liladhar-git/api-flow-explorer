import express from 'express';
import usersRouter from './routes/users';
import { ordersRouter } from './routes/orders';
import { requestLogger } from './middleware/logger';
import { requireAuth } from './middleware/auth';

const app = express();
app.use(express.json());
app.use(requestLogger);

app.use('/api/users', usersRouter);
app.use('/api/orders', requireAuth, ordersRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

export default app;
