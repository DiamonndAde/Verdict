/**
 * Generates two devnet-only "demo signer" keypairs the FRONTEND embeds so the create /
 * accept / settle flows run as real devnet transactions on camera with no wallet-extension
 * friction. These keys hold only worthless devnet SOL + dUSDC; they are throwaways, distinct
 * from the node-side .keys wallets, and are safe to ship in a public devnet demo bundle.
 *
 * Funds them from the project deployer wallet (a .keys wallet — never the personal CLI wallet)
 * and writes apps/web/src/data/demo-signers.json.
 *
 *   npx tsx scripts/setup-demo-signers.ts
 */
import * as fs from "node:fs";
import {
  createAssociatedTokenAccountIdempotent,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { loadKeypair } from "@verdict/sdk/auth";
import { DEVNET } from "@verdict/sdk/config";

const SOL_EACH = 0.25;
const DUSDC_EACH = 5_000n * 10n ** 6n;
const OUT = "apps/web/src/data/demo-signers.json";

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const deployer = loadKeypair(".keys/deployer.json");
  const mintInfo = JSON.parse(fs.readFileSync("tests/fixtures/dusdc-mint.json", "utf8"));
  const mint = new PublicKey(mintInfo.mint);

  // Reuse existing demo signers if present so the frontend address stays stable across runs.
  let creator: Keypair;
  let taker: Keypair;
  if (fs.existsSync(OUT)) {
    const j = JSON.parse(fs.readFileSync(OUT, "utf8"));
    creator = Keypair.fromSecretKey(Uint8Array.from(j.creator.secretKey));
    taker = Keypair.fromSecretKey(Uint8Array.from(j.taker.secretKey));
    console.log("reusing existing demo signers");
  } else {
    creator = Keypair.generate();
    taker = Keypair.generate();
    console.log("generated new demo signers");
  }

  for (const [name, kp] of [["creator", creator], ["taker", taker]] as const) {
    const bal = await connection.getBalance(kp.publicKey);
    if (bal < SOL_EACH * LAMPORTS_PER_SOL) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: kp.publicKey,
          lamports: Math.floor(SOL_EACH * LAMPORTS_PER_SOL),
        }),
      );
      await connection.sendTransaction(tx, [deployer]);
    }
    const ata = await createAssociatedTokenAccountIdempotent(connection, deployer, mint, kp.publicKey);
    await mintTo(connection, deployer, mint, ata, deployer, DUSDC_EACH);
    console.log(`  ${name} ${kp.publicKey.toBase58()} funded (${SOL_EACH} SOL + ${DUSDC_EACH / 10n ** 6n} dUSDC)`);
  }

  fs.mkdirSync("apps/web/src/data", { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        note: "DEVNET-ONLY throwaway demo signers. Worthless keys, safe to ship. Do not reuse on mainnet.",
        mint: mint.toBase58(),
        creator: { publicKey: creator.publicKey.toBase58(), secretKey: Array.from(creator.secretKey) },
        taker: { publicKey: taker.publicKey.toBase58(), secretKey: Array.from(taker.secretKey) },
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
