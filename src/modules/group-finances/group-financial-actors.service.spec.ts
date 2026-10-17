import { ClientSession, Model, Types } from 'mongoose';
import { UserDocument } from '../users/schemas/user.schema';
import { GroupFinancialActorsService } from './group-financial-actors.service';

describe('GroupFinancialActorsService', () => {
  const author = new Types.ObjectId('000000000000000000000001');
  const participant = new Types.ObjectId('000000000000000000000002');
  const absent = new Types.ObjectId('000000000000000000000003');
  const profile = {
    _id: author,
    firstName: 'Anna',
    email: 'private@example.test',
    status: 'active',
  };
  let service: GroupFinancialActorsService;
  let find: jest.Mock;
  let select: jest.Mock;
  let session: jest.Mock;
  let exec: jest.Mock;

  beforeEach(() => {
    exec = jest.fn().mockResolvedValue([profile]);
    const query = {
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec,
    };
    select = query.select;
    session = query.session;
    find = jest.fn().mockReturnValue(query);
    service = new GroupFinancialActorsService({
      find,
    } as unknown as Model<UserDocument>);
  });

  it('loads a deduplicated page with an active-only safe projection', async () => {
    const rows = [
      {
        type: 'expense',
        createdBy: author,
        participantId: participant,
        amount: 12,
      },
      {
        type: 'expense',
        createdBy: participant,
        participantId: author,
        amount: 20,
      },
      { type: 'income', createdBy: author, amount: 8 },
    ];
    const result = await service.enrich(rows);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      _id: { $in: [author, participant] },
      status: 'active',
    });
    expect(select).toHaveBeenCalledWith('_id firstName lastName');
    expect(session).toHaveBeenCalledWith(null);
    expect(result[0].createdByActor).toEqual({
      userId: author.toString(),
      firstName: 'Anna',
      lastName: null,
      isAnonymized: false,
    });
    expect(result[0].participantActor).toEqual({
      userId: participant.toString(),
      firstName: null,
      lastName: null,
      isAnonymized: true,
    });
    expect(result[1].participantActor).toEqual(result[0].createdByActor);
    expect(result[2]).not.toHaveProperty('participantActor');
    expect(result[0]).toMatchObject(rows[0]);
    expect(result[0]).not.toBe(rows[0]);
    expect(rows[0]).not.toHaveProperty('createdByActor');
    expect(rows[0]).not.toHaveProperty('participantActor');
  });

  it('does not query an empty page', async () => {
    await expect(service.enrich([])).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('preserves explicit empty names and normalizes absent names', async () => {
    exec.mockResolvedValue([
      { _id: author, firstName: '', lastName: '' },
      { _id: participant },
    ]);
    const result = await service.enrichOne({
      type: 'expense',
      createdBy: author,
      participantId: participant,
    });
    expect(result.createdByActor).toEqual({
      userId: author.toString(),
      firstName: '',
      lastName: '',
      isAnonymized: false,
    });
    expect(result.participantActor).toEqual({
      userId: participant.toString(),
      firstName: null,
      lastName: null,
      isAnonymized: false,
    });
  });

  it('anonymizes profiles absent from the active query and retains stored identifiers', async () => {
    exec.mockResolvedValue([]);
    const result = await service.enrichOne({
      type: 'expense',
      createdBy: author,
      participantId: absent,
    });
    expect(result.createdBy).toBe(author);
    expect(result.participantId).toBe(absent);
    expect(result.createdByActor).toEqual({
      userId: author.toString(),
      firstName: null,
      lastName: null,
      isAnonymized: true,
    });
    expect(result.participantActor).toEqual({
      userId: absent.toString(),
      firstName: null,
      lastName: null,
      isAnonymized: true,
    });
  });

  it('only resolves participants of expenses with a stored participant', async () => {
    const result = await service.enrich([
      { type: 'expense', createdBy: author },
      { type: 'income', createdBy: author, participantId: participant },
      { type: 'transfer', createdBy: author, participantId: participant },
    ]);
    expect(find).toHaveBeenCalledWith({
      _id: { $in: [author] },
      status: 'active',
    });
    for (const row of result)
      expect(row).not.toHaveProperty('participantActor');
  });

  it('uses the supplied financial transaction session', async () => {
    const financialSession = {} as ClientSession;
    await service.enrichOne(
      { type: 'income', createdBy: author },
      financialSession,
    );
    expect(session).toHaveBeenCalledWith(financialSession);
  });

  it('reads current profiles on every invocation', async () => {
    const row = { type: 'income', createdBy: author };
    await service.enrichOne(row);
    exec.mockResolvedValue([
      { _id: author, firstName: 'Renamed', lastName: 'Name' },
    ]);
    expect((await service.enrichOne(row)).createdByActor.firstName).toBe(
      'Renamed',
    );
    exec.mockResolvedValue([]);
    expect((await service.enrichOne(row)).createdByActor.isAnonymized).toBe(
      true,
    );
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('propagates storage errors instead of returning anonymous success', async () => {
    const failure = new Error('profile storage unavailable');
    exec.mockRejectedValue(failure);
    await expect(
      service.enrichOne({ type: 'income', createdBy: author }),
    ).rejects.toBe(failure);
  });
});
