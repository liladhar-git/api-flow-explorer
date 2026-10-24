import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PrismaService } from './orders/prisma.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

@Module({
  imports: [UsersModule],
  controllers: [OrdersController, ProductsController, SearchController],
  providers: [OrdersService, PrismaService, ProductsService, SearchService],
})
export class AppModule {}
