import { Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

@Injectable()
export class SearchService {
  private readonly es = new Client({ node: 'http://localhost:9200' });

  find(q: string) {
    return this.es.search({ index: 'products', query: { match: { name: q } } });
  }
}
