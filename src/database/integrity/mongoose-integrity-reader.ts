import { Connection, PipelineStage } from 'mongoose';
import { IntegrityReader, OrphanReference } from './integrity-audit';
import { IntegrityRelation } from './integrity-relations';

export class MongooseIntegrityReader implements IntegrityReader {
  constructor(private readonly connection: Connection) {}

  async findOrphans(relation: IntegrityRelation): Promise<OrphanReference[]> {
    const source = this.connection.models[relation.sourceModel];
    const target = this.connection.models[relation.targetModel];
    if (!source || !target) {
      throw new Error(
        `Integrity audit model is not registered: ${relation.id}`,
      );
    }

    const targetMatch: Record<string, unknown> = {
      $expr: { $eq: ['$_id', '$$targetId'] },
      ...(relation.targetFilter ?? {}),
    };
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...(relation.sourceFilter ?? {}),
          [relation.sourceField]: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: target.collection.name,
          let: { targetId: `$${relation.sourceField}` },
          pipeline: [{ $match: targetMatch }],
          as: '__integrityTarget',
        },
      },
      { $match: { '__integrityTarget.0': { $exists: false } } },
      {
        $project: {
          _id: 0,
          sourceId: { $toString: '$_id' },
          targetId: { $toString: `$${relation.sourceField}` },
        },
      },
    ];

    return source.aggregate<OrphanReference>(pipeline).exec();
  }
}
