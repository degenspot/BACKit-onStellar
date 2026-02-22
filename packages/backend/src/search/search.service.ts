import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SearchService {
  constructor(private readonly dataSource: DataSource) {}

  async globalSearch(query: string) {
    const formattedQuery = query.split(' ').join(' & ');

    const calls = await this.dataSource.query(
      `
      SELECT id, title, ts_rank(search_vector, to_tsquery($1)) as rank
      FROM call
      WHERE search_vector @@ to_tsquery($1)
      ORDER BY rank DESC
      LIMIT 10
      `,
      [formattedQuery],
    );

    const users = await this.dataSource.query(
      `
      SELECT id, display_name, ts_rank(search_vector, to_tsquery($1)) as rank
      FROM "user"
      WHERE search_vector @@ to_tsquery($1)
      ORDER BY rank DESC
      LIMIT 10
      `,
      [formattedQuery],
    );

    return {
      calls,
      users,
    };
  }
}
