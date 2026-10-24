import { Router } from 'express';
import { listUsers, getUser, createUser } from '../controllers/userController';
import { requireAuth } from '../middleware/auth';
import * as userService from '../services/userService';

const router = Router();

router.get('/', listUsers);
router.get('/:id', getUser);
router.post('/', requireAuth, createUser);
router.route('/:id/avatar').put(requireAuth, async (req, res) => {
  await userService.setAvatar(req.params.id, req.body.url);
  res.sendStatus(204);
});

export default router;
