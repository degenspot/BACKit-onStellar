import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { QueryResolver } from './resolvers/query.resolver';
import { CallResolver } from './resolvers/call.resolver';
import { UserResolver } from './resolvers/user.resolver';
import { DataloaderService } from './dataloaders/dataloader.service';
import { ComplexityPlugin } from './plugins/complexity.plugin';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true, // In-memory or path to file
      playground: true,
      context: ({ req, res }) => ({ req, res }),
    }),
  ],
  providers: [
    QueryResolver,
    CallResolver,
    UserResolver,
    DataloaderService,
    ComplexityPlugin,
  ],
})
export class GraphqlApiModule {}
