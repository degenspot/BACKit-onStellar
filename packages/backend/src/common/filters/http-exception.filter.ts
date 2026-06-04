/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message } = this.classify(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `[${request.method} ${request.url}] ${statusCode} — ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${request.method} ${request.url}] ${statusCode} — ${message}`);
    }

    const body: ErrorResponse = {
      statusCode,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private classify(exception: unknown): { statusCode: number; error: string; message: string } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && 'message' in (res as object)
          ? Array.isArray((res as any).message)
            ? (res as any).message.join('; ')
            : String((res as any).message)
          : exception.message;
      return { statusCode, error: HttpStatus[statusCode] ?? 'HTTP_ERROR', message };
    }

    if (exception instanceof QueryFailedError) {
      const pg = exception as any;
      // Unique-violation
      if (pg.code === '23505') {
        return { statusCode: 409, error: 'Conflict', message: 'A record with this value already exists.' };
      }
      // Foreign-key violation
      if (pg.code === '23503') {
        return { statusCode: 400, error: 'Bad Request', message: 'Referenced record does not exist.' };
      }
      return { statusCode: 500, error: 'Internal Server Error', message: 'A database error occurred.' };
    }

    if (exception instanceof EntityNotFoundError) {
      return { statusCode: 404, error: 'Not Found', message: 'The requested resource was not found.' };
    }

    return {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred. Please try again later.',
    };
  }
}
