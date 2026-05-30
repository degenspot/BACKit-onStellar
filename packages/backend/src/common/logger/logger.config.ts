import type { Params } from 'nestjs-pino';
import { getFileTransportTarget } from './file-transport';

export function buildLoggerConfig(): Params {
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = process.env.NODE_ENV !== 'production';
  const fileTarget = getFileTransportTarget();

  const pinoHttp: NonNullable<Params['pinoHttp']> = {
    level,
    redact: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
    ],
  };

  if (isDev && !fileTarget) {
    pinoHttp.transport = { target: 'pino-pretty' };
  } else if (!isDev && !fileTarget) {
    // Production: plain JSON to stdout (no transport)
  } else {
    const targets: Array<{
      target: string;
      level: string;
      options?: Record<string, unknown>;
    }> = [];

    if (!isDev) {
      targets.push({
        target: 'pino/file',
        level,
        options: { destination: 1 },
      });
    }

    if (isDev) {
      targets.push({ target: 'pino-pretty', level });
    }

    if (fileTarget) {
      targets.push({ ...fileTarget, level });
    }

    pinoHttp.transport = { targets };
  }

  return { pinoHttp };
}
