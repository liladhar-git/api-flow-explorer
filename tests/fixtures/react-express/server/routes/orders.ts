import express from 'express';
import { orderController } from '../controllers/orderController';

export const ordersRouter = express.Router();

ordersRouter.get('/', orderController.list);
ordersRouter.delete('/:orderId', orderController.remove);
