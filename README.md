# wuhu (Swift)

Swift 6.2 pivot of Wuhu.

## CLI

```bash
swift run wuhu --help
swift run wuhu openai "Say hello"
swift run wuhu anthropic "Say hello"
```

The CLI reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from the environment and will also load a local `.env` if present.
