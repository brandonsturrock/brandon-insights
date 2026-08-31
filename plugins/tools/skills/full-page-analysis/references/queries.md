# Query file → output filename contract

`build-report.mjs` reads the `--data` directory by these exact filenames.
Run each query as:

    dtctl query -f references/queries/<file>.dql --set <params> -o json --agent --spill=never | grep '^{' > <data-dir>/<output>.json

## Instance-scoped

| Query file | Parameters | Output filename |
|---|---|---|
| `fpa-instance-summary.dql` | `timeframe`, `view_instance` | `instance-summary.json` |
| `fpa-instance-requests.dql` | `timeframe`, `ua_instance` | `instance-requests.json` |
| `fpa-instance-exceptions.dql` | `timeframe`, `ua_instance` | `instance-exceptions.json` |
