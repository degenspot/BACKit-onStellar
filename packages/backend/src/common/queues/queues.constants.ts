export const QUEUE_IPFS_PINNING = 'ipfs-pinning';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_ORACLE_SIGNING = 'oracle-signing';
export const QUEUE_DEAD_LETTER = 'dead-letter';

export type QueueName =
  | typeof QUEUE_IPFS_PINNING
  | typeof QUEUE_NOTIFICATIONS
  | typeof QUEUE_ORACLE_SIGNING
  | typeof QUEUE_DEAD_LETTER;

