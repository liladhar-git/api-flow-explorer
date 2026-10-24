import { User } from '../models';

export const listA = () => User.find();
export const saveA = (d: unknown) => User.create(d);
