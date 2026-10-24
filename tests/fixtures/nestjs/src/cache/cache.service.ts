import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private readonly redis = new Redis();

  get(key: string) {
    return this.redis.get(key);
  }

  invalidate(key: string) {
    return this.redis.del(key);
  }
}
