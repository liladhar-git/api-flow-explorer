import { Process, Processor } from '@nestjs/bull';

@Processor('mail')
export class MailProcessor {
  @Process('goodbye')
  handleGoodbye(job: unknown) {
    return job;
  }
}
