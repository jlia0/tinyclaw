# Contributing to TinyClaw

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw
npm install
npm run build
```

## Development

```bash
# Build TypeScript
npm run build

# Run locally
./tinyclaw.sh start

# View logs
./tinyclaw.sh logs all
```

### Project Structure

- `src/` - TypeScript source (queue processor, channel clients, routing)
- `lib/` - Bash scripts (daemon, setup wizard, messaging)
- `scripts/` - Installation and bundling scripts
- `.agents/skills/` - Agent skill definitions
- `docs/` - Documentation

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test locally with `tinyclaw start`
4. Open a pull request

## Reporting Issues

Open an issue at [github.com/jlia0/tinyclaw/issues](https://github.com/jlia0/tinyclaw/issues) with:

- What you expected vs what happened
- Steps to reproduce
- Relevant logs (`tinyclaw logs all`)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
