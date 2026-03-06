# Installation

## Requirements

- **Node.js 20+** — [Download](https://nodejs.org/)
- **npm** (ships with Node.js)
- **Git** (for cloning from source)

## From npm

```bash
npm install -g mach6-core
```

## From Source

```bash
git clone https://github.com/Artifact-Virtual/mach6.git
cd mach6
npm install
npm run build
```

## Verify

```bash
npx mach6 --version
```

## What's Included

The package ships with:

- **`.env.example`** — template for all environment variables (API keys, tokens)
- **`mach6.example.json`** — template for agent configuration
- **`mach6-gateway.service`** — systemd unit file for Linux deployments
- **`mach6.sh` / `mach6.ps1`** — start scripts for Linux/macOS and Windows

Environment variables are auto-loaded from `.env` via the built-in dotenv loader — no manual `source` or `dotenv` package needed.

## Next Steps

1. Run the [setup wizard](wizard.md): `npx mach6 init`
2. Follow the [Quick Start](quick-start.md)

## Platform Support

| Platform | Status |
|----------|--------|
| Linux (x64, arm64) | ✅ Fully supported |
| macOS (Intel, Apple Silicon) | ✅ Fully supported |
| Windows (x64) | ✅ Fully supported |

Mach6 uses `os.tmpdir()` and `os.homedir()` for all path resolution — zero hardcoded Unix paths. The same codebase runs everywhere without modification.
