# Swift Optimization Checks

> Target: Swift 5.9+ / Swift 6.0. Prefer structured concurrency (`async/await`) over callback-based patterns.

## Language overrides

- **Mutation is idiomatic**: `mutating` methods on value types and `inout` parameters are preferred Swift patterns — do not flag these as violations of immutability principles.
- **Protocol-oriented design** over class inheritance is the Swift default.

## 1. Simplification & Readability

- Use `guard let` / `guard else` for early exits instead of nested `if let`
- Use optional chaining (`a?.b?.c`) instead of nested nil checks
- Replace `if let x = x` with shorthand `if let x` (Swift 5.7+)
- Use `map`/`compactMap`/`flatMap`/`filter` on collections and optionals
- Replace manual `switch` exhaustiveness with `@unknown default`
- Use trailing closure syntax and `$0`/`$1` for short closures
- Use multi-line string literals for complex strings

## 2. Refactoring

- Replace raw dictionaries with `struct` or `enum` with associated values
- Use `Codable` for serialization instead of manual JSON parsing
- Extract protocols for testability (protocol-oriented dependency injection)
- Replace class inheritance hierarchies with protocol composition
- Use `Result` type for error propagation in non-async contexts
- Replace stringly-typed APIs with enums or `RawRepresentable` types

## 3. Idiomatic Style & Conventions

- **Swift API Design Guidelines**: clarity at the point of use, fluent naming
- `camelCase` for functions/properties, `PascalCase` for types/protocols
- Prefer value types (`struct`, `enum`) over reference types (`class`) by default
- Use `let` over `var` whenever possible
- Use access control: `private`/`fileprivate` for implementation details
- Prefer `Swift.Error` conformance with descriptive cases over string errors
- Use `typealias` to clarify complex generic signatures

## 4. Performance

- Avoid unnecessary `class` when `struct` suffices (heap allocation overhead)
- Watch for unintended reference cycles in closures — use `[weak self]` or `[unowned self]`
- Avoid excessive ARC overhead: minimize temporary object creation in hot loops
- Use `ContiguousArray` for non-class element types in performance-critical paths
- Prefer `lazy var` for expensive computed properties accessed conditionally
- Use `withUnsafeBufferPointer` for bulk data processing instead of element-wise access
- Avoid repeated `String` ↔ `NSString` bridging in loops

## 5. Safety & Correctness

- **Force unwrap audit**: flag `!` on optionals — prefer `guard let`, `if let`, or `??`
- **Retain cycles**: closures capturing `self` in classes must use capture lists
- **Concurrency**: flag shared mutable state without `actor` or `@Sendable` annotation (Swift 6)
- **Keychain vs UserDefaults**: secrets must use Keychain, not UserDefaults/plist
- **ATS exceptions**: flag `NSAllowsArbitraryLoads` in Info.plist
- **Input validation**: validate URL/user inputs before creating `URL(string:)` or file paths
- **Crypto**: flag `CC_MD5`/`CC_SHA1` for sensitive data — use `CryptoKit`
