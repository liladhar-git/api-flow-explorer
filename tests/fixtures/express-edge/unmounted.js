import { Router } from 'express';

const r = Router();
r.get('/orphan', orphan);
export default r;

function orphan(req, res) {
  res.end();
}
