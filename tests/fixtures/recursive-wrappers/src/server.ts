import express from 'express';
const app = express();
app.get('/api/items', (req, res) => res.end());
app.get('/api/other', (req, res) => res.end());
