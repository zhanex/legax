# Examples

English | [Simplified Chinese](README.zh-CN.md)

Use this folder when you want a small, inspectable starting point instead of the full root config.

## Minimal Local Relay

[`config.example.minimal.yaml`](config.example.minimal.yaml) connects one Codex adapter to one self-hosted relay on localhost.

Try it from a source checkout:

```bash
cp examples/config.example.minimal.yaml config.yaml
node scripts/simple-relay-server.mjs
```

In a second terminal:

```bash
npm run daemon:bg
npm run daemon:pair
```

Open the printed pair URL from a browser or phone that can reach the relay URL.

On Windows PowerShell, use `Copy-Item examples/config.example.minimal.yaml config.yaml` instead of `cp`.

## Notes

- Replace `replace-with-a-long-random-secret` with the same generated value in both `relay.secret` and `transports[0].secret`.
- The minimal example intentionally omits Claude Code, Gemini CLI, and OpenCode. Copy those sections from [`../config.example.yaml`](../config.example.yaml) when needed.
- For npm-installed usage, prefer `legax init` and `legax doctor --offline`; the source-checkout commands above are for contributors and quick inspection.
