import { User } from '../models/User';

export async function findAll() {
  return User.find();
}

export async function findById(id: string) {
  return User.findById(id);
}

export async function create(data: unknown) {
  const user = new User(data);
  return user.save();
}

export async function setAvatar(id: string, url: string) {
  return User.updateOne({ _id: id }, { avatar: url });
}
