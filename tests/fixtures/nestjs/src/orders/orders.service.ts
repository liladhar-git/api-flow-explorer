import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.order.findMany();
  }

  create(data: unknown) {
    return this.prisma.order.create({ data });
  }
}
