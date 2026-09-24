# Reproducing the raw data locally

Nothing under `raw/` or `cache/` is committed — both are gitignored because
they are entirely reproducible from the commands below. See `docs/data.md`
for the full pipeline writeup, sources, licensing and known data-quality
findings.

```bash
npm run etl:download   # fetches into raw/ (Kaggle if you have a token, else a
                        # public no-credential mirror with the same shape)
npm run etl:load       # streams raw/*.csv into staging tables
npm run etl:transform  # staging -> the normalized game/genre/platform tables
```

That's the whole reproduction path — three commands, no manual steps. Confirm
it worked:

```bash
mysql -uroot -proot faze -e "SELECT COUNT(*) FROM game;"
```
