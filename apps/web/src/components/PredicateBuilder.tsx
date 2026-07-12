import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { compilePredicate, describeCondition, type Condition, type Metric, type Scope } from "@verdict/sdk/verdict";
import { sides } from "@/lib/appData";
import { spring } from "@/lib/motion";

const METRICS: { value: Metric; label: string }[] = [
  { value: "corners", label: "Corners" },
  { value: "goals", label: "Goals" },
  { value: "yellow_cards", label: "Yellow cards" },
];

const SCOPES: { value: Scope; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "home", label: sides.participant1IsHome ? sides.participant1 : sides.participant2 },
  { value: "away", label: sides.participant1IsHome ? sides.participant2 : sides.participant1 },
];

const COMPARATORS: { value: Condition["comparator"]; label: string }[] = [
  { value: "over", label: "Over" },
  { value: "under", label: "Under" },
];

export function PredicateBuilder({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  const sentence = useMemo(() => describeCondition(value, sides), [value]);
  // Confirm it compiles (guards against unsupported combos) — surfaces nothing if fine.
  useMemo(() => compilePredicate(value, sides), [value]);

  const set = (patch: Partial<Condition>) => onChange({ ...value, ...patch });
  const isHalf = !Number.isInteger(value.threshold);

  return (
    <div className="space-y-5">
      <Segmented label="Metric" options={METRICS} value={value.metric} onSelect={(m) => set({ metric: m })} name="metric" />
      <Segmented label="Whose" options={SCOPES} value={value.scope} onSelect={(s) => set({ scope: s })} name="scope" />
      <Segmented label="Line" options={COMPARATORS} value={value.comparator} onSelect={(c) => set({ comparator: c })} name="cmp" />

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-widest text-chalk-faint">Threshold</div>
        <div className="flex items-center gap-3">
          <Stepper onClick={() => set({ threshold: Math.max(0.5, value.threshold - 1) })} label="−" />
          <div className="min-w-[64px] rounded-xl border border-line bg-pitch-850 px-4 py-2 text-center">
            <span className="display text-2xl font-bold text-volt tabular-nums">
              <NumberFlow value={value.threshold} />
            </span>
          </div>
          <Stepper onClick={() => set({ threshold: value.threshold + 1 })} label="+" />
          <button
            onClick={() => set({ threshold: isHalf ? Math.round(value.threshold) : value.threshold + 0.5 })}
            className="rounded-lg border border-line px-3 py-2 text-xs text-chalk-dim hover:border-volt/40 hover:text-volt"
            title="Toggle a half-line to avoid exact ties"
          >
            {isHalf ? ".5 line" : "whole"}
          </button>
        </div>
      </div>

      {/* Live sentence preview */}
      <div className="rounded-xl border border-volt/30 bg-volt/5 px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-chalk-faint">Your call</div>
        <div className="display mt-1 text-xl font-semibold text-chalk">
          “{sentence}”
        </div>
        <div className="mt-1 text-xs text-chalk-dim">You win if this is TRUE at full time.</div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
  name,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
  name: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-widest text-chalk-faint">{label}</div>
      <div className="flex gap-1 rounded-xl border border-line bg-pitch-900 p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onSelect(o.value)}
              className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "text-pitch-950" : "text-chalk-dim hover:text-chalk"}`}
            >
              {active && (
                <motion.div
                  layoutId={`seg-${name}`}
                  transition={spring}
                  className="absolute inset-0 rounded-lg bg-volt"
                  style={{ zIndex: 0 }}
                />
              )}
              <span className="relative z-10 whitespace-nowrap">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      whileHover={{ y: -1 }}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-xl border border-line bg-pitch-800 text-xl text-chalk hover:border-volt/50 hover:text-volt"
    >
      {label}
    </motion.button>
  );
}
