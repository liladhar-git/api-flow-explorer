import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { MailService } from '../mail/mail.service';
import { MailProcessor } from '../mail/mail.processor';
import { CacheService } from '../cache/cache.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [UsersController],
  providers: [UsersService, MailService, MailProcessor, CacheService],
})
export class UsersModule {}
