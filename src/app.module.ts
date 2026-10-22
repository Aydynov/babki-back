import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { AccountsSnapshotsModule } from './modules/accounts-snapshots/accounts-snapshots.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { DebtTransactionsModule } from './modules/debt-transactions/debt-transactions.module';
import { DebtsModule } from './modules/debts/debts.module';
import { ExpenseCategoriesModule } from './modules/expense-categories/expense-categories.module';
import { ExpenseLimitsModule } from './modules/expense-limits/expense-limits.module';
import { PlansModule } from './modules/plans/plans.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SpaceFinancesModule } from './modules/space-finances/space-finances.module';
import { SpacesModule } from './modules/spaces/spaces.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { UsersModule } from './modules/users/users.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('mongo.uri'),
      }),
    }),
    AuthModule,
    UsersModule,
    AccountsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    ExpenseCategoriesModule,
    PlansModule,
    DebtsModule,
    DebtTransactionsModule,
    ExpenseLimitsModule,
    ReportsModule,
    SpacesModule,
    SpaceFinancesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
