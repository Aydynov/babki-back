import { Connection, Types } from 'mongoose';
import {
  LifecycleBackfill,
  LifecycleMigrationStore,
  PlanOriginCandidate,
  PlanOriginResult,
} from './lifecycle-migration';

export class MongooseLifecycleMigrationStore
  implements LifecycleMigrationStore
{
  constructor(private readonly connection: Connection) {}

  async applyBackfill(step: LifecycleBackfill): Promise<number> {
    const model = this.requireModel(step.model);
    const result = await model.updateMany(step.filter, step.update).exec();
    return result.modifiedCount;
  }

  async findPlanOrigins(): Promise<PlanOriginCandidate[]> {
    const plans = await this.requireModel('Plan')
      .find({ expenseId: { $exists: true, $ne: null } })
      .select('_id expenseId')
      .lean()
      .exec();

    return plans.map((plan) => ({
      planId: String(plan._id),
      expenseId: String(plan.expenseId),
    }));
  }

  async setPlanOriginIfMissing(
    candidate: PlanOriginCandidate,
  ): Promise<PlanOriginResult> {
    const transactions = this.requireModel('Transaction');
    const update = await transactions
      .updateOne(
        { _id: candidate.expenseId, type: 'expense', origin: null },
        {
          $set: {
            origin: {
              type: 'plan',
              id: new Types.ObjectId(candidate.planId),
            },
          },
        },
      )
      .exec();
    if (update.modifiedCount === 1) return 'updated';

    const transaction = await transactions
      .findById(candidate.expenseId)
      .select('type origin')
      .lean()
      .exec();
    if (!transaction || transaction.type !== 'expense') return 'missing';
    if (
      transaction.origin?.type === 'plan' &&
      String(transaction.origin.id) === candidate.planId
    ) {
      return 'already_set';
    }
    return 'conflict';
  }

  async findLegacyDebtIncomeCandidates() {
    const incomes = await this.requireModel('Transaction')
      .find({
        type: 'income',
        origin: null,
        source: /^Погашение долга /,
      })
      .select('_id')
      .lean()
      .exec();
    return incomes.map((income) => ({ transactionId: String(income._id) }));
  }

  private requireModel(name: string) {
    const model = this.connection.models[name];
    if (!model) throw new Error(`Lifecycle migration model is not registered: ${name}`);
    return model;
  }
}
