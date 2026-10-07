"use client";

import { useEffect, useMemo, useState } from "react";
import { composeEnvelope, defaultLibrary, eligibleRecipes, RECIPES, type RecipeId } from "@mailart/envelope";
import { EnvelopeFront } from "@/components/Stage";

const NAMES = ["Margaret Okafor", "Theo Lindqvist", "Ana Paula", "Mr. J. Whitcombe", "Priya", "Dear Old Felix", "Hollis & June", "Wen Li", "Rosalind Fairweather-Hughes", "Sam"];
const LINES = ["c/o the 4th floor", "", "Flat 2, the blue door", "", "wherever you are now", "", "Poste Restante"];
const CITIES = ["Lisbon", "Toronto", "Kyoto", "Marseille", "Oaxaca", "Edinburgh", "Valparaíso", "Brooklyn"];

/** Contact sheet of 24 envelopes from random seeds. The only page that rolls dice: seeds, not envelopes. */
export default function Gallery() {
  const [batch, setBatch] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeId | "">("");
  const [count, setCount] = useState(24);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setBatch(p.get("batch") ?? Math.random().toString(36).slice(2, 8));
    setRecipe((p.get("recipe") as RecipeId) ?? "");
    if (p.get("n")) setCount(Math.max(1, Math.min(48, Number(p.get("n")))));
  }, []);
  const eligible = eligibleRecipes(defaultLibrary);
  const items = useMemo(() => {
    if (!batch) return [];
    return Array.from({ length: count }, (_, i) => {
      const seed = `${batch}-${i}`;
      const spec = composeEnvelope(
        {
          seed,
          recipientName: NAMES[i % NAMES.length],
          addressLine: LINES[i % LINES.length] || undefined,
          senderCity: CITIES[i % CITIES.length],
          sentAt: "2026-10-07T12:00:00Z",
          recipe: recipe || undefined,
        },
        defaultLibrary,
      );
      return { seed, spec };
    });
  }, [batch, recipe, count]);

  const reroll = (r = recipe) => {
    const b = Math.random().toString(36).slice(2, 8);
    history.replaceState(null, "", `?batch=${b}${r ? `&recipe=${r}` : ""}`);
    setBatch(b);
  };

  return (
    <main style={{ padding: "24px 20px 60px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ fontSize: 30, marginRight: 12 }}>Envelope gallery</h1>
        <span className="kicker" data-batch={batch ?? ""}>batch {batch}</span>
        <select className="input" style={{ width: "auto" }} value={recipe} onChange={(e) => { const r = e.target.value as RecipeId | ""; setRecipe(r); reroll(r); }}>
          <option value="">all recipes</option>
          {RECIPES.map((r) => (
            <option key={r} value={r} disabled={!eligible.includes(r)}>{r}</option>
          ))}
        </select>
        <button className="btn" onClick={() => reroll()}>Reroll</button>
        <span className="kicker">{defaultLibrary.length} assets</span>
      </div>
      <div className="gallery-grid">
        {items.map(({ seed, spec }) => (
          <figure key={seed} className="gallery-item" data-recipe={spec.recipe} data-layers={spec.layers.length}>
            <EnvelopeFront spec={spec} />
            <figcaption className="kicker" style={{ marginTop: 8 }}>
              {spec.recipe} · {seed} · {spec.layers.length} elements
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
