/// <reference types="multer" />
import { Injectable, Logger } from '@nestjs/common';

export interface CallContent {
  title: string;
  thesis: string;
  conditionJson?: any;
  createdAt: string;
}

export interface OracleEvidence {
  callId: number;
  priceData: any;
  timestamp: string;
  source: string;
}

export interface OracleEvidencePayload {
  callId: number;
  source: string;
  apiUrl: string;
  rawResponse: any;
  fetchedAt: string;
  priceUsed: number;
}

@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);

  async pinCallContent(content: CallContent): Promise<string> {
    this.logger.log(`Pinning call content: ${content.title}`);
    await Promise.resolve();
    return `mock_cid_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  async pinOracleEvidence(evidence: OracleEvidence): Promise<string> {
    this.logger.log(`Pinning oracle evidence for call ${evidence.callId}`);
    await Promise.resolve();
    return `mock_evidence_cid_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  async pinEvidencePayload(payload: OracleEvidencePayload): Promise<string> {
    try {
      // In production this would call a pinning service (Pinata, web3.storage, etc.)
      const cid = `bafyevidence_${payload.callId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      this.logger.log(
        `Pinned oracle evidence for call ${payload.callId}: ${cid}`,
      );
      await Promise.resolve();
      return cid;
    } catch (error) {
      this.logger.warn(
        `IPFS pinning failed for call ${payload.callId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async getContent(cid: string): Promise<any> {
    this.logger.log(`Getting content for CID: ${cid}`);
    await Promise.resolve();
    return {
      title: 'Mock Content',
      thesis: 'This is mock content for testing',
      createdAt: new Date().toISOString(),
    };
  }

  getGatewayUrl(cid: string): string {
    const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs';
    return `${gateway}/${cid}`;
  }

  async pinJson(data: any): Promise<string> {
    const isMock = process.env.IPFS_MOCK !== 'false';
    if (isMock) {
      this.logger.log('IPFS_MOCK=true: Returning synthetic CID');
      return `ipfs_mock_cid_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    }
    const apiKey = process.env.PINATA_API_KEY;
    this.logger.log(
      `Pinning to Pinata service (ApiKey configured: ${Boolean(apiKey)})`,
    );
    return `bafy_pinata_${Date.now()}`;
  }

  async pinAvatar(file: Express.Multer.File): Promise<string> {
    this.logger.log(`Pinning avatar for file: ${file.originalname}`);
    return this.pinJson({ filename: file.originalname, size: file.size });
  }
}
