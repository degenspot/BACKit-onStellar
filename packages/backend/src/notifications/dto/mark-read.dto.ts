import { IsArray, IsInt, ArrayNotEmpty, IsOptional } from 'class-validator';

export class MarkReadDto {
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @IsInt({ each: true })
    ids?: number[];
}
