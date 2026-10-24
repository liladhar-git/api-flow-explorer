import mongoose from 'mongoose';

export const User = mongoose.model('User', new mongoose.Schema({ name: String }));
