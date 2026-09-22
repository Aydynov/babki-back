import { IsOptional, IsString, Length, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @Length(6, 8)
  secondFactorCode?: string;
}
