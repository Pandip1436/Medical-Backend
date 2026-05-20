import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const DOC_TYPES = ['INV', 'QTN', 'CN', 'DN', 'PO', 'GRN'] as const;
export type ConfigurableDocType = (typeof DOC_TYPES)[number];

export const FY_FORMATS = ['YY-YY', 'YYYY-YY', 'YY', 'YYYY'] as const;
export type FyFormatLiteral = (typeof FY_FORMATS)[number];

// Allowed characters in a template: alphanumerics, `/`, `-`, `_`, space, `{`, `}`.
// Tokens `{FY}` and `{NN}` are the only ones consumed by the renderer; any
// other `{...}` is left as a literal (rendered as-is in the output).
const TEMPLATE_CHAR_RE = /^[A-Za-z0-9/\-_ {}]+$/;

export class UpsertNumberingConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(TEMPLATE_CHAR_RE, {
    message: 'template may contain only letters, digits, "/", "-", "_", spaces, and "{}"',
  })
  template!: string;

  @IsString()
  @IsIn(FY_FORMATS as readonly string[])
  fyFormat!: FyFormatLiteral;

  @IsInt()
  @Min(1)
  @Max(10)
  padding!: number;
}
