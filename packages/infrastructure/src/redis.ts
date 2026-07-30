import type { RedisOptions } from 'ioredis';

export function parseRedisConnectionUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const options: RedisOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }

  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }

  if (url.protocol === 'rediss:') {
    options.tls = {};
  }

  return options;
}
