/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { GlobalExceptionFilter } from './http-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';

function makeHost(url = '/test', method = 'GET') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const getResponse = jest.fn().mockReturnValue({ status });
  const getRequest = jest.fn().mockReturnValue({ url, method });
  return {
    switchToHttp: () => ({ getResponse, getRequest }),
    json,
    status,
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => {});
  });

  it('handles 400 HttpException', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new HttpException('Bad input', HttpStatus.BAD_REQUEST), host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, error: 'BAD_REQUEST', path: '/test' }),
    );
  });

  it('handles 404 HttpException', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('handles 409 HttpException', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new HttpException('Conflict', HttpStatus.CONFLICT), host);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });

  it('handles 500 for unhandled exception', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new Error('boom'), host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, error: 'Internal Server Error' }),
    );
  });

  it('handles TypeORM unique-violation (23505) as 409', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    const err = Object.assign(new QueryFailedError('', [], new Error()), { code: '23505' });
    filter.catch(err, host);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });

  it('handles EntityNotFoundError as 404', () => {
    const host = makeHost();
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new EntityNotFoundError('User', {}), host);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('includes timestamp and path in every response', () => {
    const host = makeHost('/api/v1/calls', 'POST');
    const res = (host.switchToHttp().getResponse() as any).status();
    filter.catch(new HttpException('err', 400), host);
    const call = res.json.mock.calls[0][0];
    expect(call.path).toBe('/api/v1/calls');
    expect(call.timestamp).toMatch(/^\d{4}-/);
  });
});
