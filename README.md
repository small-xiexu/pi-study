# pi-study-workbench

`pi-study-workbench` is the local Pi Package produced by the `pi-study` learning repository. The repository root is the Package root, so project discovery and Package loading use the same resource files instead of copied sources.

## Resources

| Type | Resource |
|---|---|
| Extension | `pi-study-guard` |
| Skill | `java-readonly-analysis` |
| Prompt Template | `java-review` |
| Theme | `pi-study-lab` |

The explicit `pi` Manifest in `package.json` controls resource discovery. The npm `files` allowlist controls the tarball and excludes project Settings, tests, test-only fixtures, learning labs, plans, caches, sessions, credentials, and `node_modules`.

## Verification

Run the controlled source/tarball equivalence lab from the root of a full source checkout:

```bash
node labs/6.3-local-package/scripts/run-package-artifact-lab.mjs
```

The `labs/` directory is intentionally excluded from the published tarball, so this command is available only in the full learning repository, not inside an installed or unpacked Package artifact. The lab runs offline with isolated Pi and npm configuration, performs pack and publish dry-runs, inspects a temporary tarball, and compares resource discovery from the source root and unpacked root. It does not publish, install a third-party Package, call a Model, or retain the temporary tarball.

## License

This learning Package is `UNLICENSED`. No permission for public reuse or redistribution is granted unless a separate license is added explicitly.
