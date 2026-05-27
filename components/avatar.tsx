"use client";

const COLORS = [
  "bg-violet-600",
  "bg-cyan-600",
  "bg-emerald-600",
  "bg-amber-500",
  "bg-rose-500",
  "bg-blue-600",
  "bg-teal-600",
  "bg-fuchsia-600",
  "bg-orange-500",
  "bg-sky-600",
  "bg-indigo-600",
  "bg-pink-600",
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = seed.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h);
}

function avatarColor(seed: string): string {
  return COLORS[hash(seed) % COLORS.length] ?? COLORS[0]!;
}

function initials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/);
  if (parts.length >= 2 && /^[a-zA-Z]/.test(parts[0]!)) {
    return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
  }
  return t.charAt(0).toUpperCase();
}

export function Avatar({
  name,
  isGroup,
  size = "md",
}: {
  name: string;
  isGroup: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  const bgClass = avatarColor((isGroup ? "g:" : "u:") + name);
  return (
    <div
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm ${sizeClass} ${bgClass}`}
    >
      {initials(name)}
    </div>
  );
}
