import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import {
  UserDeletionJob,
  UserDeletionJobSchema,
} from './schemas/user-deletion-job.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import {
  UserDeletionService,
  UserDeletionWorker,
} from './user-deletion.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserDeletionJob.name, schema: UserDeletionJobSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserDeletionService, UserDeletionWorker],
  exports: [
    UsersService,
    UserDeletionService,
    UserDeletionWorker,
    MongooseModule,
  ],
})
export class UsersModule {}
