# pi-ssh-remote

Pi extension that routes the built-in `read`, `write`, `edit`, `bash`, and user `!` commands through SSH when `--ssh` is provided.

## Usage

```bash
pi --ssh user@host
pi --ssh user@host:/remote/path
pi --ssh user@host --ssh-port 8022
```

Authentication uses your normal SSH setup/agent. The extension does not pass `-i`.

For safety, tool SSH commands run with `BatchMode=yes` and `ForwardAgent=no`, and `read`/`write`/`edit` calls to common sensitive paths such as `.ssh/`, `.aws/`, `.gnupg/`, `.env*`, `credentials`, and `secret` are blocked in SSH mode.

Use `/ssh-status` inside pi to confirm the active remote and agent status.
