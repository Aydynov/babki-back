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

    const conditions: Record<string, unknown>[] = [
      { $eq: ['$_id', '$$targetId'] },
    ];
    if (relation.sameBudget) {
      conditions.push(
        { $eq: ['$ownerType', '$$ownerType'] },
        { $eq: ['$ownerId', '$$ownerId'] },
      );
    }
    if (relation.planOrigin) {
      conditions.push(
        { $eq: ['$origin.type', 'plan'] },
        { $eq: ['$origin.id', '$$planId'] },
      );
    }
    if (relation.expenseOrigin) {
      conditions.push(
        { $eq: ['$expenseId', '$$expenseId'] },
        { $eq: ['$status', 'closed'] },
      );
    }
    const targetMatch: Record<string, unknown> = {
      $expr: conditions.length === 1 ? conditions[0] : { $and: conditions },
      ...(relation.targetFilter ?? {}),
    };
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...(relation.sourceFilter ?? {}),
          ...(relation.required
            ? {}
            : { [relation.sourceField]: { $exists: true, $ne: null } }),
        },
      },
      {
        $lookup: {
          from: target.collection.name,
          let: {
            targetId: `$${relation.sourceField}`,
            ...(relation.sameBudget
              ? { ownerType: '$ownerType', ownerId: '$ownerId' }
              : {}),
            ...(relation.planOrigin ? { planId: '$_id' } : {}),
            ...(relation.expenseOrigin ? { expenseId: '$_id' } : {}),
          },
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
