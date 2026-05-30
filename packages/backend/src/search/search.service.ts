import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SearchService {
  constructor(private readonly dataSource: DataSource) {}

  private toPrefixTsQuery(query: string): string {
    return query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `${term.replace(/[':]/g, '')}:*`)
      .join(' & ');
  }

  async globalSearch(query: string) {
    const formattedQuery = this.toPrefixTsQuery(query);
    if (!formattedQuery) {
      return { calls: [], users: [] };
    }

    const calls = await this.dataSource.query(
      `
      SELECT id, title, "creatorAddress", "createdAt",
             ts_rank("searchVector", to_tsquery('simple', $1)) as rank
      FROM calls
      WHERE "searchVector" @@ to_tsquery('simple', $1)
      ORDER BY rank DESC
      LIMIT 10
      `,
      [formattedQuery],
    );

    const users = await this.dataSource.query(
      `
      SELECT id, "walletAddress",
             CASE WHEN LOWER("walletAddress") LIKE LOWER($2) THEN 1 ELSE 0 END as rank
      FROM users
      WHERE LOWER("walletAddress") LIKE LOWER($2)
      ORDER BY rank DESC
      LIMIT 10
      `,
      [formattedQuery, `%${query}%`],
    );

    return {
      calls,
      users,
    };
  }
}
