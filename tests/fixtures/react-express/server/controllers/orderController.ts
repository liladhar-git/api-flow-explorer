import { Order } from '../models/Order';

export const orderController = {
  async list(req: any, res: any) {
    res.json(await Order.find({}));
  },
  async remove(req: any, res: any) {
    await Order.deleteOne({ _id: req.params.orderId });
    res.sendStatus(204);
  },
};
