import { Connection } from 'mongoose';
import { MongooseIntegrityReader } from './mongoose-integrity-reader';

describe('MongooseIntegrityReader', () => {
  it('uses one read-only aggregation and never invokes model mutations', async () => {
    const exec = jest.fn().mockResolvedValue([
      { sourceId: 'source-1', targetId: 'target-1' },
    ]);
    const aggregate = jest.fn().mockReturnValue({ exec });
    const sourceWrites = {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      bulkWrite: jest.fn(),
    };
    const targetWrites = {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      bulkWrite: jest.fn(),
    };
    const connection = {
      models: {
        Source: {
          collection: { name: 'sources' },
          aggregate,
          ...sourceWrites,
        },
        Target: {
          collection: { name: 'targets' },
          ...targetWrites,
        },
      },
    } as unknown as Connection;
    const reader = new MongooseIntegrityReader(connection);

    const result = await reader.findOrphans({
      id: 'fixture.target',
      sourceModel: 'Source',
      sourceField: 'targetId',
      targetModel: 'Target',
      sourceFilter: { status: 'active' },
    });

    expect(result).toEqual([
      { sourceId: 'source-1', targetId: 'target-1' },
    ]);
    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          status: 'active',
          targetId: { $exists: true, $ne: null },
        },
      },
      expect.objectContaining({ $lookup: expect.any(Object) }),
      { $match: { '__integrityTarget.0': { $exists: false } } },
      expect.objectContaining({ $project: expect.any(Object) }),
    ]);
    for (const write of [
      ...Object.values(sourceWrites),
      ...Object.values(targetWrites),
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});
