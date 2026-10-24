import * as userService from '../services/userService';
import { asyncHandler } from '../middleware/asyncHandler';

export async function listUsers(req: any, res: any) {
  res.json(await userService.findAll());
}

export const getUser = async (req: any, res: any) => {
  res.json(await userService.findById(req.params.id));
};

export const createUser = asyncHandler(async (req: any, res: any) => {
  res.status(201).json(await userService.create(req.body));
});
