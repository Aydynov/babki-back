import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
export class CreateSpaceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class UpdateSpaceDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class TransferOwnershipDto {
  @IsMongoId()
  userId: string;
}
export class AcceptSpaceInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;
}
export class EmptySpaceBodyDto {}
export class UpdateSpacePermissionsDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageAccounts?: unknown;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageCategories?: unknown;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageLimits?: unknown;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageTransactions?: unknown;
}
