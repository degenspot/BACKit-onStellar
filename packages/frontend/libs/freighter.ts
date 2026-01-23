import {
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export async function signWithFreighter(xdr: string) {
  const connected = await isConnected();
  if (!connected) {
    await requestAccess();
  }

  return signTransaction(xdr, {
    networkPassphrase: "PUBLIC",
  });
}
