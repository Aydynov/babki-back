import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountsSchema } from '../accounts/schemas/accounts.schema';
import { GroupsModule } from '../groups/groups.module';
import { BudgetAccessService } from './budget-access.service';
import { BudgetWriteService } from './budget-write.service';

@Module({
  imports: [
    GroupsModule,
    MongooseModule.forFeature([{ name: Account.name, schema: AccountsSchema }]),
  ],
  providers: [BudgetAccessService, BudgetWriteService],
  exports: [BudgetAccessService, BudgetWriteService],
})
export class BudgetsModule {}
