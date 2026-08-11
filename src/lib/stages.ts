export type StageId = "ny" | "kontaktet" | "dialog" | "tilbud" | "vunnet" | "tapt";

export const STAGES: { id: StageId; label: string; dot: string }[] = [
  { id: "ny", label: "Nytt lead", dot: "#8e8e93" },
  { id: "kontaktet", label: "Kontaktet", dot: "#0071e3" },
  { id: "dialog", label: "Dialog", dot: "#5e5ce6" },
  { id: "tilbud", label: "Tilbud sendt", dot: "#ff9f0a" },
  { id: "vunnet", label: "Vunnet", dot: "#30d158" },
  { id: "tapt", label: "Tapt", dot: "#ff453a" },
];

export function stageLabel(id: string) {
  return STAGES.find((s) => s.id === id)?.label ?? id;
}

export function stageDot(id: string) {
  return STAGES.find((s) => s.id === id)?.dot ?? "#8e8e93";
}
