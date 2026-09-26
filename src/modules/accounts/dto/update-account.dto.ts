import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
