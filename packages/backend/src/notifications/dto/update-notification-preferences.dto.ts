import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdatePreferenceItemDto } from './update-preference-item.dto';

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePreferenceItemDto)
  preferences: UpdatePreferenceItemDto[];
}
