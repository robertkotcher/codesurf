import typescript from './typescript.js';
import python from './python.js';
import ruby from './ruby.js';

// Add/remove an adapter here; graph selection and rendering are language-independent.
export const languageAdapters = Object.freeze([typescript, python, ruby]);
export function validateIndex(id, result) {
  if (!result || !Array.isArray(result.definitions) || !result.sources || !Array.isArray(result.diagnostics))
    throw new Error(`${id} returned an invalid index`);
  const ids = new Set();
  for (const node of result.definitions) {
    if (typeof node.id !== 'string' || ids.has(node.id) || typeof node.file !== 'string' ||
        !Array.isArray(result.sources[node.file]) || !Number.isInteger(node.start) ||
        !Number.isInteger(node.end) || node.start < 1 || node.end < node.start ||
        !Array.isArray(node.lines) || !Array.isArray(node.calls) || !Array.isArray(node.changed))
      throw new Error(`${id} returned an invalid or duplicate definition`);
    ids.add(node.id);
  }
}
