import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { GroupInvitationRateLimitGuard } from './group-invitation-rate-limit.guard';

describe('GroupInvitationRateLimitGuard', () => {
  const limits = { findOneAndUpdate: jest.fn() };
  const guard = new GroupInvitationRateLimitGuard(limits as never);
  const setHeader = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 'user' } }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-01-01T00:00:30Z').getTime());
  });
  afterEach(() => jest.restoreAllMocks());
  it('allows the tenth attempt and atomically increments a shared minute counter', async () => {
    limits.findOneAndUpdate.mockResolvedValue({ count: 10 });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(limits.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user', windowStart: new Date('2026-01-01T00:00:00Z') },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date('2026-01-01T00:01:00Z') },
      },
      { upsert: true, returnDocument: 'after' },
    );
  });
  it('returns 429 and the remainder of the minute for attempt eleven', async () => {
    limits.findOneAndUpdate.mockResolvedValue({ count: 11 });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 30);
  });
  it('retries a simultaneous first-counter insertion as an increment', async () => {
    limits.findOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({ count: 2 });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(limits.findOneAndUpdate.mock.calls[1][2]).toEqual({
      returnDocument: 'after',
    });
  });
  it('fails closed when MongoDB is unavailable', async () => {
    limits.findOneAndUpdate.mockRejectedValue(new Error('private detail'));
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
