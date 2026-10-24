import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export class AddressDto {
  @IsString() street: string;
  @IsOptional() @IsString() zip?: string;
}

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsEnum(Role) role: Role;
  @IsOptional() nickname?: string;
  @ValidateNested() address: AddressDto;
  tags: string[];
  age = 18;
  private secret: string;
}

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {}

export class ListQuery {
  page?: number;
  search?: string;
  @IsIn(['asc', 'desc']) order: string;
}

@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return dto;
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdateUserDto) {
    return { id, dto };
  }

  @Get()
  list(@Query() q: ListQuery) {
    return q;
  }

  @Get('search')
  search(@Query('term') term: string, @Query('limit') limit?: number) {
    return { term, limit };
  }

  @Post(':id/note')
  note(@Param('id') id: string, @Body('text') text: string) {
    return { id, text };
  }
}
