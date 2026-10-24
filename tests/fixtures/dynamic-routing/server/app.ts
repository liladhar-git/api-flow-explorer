import express from 'express';
import { a } from './a';
import { b } from './b';

const app = express();
app.use('/api', a);
app.use('/api', b);
export default app;
