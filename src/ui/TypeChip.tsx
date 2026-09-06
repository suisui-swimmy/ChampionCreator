import type { CSSProperties } from "react";
import typeOptions from "../data/generated/type-options.gen.json";

const typeColors = new Map(typeOptions.entries.map((entry) => [entry.showdownName, entry.color]));

export function TypeChip({ canonicalName, label }: { canonicalName: string; label: string }) {
  const color = typeColors.get(canonicalName);
  if (!color) return <span>{label}</span>;

  return (
    <span
      className={`type-chip${canonicalName === "Stellar" ? " type-chip--stellar" : ""}`}
      data-type={canonicalName}
      style={{ "--type-color": color } as CSSProperties}
    >
      <span className="type-chip-label">{label}</span>
    </span>
  );
}
