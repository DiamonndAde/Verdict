import { motion } from "motion/react";
import { forwardRef, useState, type ReactNode } from "react";
import { keyHue, short } from "@/lib/format";
import { spring } from "@/lib/motion";

type ButtonVariant = "volt" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    onClick?: () => void;
    variant?: ButtonVariant;
    disabled?: boolean;
    type?: "button" | "submit";
    className?: string;
    title?: string;
  }
>(function Button({ children, onClick, variant = "volt", disabled, type = "button", className = "", title }, ref) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold tracking-wide select-none disabled:opacity-40 disabled:pointer-events-none transition-colors";
  const styles: Record<ButtonVariant, string> = {
    volt: "bg-volt text-pitch-950 hover:bg-volt-bright",
    ghost: "bg-pitch-800 text-chalk border border-line hover:border-volt/50 hover:text-volt-bright",
    danger: "bg-flag-red/15 text-flag-red border border-flag-red/40 hover:bg-flag-red/25",
  };
  return (
    <motion.button
      ref={ref}
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      whileHover={{ y: -1.5 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={`${base} ${styles[variant]} ${variant === "volt" ? "hover:shadow-[0_0_24px_-6px_rgba(199,249,78,0.7)]" : ""} ${className}`}
    >
      {children}
    </motion.button>
  );
});

export function Card({ children, className = "", glow = false }: { children: ReactNode; className?: string; glow?: boolean }) {
  return <div className={`card ${glow ? "volt-glow" : ""} ${className}`}>{children}</div>;
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-pitch-800 px-3 py-1 text-xs font-medium text-chalk-dim ${className}`}>
      {children}
    </span>
  );
}

/** Deterministic geometric identicon from a pubkey — no external avatars. */
export function Identicon({ pubkey, size = 40 }: { pubkey: string; size?: number }) {
  const hue = keyHue(pubkey);
  return (
    <div
      className="rounded-lg border border-line"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from ${hue}deg, hsl(${hue} 70% 45%), hsl(${(hue + 90) % 360} 70% 40%), hsl(${(hue + 200) % 360} 65% 42%), hsl(${hue} 70% 45%))`,
      }}
      aria-hidden
    />
  );
}

/** Mono hash with middle truncation and a copy affordance. */
export function HashBadge({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button
      onClick={copy}
      title={value}
      className={`group inline-flex items-center gap-2 rounded-md border border-line bg-pitch-950/60 px-2.5 py-1 mono text-xs text-chalk-dim hover:border-volt/40 hover:text-chalk ${className}`}
    >
      {label && <span className="text-chalk-faint">{label}</span>}
      <span>{short(value, 6, 6)}</span>
      <span className={`text-[10px] ${copied ? "text-volt" : "text-chalk-faint group-hover:text-volt/70"}`}>{copied ? "copied" : "copy"}</span>
    </button>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full bg-line ${className}`} />;
}

export function VoltText({ children }: { children: ReactNode }) {
  return <span className="text-volt">{children}</span>;
}
