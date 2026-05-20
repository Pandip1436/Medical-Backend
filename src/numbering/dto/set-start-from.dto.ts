import { IsInt, Max, Min } from 'class-validator';

export class SetStartFromDto {
  @IsInt()
  @Min(1)
  @Max(9_999_999)
  startFrom!: number;
}
