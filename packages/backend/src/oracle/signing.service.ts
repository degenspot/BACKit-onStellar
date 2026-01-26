import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';

@Injectable()
export class SigningService {
    private readonly logger = new Logger(SigningService.name);
    private readonly oracleKeypair: Keypair;

    constructor(private configService: ConfigService) {
        const secretKey = this.configService.get<string>('ORACLE_SECRET_KEY');
        if (!secretKey) {
            this.logger.warn('ORACLE_SECRET_KEY not found in config. Using random key for development.');
            this.oracleKeypair = Keypair.random();
        } else {
            try {
                this.oracleKeypair = Keypair.fromSecret(secretKey);
            } catch (error) {
                this.logger.error('Invalid ORACLE_SECRET_KEY. Using random key for development.', error);
                this.oracleKeypair = Keypair.random();
            }
        }

        this.logger.log(`Oracle initialized with public key: ${this.oracleKeypair.publicKey()}`);
    }

    /**
     * Sign an outcome message for submission to the OutcomeManager contract
     * @param data The data to sign
     * @returns The ed25519 signature as a hex string
     */
    signOutcome(data: {
        callId: number;
        price: number;
        timestamp: number;
        outcome: string;
        pairAddress: string;
    }): string {
        try {
            // Construct canonical message matching contract format (from ARCHITECTURE.md)
            // Format: "BACKit:Outcome:{call_id}:{outcome}:{final_price}:{timestamp}"

            const callIdBytes = Buffer.alloc(8);
            callIdBytes.writeBigUInt64BE(BigInt(data.callId));

            const outcomeBit = data.outcome === 'YES' ? '1' : '0';

            // Price is expected as an i128 in the contract, we use 10^7 precision usually on Stellar
            const scaledPrice = BigInt(Math.floor(data.price * 10000000));
            const priceBytes = Buffer.alloc(16);
            priceBytes.writeBigInt64BE(scaledPrice, 8); // simplified i128 representation (low 64 bits)

            const timestampBytes = Buffer.alloc(8);
            timestampBytes.writeBigUInt64BE(BigInt(data.timestamp));

            const message = Buffer.concat([
                Buffer.from('BACKit:Outcome:'),
                callIdBytes,
                Buffer.from(':'),
                Buffer.from(outcomeBit),
                Buffer.from(':'),
                priceBytes,
                Buffer.from(':'),
                timestampBytes,
            ]);

            const signature = nacl.sign.detached(message, this.oracleKeypair.rawSecretKey());

            return Buffer.from(signature).toString('hex');
        } catch (error) {
            this.logger.error('Error signing outcome:', error);
            throw error;
        }
    }

    getPublicKey(): string {
        return this.oracleKeypair.publicKey();
    }
}
