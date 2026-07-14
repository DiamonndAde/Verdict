import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  compilePredicate,
  defaultExpiryUnix,
  defaultSettleAfterMs,
  type Condition,
} from "@verdict/sdk/verdict";
import { PredicateBuilder } from "@/components/PredicateBuilder";
import { Button, Card } from "@/components/ui";
import { fixture, sides } from "@/lib/appData";
import { BN, createMarket, demoCreator } from "@/lib/solana";
import { setDemoRole } from "@/lib/demoRole";

export function Create() {
  const navigate = useNavigate();
  const [condition, setCondition] = useState<Condition>({
    metric: "corners",
    scope: "total",
    comparator: "over",
    threshold: 9.5,
  });
  const [stake, setStake] = useState(100);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const predicate = compilePredicate(condition, sides);
      const seed = new BN(Date.now());
      const { market } = await createMarket(demoCreator, {
        seed,
        fixtureId: fixture.fixtureId,
        stake: new BN(Math.round(stake * 1_000_000)),
        predicate,
        settleAfterMs: defaultSettleAfterMs(fixture.startTime, fixture.knockout === true),
        expiryUnix: defaultExpiryUnix(fixture.startTime),
      });
      // This tab created the challenge, so it is the creator; the opponent opens the link
      // in another tab (a fresh session that defaults to taker).
      setDemoRole("creator");
      navigate(`/c/${market.toBase58()}`);
    } catch (err) {
      alert(`Create failed: ${String(err).slice(0, 200)}`);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-chalk">Build your challenge</h1>
        <p className="mt-1 text-sm text-chalk-dim">
          {sides.participant1IsHome ? sides.participant1 : sides.participant2} vs{" "}
          {sides.participant1IsHome ? sides.participant2 : sides.participant1} · {fixture.competition}
        </p>
      </div>

      <Card className="p-6">
        <PredicateBuilder value={condition} onChange={setCondition} />
      </Card>

      <Card className="flex items-center justify-between gap-4 p-6">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-chalk-faint">Your stake</div>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={stake}
              onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
              className="w-24 rounded-lg border border-line bg-pitch-850 px-3 py-2 text-lg font-semibold text-chalk tabular-nums outline-none focus:border-volt/60"
            />
            <span className="text-sm text-chalk-dim">dUSDC</span>
          </div>
        </div>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Escrowing…" : "Create & escrow"}
        </Button>
      </Card>

      <p className="text-center text-xs text-chalk-faint">
        Signed by an embedded devnet demo wallet — no extension needed. Creating escrows your
        stake into a program-owned vault; you can cancel any time before someone accepts.
      </p>
    </div>
  );
}
