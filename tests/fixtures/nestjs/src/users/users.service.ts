import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { MailService } from '../mail/mail.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly mailService: MailService,
    private readonly cache: CacheService,
  ) {}

  findAll() {
    return this.userModel.find().exec();
  }

  async findOne(id: string) {
    const cached = await this.cache.get(id);
    return cached ?? this.userModel.findById(id).exec();
  }

  async create(dto: unknown) {
    const created = new this.userModel(dto);
    return created.save();
  }

  async remove(id: string) {
    await this.userModel.findByIdAndDelete(id);
    await this.mailService.sendGoodbye(id);
    await this.cache.invalidate(id);
  }
}
