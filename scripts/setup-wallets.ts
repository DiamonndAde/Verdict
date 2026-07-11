/**
 * Creates the local devnet wallets (deployer, creator, taker) under .keys/ and tops
 * them up with devnet SOL. Idempotent: existing keys are kept, funded wallets skipped.
 *
 *   npm run setup-wallets
 */
import * as fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEVNET } from "@verdict/sdk/config";

const WALLETS = ["deployer", "creator", "taker"] as const;
const TARGET_SOL = 2;

function loadOrCreate(name: string): Keypair {
  const path = `.keys/${name}.json`;
  if (fs.existsSync(path)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.mkdirSync(".keys", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`created .keys/${name}.json -> ${kp.publicKey.toBase58()}`);
  return kp;
}

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");

  for (const name of WALLETS) {
    const kp = loadOrCreate(name);
    const balance = (await connection.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
    console.log(`${name}: ${kp.publicKey.toBase58()} — ${balance.toFixed(3)} SOL`);
    if (balance >= TARGET_SOL / 2) continue;

    for (const amount of [TARGET_SOL, 1, 0.5]) {
      try {
        const sig = await connection.requestAirdrop(kp.publicKey, amount * LAMPORTS_PER_SOL);
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
        console.log(`  airdropped ${amount} SOL`);
        break;
      } catch (err) {
        console.warn(`  airdrop of ${amount} SOL failed (${String(err).slice(0, 120)}); retrying smaller`);
      }
    }
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
