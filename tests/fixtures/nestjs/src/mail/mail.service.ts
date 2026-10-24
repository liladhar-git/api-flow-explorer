import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class MailService {
  constructor(@InjectQueue('mail') private readonly queue: Queue) {}

  sendGoodbye(id: string) {
    return this.queue.add('goodbye', { id });
  }
}
