import {
  isConnected,
  setAllowed,
  signTransaction,
} from "@stellar/freighter-api";

export async function signWithFreighter(xdr: string) {
  const connected = await isConnected();
  if (!connected) {
    // Note: in a real app you'd check isAllowed() first, 
    // but setAllowed() handles the permission request.
    await setAllowed();
  }

  return signTransaction(xdr, {
    networkPassphrase: "PUBLIC",
  });
}
