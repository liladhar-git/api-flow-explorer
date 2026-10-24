import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly repo: Repository<Product>) {}

  all() {
    return this.repo.find();
  }

  save(p: Product) {
    return this.repo.save(p);
  }
}
