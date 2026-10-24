import { Body, Controller, Get, Put } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller({ path: 'products' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  all() {
    return this.products.all();
  }

  @Put(['bulk', 'batch'])
  save(@Body() body: any) {
    return this.products.save(body);
  }
}
