export interface SignedPriceData {
  asset: string;
  price: string;
  timestamp: number;
  signature: string; // hex-encoded Ed25519 signature
  publicKey: string; // hex-encoded Ed25519 public key
}

export interface PricePayload {
  asset: string;
  price: string;
  timestamp: number;
}

export interface OraclePublicKeyResponse {
  publicKey: string; // hex-encoded, for Soroban BytesN<32>
}
