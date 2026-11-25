# ConductNexus WhatsApp gateway

A small always-on service that keeps the school's WhatsApp phone linked and sends
messages over WhatsApp Web. The ConductNexus API stays on Render and calls this
service over HTTPS; the linked device and its session live on this server's disk.

Use this when the API host cannot run a browser 24/7 with a persistent disk
(Render free tier cannot: ephemeral disk, no Chromium, sleeps after 15 minutes).

```
Render API ──HTTPS + bearer token──> this gateway ──> WhatsApp Web ──> phone
```

## Requirements

- A small always-on server: Oracle Cloud Always Free (ARM), Hetzner CX22, or any
  1 GB RAM VPS running Ubuntu 22.04/24.04 or Debian 12.
- Public IPv4 address.
- A domain or an `sslip.io` hostname for HTTPS (`<your-ip>.sslip.io` needs no DNS setup).

## 1. Install Node and browser libraries

```bash
sudo apt-get update
sudo apt-get install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Shared libraries Chromium needs (Ubuntu 24.04 package names shown).
# On 22.04 use libasound2 instead of libasound2t64.
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation
```

## 2. Copy the gateway and install dependencies

On the server, clone the public repository and move the gateway into place:

```bash
git clone --depth 1 https://github.com/code-jocker/Conductnexus /tmp/cn
sudo useradd --system --create-home --home-dir /opt/conductnexus conductnexus
sudo mkdir -p /opt/conductnexus
sudo mv /tmp/cn/whatsapp-gateway /opt/conductnexus/
sudo chown -R conductnexus:conductnexus /opt/conductnexus
sudo -u conductnexus bash -c 'cd /opt/conductnexus/whatsapp-gateway && npm install'
rm -rf /tmp/cn
```

`npm install` downloads a private Chrome build for Puppeteer. Do not copy the
`node_modules` folder from Windows.

## 3. Configure the service

Generate a token (keep it secret; the API and gateway must share it):

```bash
openssl rand -hex 32
```

Create `/etc/conductnexus/whatsapp-gateway.env`:

```ini
PORT=3100
GATEWAY_TOKEN=PASTE_THE_64_CHARACTER_TOKEN
SESSION_DIR=/var/lib/conductnexus/whatsapp-session
SESSION_NAME=conductnexus
AUTO_CONNECT=true
```

```bash
sudo mkdir -p /etc/conductnexus /var/lib/conductnexus/whatsapp-session
sudo chown -R conductnexus:conductnexus /var/lib/conductnexus
sudo chmod 600 /etc/conductnexus/whatsapp-gateway.env
```

Create `/etc/systemd/system/conductnexus-whatsapp.service`:

```ini
[Unit]
Description=ConductNexus WhatsApp gateway
After=network-online.target
Wants=network-online.target

[Service]
User=conductnexus
WorkingDirectory=/opt/conductnexus/whatsapp-gateway
EnvironmentFile=/etc/conductnexus/whatsapp-gateway.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now conductnexus-whatsapp
sudo systemctl status conductnexus-whatsapp --no-pager
```

The log should say `ConductNexus WhatsApp gateway listening on port 3100`.

## 4. Put HTTPS in front of it

Render must reach the gateway over HTTPS. Pick one:

**No domain — use sslip.io.** Point Caddy at `https://YOUR_SERVER_IP.sslip.io`:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
YOUR_SERVER_IP.sslip.io {
    reverse_proxy 127.0.0.1:3100
}
```

Then `sudo systemctl reload caddy`. Use the same hostname with `https://` as
`WHATSAPP_GATEWAY_URL` below.

**Own domain:** create an `A` record to the server IP and replace the block above
with your hostname.

Keep port 3100 closed to the internet; allow only 22, 80 and 443 in the firewall.

Check it:

```bash
curl https://YOUR_HOST/health
# {"ok":true,"status":"disconnected"}

curl -H "Authorization: Bearer YOUR_TOKEN" https://YOUR_HOST/status
```

## 5. Point the API at the gateway

Render dashboard → conductnexus-api → Environment:

| Key | Value |
| --- | --- |
| `WHATSAPP_GATEWAY_URL` | `https://YOUR_HOST` |
| `WHATSAPP_GATEWAY_TOKEN` | the same 64-character token |
| `ENABLE_WHATSAPP` | leave `false` (the browser runs here, not on Render) |

Save and let Render redeploy. No code changes are needed on the VPS from here on.

## 6. Link the school phone

1. Sign in as an administrator.
2. Open **Communications → WhatsApp**.
3. Press **Connect device**. A QR code appears (the API proxies it from this gateway).
4. On the phone: WhatsApp → **Linked devices** → **Link a device**, then scan.
5. No camera? Press **Use phone number** and enter the 8-character pairing code on the phone.

The status changes to **Ready** and shows the linked account name and number.
The link survives gateway restarts and server reboots because the session is
stored in `/var/lib/conductnexus/whatsapp-session`.

## Sending a test message

```bash
curl -X POST https://YOUR_HOST/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"2507XXXXXXXX","body":"ConductNexus WhatsApp test"}'
```

A successful response looks like `{"ok":true,"providerMessageId":"..."}`.

## Operations

- Logs: `sudo journalctl -u conductnexus-whatsapp -f`
- Restart: `sudo systemctl restart conductnexus-whatsapp`
- Re-link: **Disconnect** in the app, then **Connect device** and scan again.
- Back up `/var/lib/conductnexus/whatsapp-session` like a password: it contains
  the linked-device credentials. Never commit it or share it.
- If the phone is offline or WhatsApp logs the device out, the gateway retries on
  its own and messages stay queued in ConductNexus until it is ready again.

## API

All routes except `/health` require `Authorization: Bearer <GATEWAY_TOKEN>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness and current status |
| GET | `/status` | Status, linked account, QR/pairing data |
| GET | `/qr` | Current QR image as a data URL |
| POST | `/connect` | Start the client; body `{ "phoneNumber": "2507…" }` is optional |
| POST | `/disconnect` | Destroy the client and clear the link |
| POST | `/send` | Send text; body `{ "to": "2507…", "body": "…" }` |


## Rate limits and connection safety

The gateway applies separate per-client, one-minute limits:

- Status and QR reads: 120 requests/minute.
- Connect and disconnect lifecycle requests: 5 requests/minute.
- Outbound sends: 30 requests/minute.

Authentication is checked before a request consumes a quota. The public
`/health` endpoint is excluded for platform probes. The `Retry-After` response
header tells clients when a limited request may be attempted again.

Set `TRUST_PROXY=1` when running behind Render's single reverse-proxy hop (as
configured in `render.yaml`). For another hosting provider, set this to the
exact number of trusted proxy hops; do not set it to `true` unless every
forwarded-header sender is trusted.

Run a single gateway instance for a given `SESSION_NAME`: the WhatsApp browser
profile is a single-writer resource. The in-process connection lock prevents
duplicate initialization within that instance; it is not a distributed lock
across multiple replicas.
