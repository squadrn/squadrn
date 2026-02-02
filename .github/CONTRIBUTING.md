# Contributing to Squadrn

Thanks for your interest in contributing to Squadrn!

## Development Setup

1. Install [Deno 2.x](https://deno.land/)
2. Clone the repository:
   ```bash
   git clone https://github.com/squadrn/squadrn.git
   cd squadrn
   ```
3. Verify everything works:
   ```bash
   deno lint
   deno fmt --check
   deno check cli/mod.ts
   deno test --allow-all
   ```

## Project Structure

- **`types/`** — Shared interfaces (plugin contract)
- **`core/`** — Gateway daemon engine
- **`cli/`** — CLI entry point and commands
- **`plugins/`** — Official plugins

## Code Style

- Strict TypeScript, no `any`
- 100-character line width, 2-space indent
- Interfaces over type aliases for objects
- `async/await` always, never raw Promises
- Custom error classes with context
- `Result<T, E>` for expected failures

Formatting and linting are enforced by CI:

```bash
deno fmt     # Auto-format
deno lint    # Lint
```

## Pull Request Process

1. Fork the repository and create a branch from `main`
2. Make your changes with tests where applicable
3. Ensure all checks pass: `deno lint && deno fmt --check && deno check cli/mod.ts && deno test --allow-all`
4. Open a pull request against `main`
5. Describe what your change does and why

## Reporting Issues

Use the GitHub issue templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
