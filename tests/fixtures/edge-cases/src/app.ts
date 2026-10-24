import express from 'express';
import missing from './does-not-exist';
import { nope } from '@lib/absent';

const app = express();

// app.get('/commented', handler);
const text = "app.get('/in-string', handler)";
/* app.post('/block-comment', handler) */

app.get('/real', (req, res) => {
  res.end(String(nope) + text);
});

app.use('/m', missing);

export async function lazy(name: string) {
  return import(name);
}
export async function lazyLiteral() {
  return import('./other');
}
