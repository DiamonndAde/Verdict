import type { Wallet } from "@coral-xyz/anchor";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * A portable Anchor `Wallet` backed by a Keypair. Anchor's own `Wallet` class is only in the
 * Node build (`@coral-xyz/anchor`'s browser bundle omits it, because it reads keypair files),
 * so we implement the minimal interface here to keep the SDK isomorphic.
 */
export function keypairWallet(payer: Keypair): Wallet {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([payer]);
    else tx.partialSign(payer);
    return tx;
  };
  return {
    publicKey: payer.publicKey,
    payer,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  } as Wallet;
}
