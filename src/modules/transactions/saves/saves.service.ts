import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { Save, SaveDocument } from '../schemas/save.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateSaveDto } from './dto/create-save.dto';
import { UpdateSaveDto } from './dto/update-save.dto';

@Injectable()
export class SavesService {
  constructor(
    @InjectModel(Save.name)
    private readonly saveModel: Model<SaveDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, createSaveDto: CreateSaveDto) {
    const transactionDate =
      createSaveDto.transactionDate ?? new Date().toISOString();

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const foundIds = await this.transactionsService.ensureUserExists(
          userId,
          'saving',
          session,
        );
        await this.transactionsService.lockAccounts(
          userId,
          [foundIds.accountId.toString(), createSaveDto.sourceAccountId],
          session,
        );
        const foundSnapshot =
          await this.snapshotsService.findOrCreateByAccountId(
            userId,
            foundIds.accountId.toString(),
            transactionDate,
            session,
          );

        if (!foundSnapshot) {
          throw new NotFoundException(
            `Snapshot for account ${foundIds.accountId.toString()} not found.`,
          );
        }

        const sourceSnapshot =
          await this.snapshotsService.findOrCreateByAccountId(
            userId,
            createSaveDto.sourceAccountId,
            createSaveDto.transactionDate,
            session,
          );

        if (!sourceSnapshot) {
          throw new NotFoundException(
            `Snapshot for account ${createSaveDto.sourceAccountId} not found.`,
          );
        }

        if (sourceSnapshot.amount < createSaveDto.amount) {
          throw new BadRequestException('Insufficient funds');
        }

        const [createdSave] = await this.saveModel.create(
          [
            {
              ...personalBudget(foundIds.userId),
              createdBy: foundIds.userId,
              accountId: foundIds.accountId,
              snapshotId: foundSnapshot._id,
              sourceAccountId: sourceSnapshot.accountId,
              amount: createSaveDto.amount,
              description: createSaveDto.description,
              transactionDate: createSaveDto.transactionDate,
            },
          ],
          { session },
        );
        await this.snapshotsService.recalculateSnapshotsFromDate(
          userId,
          foundSnapshot.accountId.toString(),
          { date: transactionDate },
          { amount: createSaveDto.amount },
          session,
        );
        await this.snapshotsService.recalculateSnapshotsFromDate(
          userId,
          createSaveDto.sourceAccountId,
          { date: transactionDate },
          { amount: -createSaveDto.amount },
          session,
        );

        return personalResponse(createdSave.toJSON());
      });
    } finally {
      await session.endSession();
    }
  }

  // TODO Добавить сортировку в DTO
  async findAll(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(
      userId,
      { ...query, transactionType: 'save' },
      this.saveModel,
    );
  }

  async findRevenue(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findRevenue(
      userId,
      { ...query, transactionType: 'save' },
      this.saveModel,
    );
  }

  async findOne(userId: string, transactionId: string) {
    const typedEntity = await this.transactionsService.findOne(
      userId,
      transactionId,
      this.saveModel,
    );
    return typedEntity as SaveDocument | undefined;
  }

  async update(
    userId: string,
    transactionId: string,
    updateIncomeDto: UpdateSaveDto,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const save = (await this.transactionsService.findOne(
          userId,
          transactionId,
          this.saveModel,
          session,
        )) as SaveDocument;

        if (!save) {
          throw new NotFoundException(`Save ${transactionId} not found`);
        }

        await this.transactionsService.lockAccounts(
          userId,
          [save.accountId.toString(), save.sourceAccountId.toString()],
          session,
        );
        const updatePayload = Object.fromEntries(
          Object.entries({
            amount: updateIncomeDto.amount,
            description: updateIncomeDto.description,
          }).filter(([, value]) => value !== undefined),
        );

        let diffAmount: number | undefined;
        if (updateIncomeDto.amount !== undefined) {
          diffAmount = updateIncomeDto.amount - save.amount;

          const sourceSnapshot = await this.snapshotsService.findByAccountId(
            userId,
            save.sourceAccountId.toString(),
            save.transactionDate.toString(),
            session,
          );

          if (!sourceSnapshot) {
            throw new NotFoundException(
              `Snapshot for account ${save.sourceAccountId.toString()} not found.`,
            );
          }

          if (sourceSnapshot.amount < diffAmount) {
            throw new BadRequestException('Insufficient funds');
          }
        }

        if (diffAmount !== undefined) {
          await this.snapshotsService.recalculateSnapshotsFromDate(
            userId,
            save.accountId.toString(),
            { date: save.transactionDate.toISOString() },
            { amount: diffAmount },
            session,
          );
          await this.snapshotsService.recalculateSnapshotsFromDate(
            userId,
            save.sourceAccountId.toString(),
            { date: save.transactionDate.toISOString() },
            { amount: -diffAmount },
            session,
          );
        }

        // TODO Проверить с пустыми значениями для удаления
        const updatedSave = await this.saveModel
          .findOneAndUpdate(
            {
              _id: transactionId,
              ...personalBudget(new Types.ObjectId(userId)),
            },
            { $set: updatePayload },
            {
              returnDocument: 'after',
              runValidators: true,
              session,
            },
          )
          .lean();

        if (!updatedSave) {
          throw new NotFoundException(
            `Save ${transactionId} for user ${userId} not found.`,
          );
        }

        return personalResponse(updatedSave);
      });
    } finally {
      await session.endSession();
    }
  }
}
