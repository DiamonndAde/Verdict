/**
 * Creates the demo escrow token — "dUSDC", a 6-decimal SPL mint we control — and airdrops
 * a balance to the creator and taker demo wallets. No external token dependency; the mint
 * authority is the deployer wallet.
 *
 * Writes the mint address to tests/fixtures/dusdc-mint.json.
 *
 *   npx tsx scripts/setup-dusdc.ts
 */
import * as fs from "node:fs";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair } from "@solana/web3.js";
import { loadKeypair } from "@verdict/sdk/auth";
import { DEVNET } from "@verdict/sdk/config";

const DECIMALS = 6;
const AIRDROP = 10_000n * 10n ** BigInt(DECIMALS); // 10,000 dUSDC each

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const deployer = loadKeypair(".keys/deployer.json");
  const creator = loadKeypair(".keys/creator.json");
  const taker = loadKeypair(".keys/taker.json");

  const cachePath = "tests/fixtures/dusdc-mint.json";
  let mint;
  if (fs.existsSync(cachePath)) {
    const { mint: cached } = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    mint = new (await import("@solana/web3.js")).PublicKey(cached);
    console.log(`reusing existing dUSDC mint ${mint.toBase58()}`);
  } else {
    mint = await createMint(connection, deployer, deployer.publicKey, null, DECIMALS);
    fs.mkdirSync("tests/fixtures", { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ mint: mint.toBase58(), decimals: DECIMALS, authority: deployer.publicKey.toBase58() }, null, 2));
    console.log(`created dUSDC mint ${mint.toBase58()}`);
  }

  for (const [name, wallet] of [["creator", creator], ["taker", taker]] as const) {
    const ata = await createAssociatedTokenAccountIdempotent(connection, deployer, mint, (wallet as Keypair).publicKey);
    await mintTo(connection, deployer, mint, ata, deployer, AIRDROP);
    console.log(`  minted ${AIRDROP / 10n ** BigInt(DECIMALS)} dUSDC to ${name} (${ata.toBase58()})`);
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
