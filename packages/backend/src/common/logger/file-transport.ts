import { join } from 'path';

export type FileTransportTarget = {
  target: string;
  options: {
    file: string;
    frequency: 'daily';
    limit: { count: number };
    mkdir: boolean;
  };
};

export function getFileTransportTarget(): FileTransportTarget | null {
  if (process.env.LOG_TO_FILE !== 'true') {
    return null;
  }

  return {
    target: 'pino-roll',
    options: {
      file: join('logs', 'app.log'),
      frequency: 'daily',
      limit: { count: 7 },
      mkdir: true,
    },
  };
}
