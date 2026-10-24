import express from 'express';
const app = express();
app.get('/health', (req, res) => res.end());
app.get('/video-assets', (req, res) => res.end());
app.get('/video-assets/stats', (req, res) => res.end());
app.get('/video-assets/:id', (req, res) => res.end());
app.get('/api/internal/comments/:id', (req, res) => res.end());
