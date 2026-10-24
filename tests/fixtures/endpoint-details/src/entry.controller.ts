import { Controller, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AuthGuard, PermissionsGuard, TransformInterceptor } from './guards';

@Controller(':singularName')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(TransformInterceptor)
export class EntryController {
  @Post(':id/actions/publish')
  @ApiOperation({ summary: 'Publish an entry by singular name and ID.' })
  publish(@Param('singularName') singularName: string, @Param('id') id: string) {
    return { singularName, id };
  }

  /**
   * Remove an entry.
   *
   * Longer explanation that is not shown.
   */
  @Post(':id/remove')
  remove(@Param('id') id: string) {
    return id;
  }
}
