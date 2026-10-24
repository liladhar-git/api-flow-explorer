import * as models from '../models';

export const countB = () => models.User.countDocuments();
export const saveOrder = () => models.Order.create({});
