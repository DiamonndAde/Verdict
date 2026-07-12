import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { fetchMarket, type MarketAccount } from "./solana";

/** Polls a market account so the UI reflects on-chain truth (status, taker, Outcome). */
export function useMarket(marketKey: string | null, pollMs = 4000) {
  const [market, setMarket] = useState<MarketAccount | null>(null);
  const [loading, setLoading] = useState(!!marketKey);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!marketKey) return;
    try {
      const m = await fetchMarket(new PublicKey(marketKey));
      setMarket(m);
    } finally {
      setLoading(false);
    }
  }, [marketKey]);

  useEffect(() => {
    setLoading(!!marketKey);
    setMarket(null);
    if (!marketKey) return;
    refresh();
    timer.current = setInterval(refresh, pollMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [marketKey, pollMs, refresh]);

  return { market, loading, refresh, setMarket };
}
