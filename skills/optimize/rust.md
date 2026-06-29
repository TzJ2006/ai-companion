# Rust Optimization Checks

> Target: Rust 2021 edition. Prefer `thiserror`/`anyhow` for error handling. The compiler already enforces memory safety — focus on idiomatic usage, unnecessary overhead, and `unsafe` audit.

## Language overrides

- **Mutation via borrowing is idiomatic**: `&mut self` and `&mut T` are fundamental Rust patterns — do not flag mutable borrows as violations of immutability principles.
- **Performance IS the point**: Rust's zero-cost abstractions mean performance suggestions carry more weight than in GC'd languages. Don't dismiss micro-optimizations in hot paths.

## 1. Simplification & Readability

- Use `?` operator instead of explicit `match` on `Result`/`Option`
- Replace `if let Some(x) = ... { x } else { default }` with `.unwrap_or()` / `.unwrap_or_else()`
- Use iterator chains (`.iter().map().filter().collect()`) over manual loops
- Use pattern matching and destructuring in function arguments
- Replace `match` with `if let` / `let else` when only one variant matters
- Use `#[derive(...)]` for standard trait impls (Debug, Clone, PartialEq)
- Use `todo!()` / `unimplemented!()` over empty blocks for placeholders

## 2. Refactoring

- Replace stringly-typed fields with enums (algebraic data types)
- Use `From`/`Into` trait impls for type conversions instead of ad-hoc methods
- Extract trait interfaces for testability and abstraction
- Replace `Arc<Mutex<T>>` with message passing (`mpsc`/`crossbeam`) when appropriate
- Use newtype pattern (`struct Meters(f64)`) for domain-specific types
- Replace `Box<dyn Trait>` with generics when only one concrete type is used

## 3. Idiomatic Style & Conventions

- **Rust API Guidelines**: `snake_case` for functions, `PascalCase` for types, `SCREAMING_SNAKE` for constants
- Use `clippy` lint conventions: `#[must_use]`, `#[non_exhaustive]` on public enums
- Prefer `impl Trait` in argument position over `Box<dyn Trait>` for single callers
- Return `impl Iterator` instead of `Vec` when caller only iterates
- Use `Self` in impl blocks instead of repeating the type name
- Avoid `use super::*` — import specific items
- Prefer `to_owned()` / `to_string()` intent-based over `.clone()` for strings

## 4. Performance

- **Unnecessary `.clone()`**: flag clones that can be replaced with borrows or moves
- **Lifetime over-annotation**: simplify lifetimes where elision rules apply
- **Allocation in loops**: move `Vec::new()` / `String::new()` outside loops, reuse with `.clear()`
- **`Box<dyn Trait>` vs generics**: monomorphization avoids vtable dispatch in hot paths
- **`String` vs `&str`**: prefer `&str` in function parameters; accept `impl AsRef<str>`
- **Collection pre-allocation**: use `Vec::with_capacity()`, `HashMap::with_capacity()`
- **Avoid `collect()` then iterate**: chain iterators instead of materializing intermediate collections

## 5. Safety & Correctness

- **`unsafe` block audit**: every `unsafe` block must have a `// SAFETY:` comment justifying invariants
- **Raw pointer derefs**: flag `*ptr` without bounds/null checks
- **`transmute` usage**: almost always wrong — suggest safe alternatives
- **Integer overflow**: flag unchecked arithmetic in release mode (wrapping by default) — use `checked_add()` / `saturating_add()`
- **FFI boundaries**: validate C string/pointer inputs at the boundary
- **`unwrap()` / `expect()` in library code**: flag — return `Result` instead
- **`Send`/`Sync` manual impls**: flag as high-risk; require safety justification
