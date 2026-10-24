import express from 'express';
import { USERS_PATH } from '@acme/shared/endpoints';
import { listUsers } from '@/users';

const app = express();
app.get(USERS_PATH, listUsers);
export default app;
