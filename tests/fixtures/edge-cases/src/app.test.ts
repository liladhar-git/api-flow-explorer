import express from 'express';
const app = express();
app.get('/only-in-tests', (req, res) => res.end());
