/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';

const logger = new Logger('Retryable');

export function Retryable(maxAttempts = 3, initialDelayMs = 1000) {
  return function (
    _target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;

          if (attempt < maxAttempts) {
            const baseDelay = initialDelayMs * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * 500);
            const delay = baseDelay + jitter;

            logger.warn(
              `${propertyKey} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`,
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      logger.error(
        `${propertyKey} failed after ${maxAttempts} attempts`,
      );
      throw lastError;
    };

    return descriptor;
  };
}
