import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({ name: String, avatar: String });
export const User = mongoose.model('User', userSchema);
