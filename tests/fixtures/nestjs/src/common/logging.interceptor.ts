import { Injectable, NestInterceptor } from '@nestjs/common';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: unknown, next: { handle(): unknown }) {
    return next.handle();
  }
}
