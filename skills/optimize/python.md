# Python Optimization Checks

> Target: Python 3.10+. Prefer `X | None` over `Optional[X]`, match statements over if-elif chains, f-strings over `.format()`.

## Language overrides

None — Python aligns with the hub's universal principles.

## 1. Simplification & Readability

- Replace loops with list/dict/set comprehensions where clearer
- Use `collections.Counter`, `itertools`, `functools`, `pathlib` instead of hand-rolling
- Replace `if x == True:` / `if x == None:` with `if x:` / `if x is None:`
- Use `any()` / `all()` instead of manual loop-with-flag patterns
- Replace nested `try/except` with `contextlib.suppress()` when appropriate
- Use structural pattern matching (`match/case`) for complex dispatch (3.10+)
- Use tuple unpacking and starred assignments (`a, *rest = items`)

## 2. Refactoring

- Replace raw dicts with `dataclasses` or `NamedTuple` for structured data
- Use `enum.Enum` / `enum.StrEnum` instead of string constants
- Replace manual resource cleanup with context managers (`with` statement)
- Extract nested functions when they don't close over local state
- Move constants to module level; use `UPPER_SNAKE_CASE`
- Replace class-based single-method patterns with plain functions

## 3. Idiomatic Style & Conventions

- **PEP 8**: `snake_case` for functions/variables, `PascalCase` for classes
- Type hints on all public function signatures (use `X | None` syntax, not `Optional`)
- Use f-strings over `%` formatting and `.format()`
- Avoid mutable default arguments (`def foo(items=[])` → `def foo(items=None)`)
- Avoid bare `except:` — catch specific exceptions
- Use `isinstance()` over `type()` for type checks
- Import ordering: stdlib → third-party → local (one blank line between groups)

## 4. Performance

- Replace list where set/dict lookup is needed (O(n) → O(1) membership test)
- Move invariant computation outside loops
- Use `''.join()` or `io.StringIO` instead of string concatenation in loops
- Use generators / `itertools` instead of building large intermediate lists
- Avoid re-compiling regexes in loops — use `re.compile()` once
- Batch I/O operations; use `asyncio` for concurrent I/O
- Watch for N+1 query patterns in ORM code (SQLAlchemy, Django)

## 5. Safety & Correctness

- **Injection**: never use f-strings/`.format()` in SQL — use parameterized queries
- **Command injection**: avoid `os.system()`, `subprocess(shell=True)` with user input
- **Unsafe deserialization**: flag `pickle.load()`, `eval()`, `exec()` on untrusted data
- **Path traversal**: validate/sanitize user-supplied file paths (use `pathlib.resolve()`)
- **Secrets**: no hardcoded API keys, passwords, or tokens in source
- **Crypto**: flag MD5/SHA1 for password hashing — use `bcrypt`/`argon2`
- **Permissions**: flag overly permissive `os.chmod()` calls
