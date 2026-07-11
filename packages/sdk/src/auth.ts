import * as fs from "node:fs";
import * as path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEVNET, apiBase } from "./config.js";

export interface AuthTokens {
  jwt: string;
  apiToken: string;
}

interface AuthCache {
  wallet: string;
  txSig: string;
  apiToken: string;
  activatedAt: string;
}

/**
 * TxLINE auth for a devnet wallet, per the verified flow:
 *   1. POST {origin}/auth/guest/start                      -> short-lived guest JWT
 *   2. txoracle.subscribe(serviceLevelId=1, weeks=4)       -> on-chain (free tier, fee-only)
 *   3. wallet-sign `${txSig}:${leagues.join(",")}:${jwt}`  -> base64 detached signature
 *   4. POST {origin}/api/token/activate                    -> long-lived apiToken
 *
 * The (txSig, apiToken) pair is cached on disk per wallet so restarts skip 2-4, and the
 * guest JWT is transparently re-acquired whenever a data call returns 401.
 */
export class TxLineAuth {
  private jwt = "";
  private apiToken = "";
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly wallet: Keypair,
    private readonly origin: string = DEVNET.txlineOrigin,
    private readonly cacheDir: string = ".keys",
  ) {}

  private get cachePath(): string {
    return path.join(this.cacheDir, `txline-auth-${this.wallet.publicKey.toBase58()}.json`);
  }

  private loadCache(): AuthCache | null {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as AuthCache;
    } catch {
      return null;
    }
  }

  private saveCache(cache: AuthCache): void {
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2));
  }

  /** Fetch a fresh guest JWT. Deduplicates concurrent refreshes. */
  async refreshJwt(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const res = await fetch(`${this.origin}/auth/guest/start`, { method: "POST" });
        if (!res.ok) {
          throw new Error(`guest/start failed: ${res.status} ${await res.text()}`);
        }
        const body = (await res.json()) as { token: string };
        this.jwt = body.token;
        this.refreshing = null;
        return this.jwt;
      })().catch((err) => {
        this.refreshing = null;
        throw err;
      });
    }
    return this.refreshing;
  }

  /** Returns valid tokens, running the full subscribe+activate flow on first use. */
  async getAuth(): Promise<AuthTokens> {
    if (!this.jwt) await this.refreshJwt();
    if (!this.apiToken) {
      const cached = this.loadCache();
      if (cached?.apiToken) {
        this.apiToken = cached.apiToken;
      } else {
        await this.subscribeAndActivate(cached?.txSig);
      }
    }
    return { jwt: this.jwt, apiToken: this.apiToken };
  }

  /**
   * Runs the on-chain subscribe (unless a previous txSig is supplied) and activates the
   * API token. Handles the "already subscribed" case by reusing the cached txSig.
   */
  private async subscribeAndActivate(previousTxSig?: string): Promise<void> {
    let txSig = previousTxSig;
    if (!txSig) {
      try {
        txSig = await this.subscribeOnChain();
      } catch (err) {
        // 6016 ActiveSubscription: wallet already subscribed but we lost the txSig needed
        // for activation. Only recovery is a fresh wallet (or the original signature).
        if (String(err).includes("ActiveSubscription") || String(err).includes("6016")) {
          throw new Error(
            `Wallet ${this.wallet.publicKey.toBase58()} already has an active TxLINE ` +
              `subscription but no cached activation txSig. Re-activate with the original ` +
              `subscribe signature or use a fresh wallet.`,
          );
        }
        throw err;
      }
    }

    // Free bundle => no selected leagues => message is `${txSig}::${jwt}`.
    const leagues: number[] = [];
    const message = `${txSig}:${leagues.join(",")}:${this.jwt}`;
    const signature = nacl.sign.detached(new TextEncoder().encode(message), this.wallet.secretKey);
    const walletSignature = Buffer.from(signature).toString("base64");

    const res = await fetch(`${apiBase(this.origin)}/token/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify({ txSig, walletSignature, leagues }),
    });
    if (!res.ok) {
      throw new Error(`token/activate failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { token?: string } | string;
    this.apiToken = typeof body === "string" ? body : (body.token ?? "");
    if (!this.apiToken) throw new Error("token/activate returned no token");

    this.saveCache({
      wallet: this.wallet.publicKey.toBase58(),
      txSig,
      apiToken: this.apiToken,
      activatedAt: new Date().toISOString(),
    });
  }

  /** Sends txoracle.subscribe(serviceLevelId, weeks) and returns the confirmed signature. */
  private async subscribeOnChain(): Promise<string> {
    const { makeTxoracleProgram } = await import("./txoracle.js");
    const program = makeTxoracleProgram(this.connection, this.wallet);
    const tokenMint = new PublicKey(DEVNET.txlMint);
    const user = this.wallet.publicKey;

    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      user,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pricing_matrix")],
      program.programId,
    );
    const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_treasury_v2")],
      program.programId,
    );
    const tokenTreasuryVault = getAssociatedTokenAddressSync(
      tokenMint,
      tokenTreasuryPda,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    const tx = new Transaction();

    // The subscribe instruction debits the user's TxL ATA (0 TxL on the free tier, but the
    // account must exist).
    const ataInfo = await this.connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          user,
          userTokenAccount,
          user,
          tokenMint,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }

    tx.add(
      await program.methods
        .subscribe(DEVNET.serviceLevelId, DEVNET.subscriptionWeeks)
        .accounts({
          user,
          pricingMatrix: pricingMatrixPda,
          tokenMint,
          userTokenAccount,
          tokenTreasuryVault,
          tokenTreasuryPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );

    const latest = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = user;
    tx.sign(this.wallet);

    const txSig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(
      { signature: txSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return txSig;
  }
}

/** Load a keypair from a Solana CLI JSON file. */
export function loadKeypair(filePath: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")) as number[]);
  return Keypair.fromSecretKey(secret);
}

// Re-exported so scripts can build an AnchorProvider around the same wallet.
export { anchor };
