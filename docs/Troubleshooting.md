# Troubleshooting

## Dimension Mismatch Error

```
expected 1024 dimensions, not 384
```

**Cause**: Using wrong E5 model.

**Solution**: Ensure E5 server uses `multilingual-e5-large` (1024 dims), not `e5-small` (384).

## Permission Denied

```
must be owner of table
```

**Cause**: Database permissions not set correctly.

**Solution**: Run the ownership grants in PostgreSQL setup.

## E5 Server Connection Refused

```
fetch failed
```

**Cause**: E5 server not running.

**Solution**: Ensure E5 server is running: `curl http://127.0.0.1:8765/health`

## pgvector Extension Not Found

```
extension "vector" must be installed
```

**Cause**: pgvector not installed in PostgreSQL.

**Solution**:

```bash
sudo apt install postgresql-16-pgvector
```

## OpenClaw Not Found

```
command not found: openclaw
```

**Cause**: OpenClaw not installed globally.

**Solution**:

```bash
npm install -g openclaw
```
