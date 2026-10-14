import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400 font-semibold",
  secondary: "border border-ink-700 bg-ink-850 text-zinc-200 hover:bg-ink-800 hover:border-zinc-600",
  ghost: "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500 font-semibold",
  ai: "bg-violet-500 text-white hover:bg-violet-400 font-semibold",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-7 px-2.5 text-xs gap-1.5" : "h-9 px-3.5 text-sm gap-2";
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40 ${sizing} ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`rounded-2xl border border-ink-700 bg-ink-900/80 ${className}`} />;
}

export function Badge({ tone = "zinc", children }: { tone?: "zinc" | "emerald" | "violet" | "amber" | "rose" | "sky"; children: ReactNode }) {
  const tones = {
    zinc: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-500/25",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
    rose: "bg-rose-500/10 text-rose-300 ring-rose-500/25",
    sky: "bg-sky-500/10 text-sky-300 ring-sky-500/25",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`animate-spin ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-emerald-400 text-[13px] font-bold text-ink-950">
        C
      </span>
      <span className="text-sm font-semibold tracking-tight">Copiloto</span>
    </Link>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-800 text-zinc-400">{icon}</div>
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      {children && <div className="max-w-sm text-xs leading-relaxed text-zinc-500">{children}</div>}
    </div>
  );
}
