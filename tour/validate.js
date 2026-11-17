import validateSchema from "./.generated/schema-validator.cjs";

export const VERSION = "1.1.0";

export function validateTour(tour) {
  if (!validateSchema(tour)) {
    throw new Error(validateSchema.errors.map(({ instancePath, message }) =>
      `${instancePath || "/"} ${message}`).join("\n"));
  }
  const index = (items, label) => {
    const result = new Map();
    for (const item of items) {
      if (result.has(item.id)) throw new Error(`Duplicate ${label} ID: ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  if (tour.review) {
    const url = new URL(tour.review.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("The pull request URL must use HTTPS without credentials.");
  }
  const files = index(tour.files, "file");
  const cards = index(tour.cards, "card");
  const connections = index(tour.connections, "connection");
  const sourceLines = (source) => {
    const lines = source.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    return lines;
  };
  const checkRange = (range, bounds, context) => {
    if (range[0] > range[1] || range[0] < bounds[0] || range[1] > bounds[1])
      throw new Error(`${context}: range ${range} is outside ${bounds}`);
  };
  for (const file of files.values()) {
    if (file.sourceUrl) {
      const url = new URL(file.sourceUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Source links must be HTTPS URLs without credentials.");
    }
  }
  for (const card of cards.values()) {
    const file = files.get(card.file);
    if (!file) throw new Error(`Unknown file ${card.file} in card ${card.id}`);
    const start = file.startLine || 1;
    checkRange(card.range, [start, start + sourceLines(file.source).length - 1], card.id);
    for (const range of card.relevant || []) checkRange(range, card.range, card.id);
    for (const outline of card.outlines || []) checkRange(outline.lines, card.range, card.id);
    for (const line of card.changedLines || []) checkRange([line, line], card.range, card.id);
  }
  const checkTarget = (target) => {
    const card = cards.get(target.card);
    if (!card) throw new Error(`Unknown card ${target.card}`);
    checkRange(target.lines || [target.line, target.line], card.range, target.card);
  };
  for (const connection of connections.values()) {
    checkTarget(connection.from);
    checkTarget(connection.to);
  }
  const visibleCards = new Set();
  const visibleConnections = new Set();
  for (const [i, step] of tour.steps.entries()) {
    for (const id of step.revealCards) {
      if (!cards.has(id)) throw new Error(`Step ${i + 1}: unknown card ${id}`);
      visibleCards.add(id);
    }
    for (const id of step.revealConnections) {
      if (!connections.has(id)) throw new Error(`Step ${i + 1}: unknown connection ${id}`);
      visibleConnections.add(id);
    }
    for (const id of visibleConnections) {
      const edge = connections.get(id);
      if (!visibleCards.has(edge.from.card) || !visibleCards.has(edge.to.card))
        throw new Error(`Step ${i + 1}: connection ${id} has a hidden endpoint`);
    }
    for (const target of [step.focus, ...step.explanation.flatMap((part) => part.target ? [part.target] : [])]) {
      checkTarget(target);
      if (!visibleCards.has(target.card)) throw new Error(`Step ${i + 1}: reference to hidden card ${target.card}`);
    }
  }
  for (const id of cards.keys())
    if (!visibleCards.has(id)) throw new Error(`Card ${id} is never introduced`);
  for (const id of connections.keys())
    if (!visibleConnections.has(id)) throw new Error(`Connection ${id} is never introduced`);
  return tour;
}
