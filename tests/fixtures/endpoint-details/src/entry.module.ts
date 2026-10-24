import { Module } from '@nestjs/common';
import { EntryController } from './entry.controller';

@Module({ controllers: [EntryController] })
export class EntryModule {}
