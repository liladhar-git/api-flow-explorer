export type Lib = 'mongoose' | 'typeorm' | 'prisma' | 'redis' | 'elasticsearch' | 'queue' | 'event';
export type Access = 'reads' | 'writes';

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** Method names that count as reads or writes per client library. Anything not listed produces no edge. */
export const OPS: Record<'mongoose' | 'typeorm' | 'prisma' | 'redis' | 'elasticsearch', { reads: Set<string>; writes: Set<string> }> = {
  mongoose: {
    reads: set('find findOne findById countDocuments estimatedDocumentCount count exists distinct aggregate populate findOneAndPopulate watch'),
    writes: set('create insertMany insertOne save updateOne updateMany findByIdAndUpdate findOneAndUpdate findOneAndReplace findByIdAndDelete findOneAndDelete findByIdAndRemove findOneAndRemove deleteOne deleteMany remove replaceOne bulkWrite'),
  },
  typeorm: {
    reads: set('find findBy findOne findOneBy findOneOrFail findOneByOrFail findAndCount findAndCountBy count countBy exist exists existsBy sum average minimum maximum query'),
    writes: set('save insert update upsert delete remove softDelete softRemove restore increment decrement clear recover'),
  },
  prisma: {
    reads: set('findMany findFirst findFirstOrThrow findUnique findUniqueOrThrow count aggregate groupBy'),
    writes: set('create createMany createManyAndReturn update updateMany upsert delete deleteMany'),
  },
  redis: {
    reads: set('get mget getBuffer hget hgetall hmget hkeys hvals lrange lindex llen smembers sismember scard zrange zrangebyscore zscore zcard exists keys scan ttl type strlen getrange'),
    writes: set('set setex setnx mset hset hmset hdel del unlink expire expireat pexpire lpush rpush lpop rpop sadd srem zadd zrem incr incrby decr decrby append flushdb flushall getdel'),
  },
  elasticsearch: {
    reads: set('search get count mget msearch exists scroll'),
    writes: set('index create update delete bulk deleteByQuery updateByQuery reindex'),
  },
};

export function accessOf(lib: keyof typeof OPS, op: string): Access | undefined {
  const t = OPS[lib];
  if (t.reads.has(op)) return 'reads';
  if (t.writes.has(op)) return 'writes';
  return undefined;
}
