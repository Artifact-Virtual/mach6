# Installation

## Requirements

- **Node.js 20+** — [Download](https://nodejs.org/)
- **npm** or **yarn**
- **Git** (for cloning)

## From Source

```bash
git clone https://github.com/Artifact-Virtual/mach6.git
cd mach6
npm install
npm run build
```

## From npm

```bash
npm install -g mach6-core
```

## Verify

```bash
node dist/index.js --version
```

## Platform Support

| Platform | Status |
|----------|--------|
| Linux (x64, arm64) | ✅ Fully supported |
| macOS (Intel, Apple Silicon) | ✅ Fully supported |
| Windows (x64) | ✅ Fully supported |

Mach6 uses `os.tmpdir()` and `os.homedir()` for all path resolution — zero hardcoded Unix paths. The same codebase runs everywhere without modification.
