import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { GroupFinancialActor } from './interfaces/group-financial-actor.interface';

interface ActorTransaction {
  createdBy: Types.ObjectId;
  type?: string;
  participantId?: Types.ObjectId;
}

type WithActors<T> = T & {
  createdByActor: GroupFinancialActor;
  participantActor?: GroupFinancialActor;
};

type ActorProfile = {
  _id: Types.ObjectId;
  firstName?: string | null;
  lastName?: string | null;
};

@Injectable()
export class GroupFinancialActorsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async enrich<T extends ActorTransaction>(
    rows: readonly T[],
    session?: ClientSession,
  ): Promise<WithActors<T>[]> {
    if (!rows.length) return [];
    const ids = new Map<string, Types.ObjectId>();
    for (const row of rows) {
      ids.set(row.createdBy.toString(), row.createdBy);
      if (row.type === 'expense' && row.participantId)
        ids.set(row.participantId.toString(), row.participantId);
    }
    const profiles = await this.users
      .find({ _id: { $in: [...ids.values()] }, status: 'active' })
      .select('_id firstName lastName')
      .session(session ?? null)
      .lean<ActorProfile[]>()
      .exec();
    const profilesById = new Map(
      profiles.map((profile) => [profile._id.toString(), profile]),
    );
    const actorFor = (id: Types.ObjectId): GroupFinancialActor => {
      const userId = id.toString();
      const profile = profilesById.get(userId);
      return {
        userId,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        isAnonymized: !profile,
      };
    };
    return rows.map((row) => ({
      ...row,
      createdByActor: actorFor(row.createdBy),
      ...(row.type === 'expense' && row.participantId
        ? { participantActor: actorFor(row.participantId) }
        : {}),
    }));
  }

  async enrichOne<T extends ActorTransaction>(
    row: T,
    session?: ClientSession,
  ): Promise<WithActors<T>> {
    const [enriched] = await this.enrich([row], session);
    return enriched;
  }
}
