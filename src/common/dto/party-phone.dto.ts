import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PHONE_LABELS } from '../utils/party-phones.util';
// `import type` is required here: with isolatedModules + emitDecoratorMetadata,
// a type referenced by a decorated property must not look like a value import.
import type { PhoneLabel } from '../utils/party-phones.util';

// One entry in a party's `phones` list. Shared by the customer and supplier
// create/update/import DTOs so the wire shape can't drift between them.
//
// Validation here is deliberately shallow — only "is this the right shape".
// Whether the number is usable, unique within the list, and which entry ends up
// primary is settled by normalizePartyPhones in party-phones.util, which the
// services run over whatever arrives. Duplicating those rules in decorators
// would give two places to disagree.
export class PartyPhoneDto {
  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsIn(PHONE_LABELS)
  @IsOptional()
  label?: PhoneLabel;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}
