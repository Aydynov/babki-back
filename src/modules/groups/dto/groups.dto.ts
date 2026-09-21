import { Transform } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  IsMongoId,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateGroupDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name: string;
  @IsIn(['family', 'organization']) type: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class UpdateGroupDto {
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
  @IsMongoId() userId: string;
}
export class AcceptGroupInvitationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
}
export class EmptyGroupBodyDto {}

export class UpdateGroupPermissionsDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageAccounts?: unknown;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageCategories?: unknown;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  manageLimits?: unknown;
}
