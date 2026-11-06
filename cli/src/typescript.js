import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".turbo",
  "venv",
  "env",
  "__pycache__",
  "site-packages",
]);
function filesIn(root) {
  const result = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !ignored.has(e.name) && !e.name.startsWith("."))
        walk(path.join(dir, e.name));
      else if (
        e.isFile() &&
        /\.[cm]?[jt]sx?$/.test(e.name) &&
        !e.name.endsWith(".d.ts")
      )
        result.push(path.join(dir, e.name));
    }
  }
  walk(root);
  return result;
}

export function analyze(
  roots,
  question,
  { entry, depth = 4, limit = 36, catalog = false } = {},
) {
  roots = roots.map((r) => fs.realpathSync(r));
  const files = roots.flatMap(filesIn);
  if (!files.length)
    throw new Error("No JavaScript or TypeScript source files found.");
  const options = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  };
  // Each repository has its own aliases. Resolve imports using the containing repository's config.
  const configs = roots.map((root) => {
    const config =
      ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json") ||
      ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json");
    if (!config) return options;
    const read = ts.readConfigFile(config, ts.sys.readFile);
    return {
      ...options,
      ...ts.parseJsonConfigFileContent(
        read.config || {},
        ts.sys,
        path.dirname(config),
      ).options,
    };
  });
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containing) => {
    const i = roots.findIndex((root) => containing.startsWith(root + path.sep));
    return names.map(
      (name) =>
        ts.resolveModuleName(name, containing, configs[i] || options, ts.sys)
          .resolvedModule,
    );
  };
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const nodes = [],
    byDeclaration = new Map();
  function relative(file) {
    const root = roots.find((r) => file.startsWith(r + path.sep));
    return (
      (roots.length > 1 ? path.basename(root) + "/" : "") +
      path.relative(root, file)
    );
  }
  for (const file of files) {
    const sf = program.getSourceFile(file);
    function visit(n) {
      if (
        (ts.isFunctionDeclaration(n) ||
          ts.isMethodDeclaration(n) ||
          ts.isArrowFunction(n) ||
          ts.isFunctionExpression(n)) &&
        n.body
      ) {
        const name =
          n.name?.getText(sf) ||
          (ts.isVariableDeclaration(n.parent)
            ? n.parent.name.getText(sf)
            : "anonymous");
        const start = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const end = sf.getLineAndCharacterOfPosition(n.end).line + 1;
        const node = {
          id: String(nodes.length),
          name,
          file: relative(file),
          absolute: file,
          start,
          end,
          lines: sf.text.split(/\r?\n/).slice(start - 1, end),
          inputs: n.parameters.map(p => ({
            name: p.name.getText(sf),
            type: checker.typeToString(checker.getTypeAtLocation(p), p, ts.TypeFormatFlags.NoTruncation),
            optional: Boolean(p.questionToken || p.initializer),
            rest: Boolean(p.dotDotDotToken),
            inferred: !p.type,
          })),
          output: (() => {
            const signature = checker.getSignatureFromDeclaration(n);
            return {type: signature ? checker.typeToString(checker.getReturnTypeOfSignature(signature), n, ts.TypeFormatFlags.NoTruncation) : "unknown", inferred: !n.type};
          })(),
          calls: [],
          changed: [],
          ast: n,
          sf,
        };
        nodes.push(node);
        byDeclaration.set(n, node);
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }
  for (const node of nodes) {
    function visit(n) {
      if (n !== node.ast && byDeclaration.has(n)) return;
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const declaration = checker.getResolvedSignature(n)?.declaration;
        let target = byDeclaration.get(declaration);
        if (!target) {
          let symbol = checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(n.expression)
              ? n.expression.name
              : n.expression,
          );
          if (symbol?.flags & ts.SymbolFlags.Alias)
            symbol = checker.getAliasedSymbol(symbol);
          target = symbol?.declarations
            ?.map(
              (d) => byDeclaration.get(d) || byDeclaration.get(d.initializer),
            )
            .find(Boolean);
        }
        const expression = n.expression;
        const nameNode = ts.isPropertyAccessExpression(expression)
          ? expression.name
          : expression;
        const nameLocation = node.sf.getLineAndCharacterOfPosition(
          nameNode.getStart(node.sf),
        );
        node.calls.push({
          target: target?.id || null,
          label: expression.getText(node.sf),
          line: nameLocation.line + 1,
          column: nameLocation.character,
          length: nameNode.getWidth(node.sf),
          kind: target ? "resolved" : "boundary",
        });
      }
      ts.forEachChild(n, visit);
    }
    visit(node.ast);
  }
  // Git supplies changed line ranges; source content always comes from the working tree.
  for (const root of roots) {
    try {
      const diff = execFileSync(
        "git",
        [
          "-C",
          root,
          "diff",
          "HEAD",
          "--no-ext-diff",
          "--no-color",
          "--unified=0",
          "--",
          "*.ts",
          "*.tsx",
          "*.js",
          "*.jsx",
        ],
        {
          encoding: "utf8",
          maxBuffer: 10e6,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      let file;
      for (const line of diff.split("\n")) {
        if (line.startsWith("+++ b/")) file = path.join(root, line.slice(6));
        const match = /^@@ .* \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (match) {
          const from = Number(match[1]),
            count = Number(match[2] ?? 1);
          for (const node of nodes.filter((n) => n.absolute === file))
            for (
              let l = Math.max(from, node.start);
              l < from + count && l <= node.end;
              l++
            )
              node.changed.push(l);
        }
      }
    } catch {
      /* A report also works for directories without Git history. */
    }
  }
  const stop = new Set(
    "trace show what when happens endpoint called the a an to of in and is does how me all relevant execution path call service for".split(
      " ",
    ),
  );
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1 && !stop.has(t));
  const route = question.match(/\/[a-zA-Z0-9_/[\]-]+/)?.[0];
  const method = question
    .match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i)?.[0]
    .toUpperCase();
  const ranked = nodes
    .map((n) => {
      const haystack = `${n.name} ${n.file}`.toLowerCase();
      let score = terms.reduce(
        (s, t) =>
          s +
          (n.name.toLowerCase() === t
            ? 10
            : haystack.includes(t)
              ? 3
              : n.lines.join("\n").toLowerCase().includes(t)
                ? 0.2
                : 0),
        0,
      );
      if (route && n.file.includes(route.replace(/^\//, "") + "/route."))
        score += 30;
      if (method && n.name === method) score += 3;
      return { n, score };
    })
    .sort((a, b) => b.score - a.score);
  const seed = entry
    ? nodes.find(
        (n) =>
          `${n.file}#${n.name}` === entry ||
          `${n.absolute}#${n.name}` === entry,
      )
    : ranked[0]?.score > 0
      ? ranked[0].n
      : null;
  if (!seed && !catalog)
    throw new Error(
      entry
        ? `Entry not found: ${entry}`
        : "No matching entry. Use --entry relative/file.ts#functionName.",
    );
  const definitions = nodes.map(({ ast, sf, ...n }) => n);
  const diagnostics = program
    .getSyntacticDiagnostics()
    .map(
      (d) =>
        `${d.file?.fileName || "TypeScript"}:${d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
    );
  const sources = Object.fromEntries(
    files.map((file) => [
      relative(file),
      fs.readFileSync(file, "utf8").split(/\r?\n/),
    ]),
  );
  function getSymbolData(selectedFiles) {
    const symbolRefs = {},
      symbolDefinitions = {};
    function describe(declaration, name) {
      const known =
        byDeclaration.get(declaration) ||
        byDeclaration.get(declaration.initializer);
      if (known) return known.id;
      const sf = declaration.getSourceFile(),
        absolute = sf.fileName;
      const local = files.includes(absolute),
        start =
          sf.getLineAndCharacterOfPosition(declaration.getStart(sf)).line + 1;
      const declaredEnd =
          sf.getLineAndCharacterOfPosition(declaration.end).line + 1,
        end = Math.min(declaredEnd, start + 39);
      const id = `symbol:${absolute}:${declaration.pos}`;
      if (!symbolDefinitions[id])
        symbolDefinitions[id] = {
          id,
          name,
          file: local ? relative(absolute) : absolute,
          absolute,
          start,
          end,
          declaredEnd,
          lines: sf.text.split(/\r?\n/).slice(start - 1, end),
          calls: [],
          changed: [],
          external: !local,
          reason: local
            ? "Compiler-resolved symbol declaration."
            : "Installed dependency/type declaration; implementation may live elsewhere.",
        };
      return id;
    }
    for (const file of [...new Set(selectedFiles)]) {
      const absolute = files.find((f) => relative(f) === file),
        sf = absolute && program.getSourceFile(absolute);
      if (!sf) continue;
      const imports = new Map(),
        refs = [];
      for (const statement of sf.statements)
        if (ts.isImportDeclaration(statement) && statement.importClause) {
          const module = statement.moduleSpecifier.text,
            clause = statement.importClause;
          if (clause.name) imports.set(clause.name.text, module);
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings))
            imports.set(bindings.name.text, module);
          else if (bindings)
            for (const element of bindings.elements)
              imports.set(element.name.text, module);
        }
      function visit(n) {
        if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
          const location = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          let symbol = checker.getSymbolAtLocation(n),
            module = imports.get(n.text) || "";
          if (ts.isPropertyAccessExpression(n.parent)) {
            let base = n.parent.expression;
            while (ts.isPropertyAccessExpression(base)) base = base.expression;
            if (ts.isIdentifier(base))
              module = imports.get(base.text) || module;
          }
          if (symbol?.flags & ts.SymbolFlags.Alias)
            symbol = checker.getAliasedSymbol(symbol);
          const declaration =
            symbol?.valueDeclaration || symbol?.declarations?.[0];
          const target = declaration ? describe(declaration, n.text) : null;
          refs.push({
            line: location.line + 1,
            column: location.character,
            length: n.getWidth(sf),
            text: n.text,
            target,
            module,
          });
        }
        ts.forEachChild(n, visit);
      }
      visit(sf);
      symbolRefs[file] = refs;
    }
    return { symbolRefs, symbolDefinitions };
  }
  if (catalog)
    return {
      question,
      roots,
      definitions,
      sources,
      getSymbolData,
      parserVersion: ts.version,
      diagnostics,
      scanned: files.length,
      symbols: nodes.length,
      depth,
      limit,
    };
  const selected = new Map(),
    queue = [{ id: seed.id, level: 0 }];
  while (queue.length && selected.size < limit) {
    const item = queue.shift();
    if (selected.has(item.id)) continue;
    const n = nodes[Number(item.id)];
    selected.set(n.id, { ...n, level: item.level });
    if (item.level < depth)
      for (const c of n.calls)
        if (c.target) queue.push({ id: c.target, level: item.level + 1 });
  }
  const result = [...selected.values()].map(({ ast, sf, ...n }) => n);
  return {
    question,
    roots,
    entry: seed.id,
    nodes: result,
    definitions,
    sources,
    ...getSymbolData(result.map((n) => n.file)),
    mode: "static",
    candidates: ranked
      .slice(0, 8)
      .map(({ n, score }) => ({ file: n.file, name: n.name, score })),
    scanned: files.length,
    symbols: nodes.length,
    depth,
    limit,
    generated: new Date().toISOString(),
    note: "Static call relationships, not a recorded runtime trace. Branches and calls are shown in source order, not guaranteed execution order. Unresolved calls are boundaries; dynamic dispatch and cross-service HTTP links are not inferred.",
  };
}
