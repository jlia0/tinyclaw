# OpenViking Tools

Lightweight workspace tools for TinyClaw agents.

## Environment

- `OPENVIKING_BASE_URL` (optional, default `http://127.0.0.1:8320`)
- `OPENVIKING_API_KEY` (optional, sent as `X-API-Key`)
- `OPENVIKING_PROJECT` (optional, adds `?project=...`)

## Commands

- `./ovk.sh ls /` - list paths
- `./ovk.sh read /path/to/file.md` - read file content
- `./ovk.sh write /path/to/file.md "new content"` - write file content
- `./ovk.sh write-file /path/to/file.md ./local-file.md` - upload local file
- `./ovk.sh res-get viking://workspace/resource` - read resource by URI
- `./ovk.sh res-put viking://workspace/resource "content"` - write resource

Shortcut wrappers:

- `./ovk-ls.sh /`
- `./ovk-read.sh /path/to/file.md`
- `./ovk-write.sh /path/to/file.md "new content"`
