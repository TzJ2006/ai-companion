# TypeScript Optimization Checks

> Target: TypeScript 5.x, ESM modules. Prefer strict mode (`"strict": true`). Applies to both Node.js and browser/React contexts.

## Language overrides

- **`const` by default**: TypeScript/JS community strongly prefers `const` over `let`; `let` only when reassignment is genuinely needed.

## 1. Simplification & Readability

- Use optional chaining (`a?.b?.c`) instead of nested null checks
- Use nullish coalescing (`??`) instead of `||` for default values (avoids falsy pitfalls)
- Replace `if/else` chains with early returns or `switch`/object lookup maps
- Use `Array.map`/`filter`/`reduce`/`flatMap` over manual loops where clearer
- Use template literals over string concatenation
- Use destructuring for function parameters and object access
- Replace `Promise.then().catch()` chains with `async/await`

## 2. Refactoring

- Replace magic string unions with `as const` objects or enums
- Use discriminated unions (`type Shape = Circle | Square`) for tagged variants
- Extract interfaces/types for object shapes passed between functions
- Replace `class` with plain functions + closures when no inheritance is needed
- Use barrel exports (`index.ts`) only at package boundaries, not within modules
- Replace `any` with proper types — `unknown` for truly unknown values, generics for reusable code

## 3. Idiomatic Style & Conventions

- **Strict mode**: `"strict": true` in `tsconfig.json` (enables `noImplicitAny`, `strictNullChecks`, etc.)
- `camelCase` for variables/functions, `PascalCase` for types/interfaces/classes
- Use `type` over `interface` for unions, intersections, and mapped types; `interface` for extendable contracts
- Prefer `readonly` on properties and `ReadonlyArray` for immutable data
- Use `satisfies` operator for type validation without widening (TS 5.0+)
- Avoid `namespace` — use ES module scope
- Prefer `unknown` over `any` in catch blocks: `catch (e: unknown)`

## 4. Performance

- Avoid creating objects/arrays inside render functions (React) — hoist or `useMemo`
- Use `Map`/`Set` over plain objects for frequent add/delete/lookup operations
- Avoid `JSON.parse(JSON.stringify())` for deep cloning — use `structuredClone()`
- Batch DOM reads/writes to avoid layout thrashing (browser context)
- Use `AbortController` for cancellable fetch requests
- Prefer `for...of` over `.forEach()` in hot paths (avoids closure allocation)
- Lazy import with `import()` for code splitting; avoid loading unused modules

## 5. Safety & Correctness

- **`any` type audit**: every `any` defeats type safety — replace with specific types or `unknown`
- **Prototype pollution**: flag `obj[userInput]` property access without validation
- **ReDoS**: flag complex regexes on user input (catastrophic backtracking)
- **XSS**: flag `dangerouslySetInnerHTML` (React) and `innerHTML` without sanitization
- **Injection**: flag string interpolation in SQL queries, shell commands, or eval
- **Supply chain**: flag `postinstall` scripts in `package.json` of dependencies
- **Secrets**: no API keys, tokens, or credentials in source; use environment variables
