# Instagram DM AI — Mia 🌸

Automatizovaná správa Instagram DM konverzácií pre AI fashion influencerku **Mia**.
Postavené na Node.js/TypeScript, Fastify, SQLite a Grok (xAI) API.

---

## Obsah

1. [Prehľad](#prehľad)
2. [Architektúra](#architektúra)
3. [Požiadavky](#požiadavky)
4. [Inštalácia lokálne](#inštalácia-lokálne)
5. [Nastavenie Meta Business API](#nastavenie-meta-business-api)
6. [Nastavenie Grok API](#nastavenie-grok-api)
7. [Environment premenné](#environment-premenné)
8. [Spustenie lokálne (dev)](#spustenie-lokálne-dev)
9. [Nasadenie na VPS — Hetzner / Ubuntu](#nasadenie-na-vps--hetzner--ubuntu)
10. [Admin Dashboard](#admin-dashboard)
11. [Bezpečnosť](#bezpečnosť)
12. [Prispôsobenie persony](#prispôsobenie-persony)

---

## Prehľad

Aplikácia číta DM správy od followerov cez **Meta Instagram Graph API** a odpovedá im v mene Mie — fiktívnej mladej fashion modelky a content creatorky. Odpovede generuje **Grok (xAI)** s detailným systémovým promptom.

Funkcie:
- ✅ Webhook endpoint pre real-time Meta DM eventy
- ✅ Polling fallback (ak webhook nie je dostupný)
- ✅ Kontext konverzácie uložený v SQLite
- ✅ Spam & sensitive request detekcia
- ✅ Rate limiting (per-user + server-level)
- ✅ Admin dashboard (HTML5, no deps) — block, send manual, queue override
- ✅ HMAC-SHA256 overenie webhook requestov
- ✅ Pino logging

---

## Architektúra

```
Meta Webhook POST /webhook
        │
        ▼
  Signature verify (HMAC-SHA256)
        │
        ▼
  Spam / sensitive check
        │
        ▼
  ConversationService (SQLite)
   ├─ getHistory() — kontext
   ├─ checkRateLimit()
   └─ getPendingOverride()
        │
        ▼
  GrokClient.generateReply()
        │
        ▼
  InstagramClient.sendMessage()
        │
        ▼
  DB uloženie odpovede
```

---

## Požiadavky

- Node.js >= 20
- npm >= 10
- Meta Business Account s pripojeným Instagram Professional účtom
- Grok API kľúč (xAI) — https://console.x.ai
- (Pre nasadenie) VPS s Ubuntu 22.04+, doménové meno, SSL

---

## Inštalácia lokálne

```bash
git clone <repo-url>
cd instagram-dm-ai

npm install

cp .env.example .env
# Vyplň .env podľa sekcií nižšie
```

---

## Nastavenie Meta Business API

### 1. Vytvor Meta App

1. Choď na https://developers.facebook.com/apps
2. Klikni **Create App** → zvoľ **Business** typ
3. Vyplň názov aplikácie
4. V ľavom menu: **Add Product** → **Messenger** (pre Instagram DM)

### 2. Pripoj Instagram účet

1. V Meta Business Suite (business.facebook.com) → **Settings** → **Accounts** → **Instagram Accounts**
2. Pripoj tvoj Instagram Professional/Business účet
3. Poznač si **Instagram Account ID** (číselné ID)

### 3. Získaj Access Token

**Pre vývoj (krátky token):**
```
https://developers.facebook.com/tools/explorer/
```
- Vyber svoju App
- Vygeneruj User Token s oprávneniami:
  `instagram_basic`, `instagram_manage_messages`, `pages_messaging`

**Pre produkciu (dlhodobý token):**
```bash
# 1. Short-lived token → long-lived (60 dní)
curl -X GET \
  "https://graph.facebook.com/v20.0/oauth/access_token?
    grant_type=fb_exchange_token&
    client_id=YOUR_APP_ID&
    client_secret=YOUR_APP_SECRET&
    fb_exchange_token=SHORT_LIVED_TOKEN"

# 2. Pre permanentný Page Token:
# Použi Business Login alebo System User v Meta Business Manager
```

### 4. Nastav Webhook

**Pre lokálny vývoj (ngrok):**
```bash
# Inštalácia ngrok
npm install -g ngrok  # alebo https://ngrok.com/download

# Spusti tunel
ngrok http 8888
# Poznač si HTTPS URL, napr. https://abc123.ngrok.io
```

**V Meta Developer Console:**
1. V tvojej App → **Messenger** → **Webhooks** → **Add Callback URL**
2. **Callback URL:** `https://mymia.xyz/webhook`  *(produkcia)* alebo ngrok URL pre dev
3. **Verify Token:** rovnaká hodnota ako `META_VERIFY_TOKEN` v `.env`
4. Klikni **Verify and Save**
5. V Subscriptions klikni **Add Subscriptions** pre tvoj Instagram účet
6. Zaškrtni: `messages`, `messaging_postbacks`

### 5. Povolenia (Permissions)

V App Dashboard → **App Review** → **Permissions**:
- `instagram_manage_messages` — na čítanie a odosielanie DM
- `instagram_basic` — základné info

> ⚠️ Pre produkciu musíš požiadať Meta o schválenie `instagram_manage_messages`.
> Pre testovanie pridaj test usera cez **Roles** → **Test Users**.

---

## Nastavenie Grok API

1. Choď na https://console.x.ai
2. Vytvor účet a projekt
3. V **API Keys** vygeneruj nový kľúč
4. Poznač si kľúč a daj ho do `GROK_API_KEY` v `.env`
5. Model: `grok-3` (default) alebo `grok-3-mini` pre nižšie náklady

---

## Environment premenné

```env
# Meta / Instagram
META_APP_ID=          # číselné ID tvojej Meta App
META_APP_SECRET=      # tajný kľúč App (Meta Developer Console → Basic Settings)
META_ACCESS_TOKEN=    # long-lived Page/User Access Token
META_VERIFY_TOKEN=    # ľubovoľný reťazec, ktorý zadáš aj v Meta webhook nastavení
INSTAGRAM_ACCOUNT_ID= # číselné IG Business Account ID

# Grok
GROK_API_KEY=         # xai-... kľúč
GROK_MODEL=grok-3     # alebo grok-3-mini

# App
PORT=8888
NODE_ENV=production
ADMIN_SECRET=         # silný náhodný reťazec pre admin API

# Polling (záloha, ak webhook nefunguje)
ENABLE_POLLING=false
POLL_INTERVAL_SECONDS=30

# Limity
MAX_REPLIES_PER_USER_PER_HOUR=10
```

---

## Spustenie lokálne (dev)

```bash
# Development mode s auto-reload
npm run dev

# Alebo build + start
npm run build
npm start
```

Server beží na `http://localhost:8888`.
Admin UI: `http://localhost:8888/`

---

## Nasadenie na VPS — Hetzner / Ubuntu

### 1. Priprav server

```bash
# Aktualizácia systému
sudo apt update && sudo apt upgrade -y

# Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 pre process management
sudo npm install -g pm2

# Nginx
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Nasaď aplikáciu

```bash
# Vytvor adresár pre app
sudo mkdir -p /opt/instagram-dm-ai
sudo chown $USER:$USER /opt/instagram-dm-ai

# Klonuj repo
git clone <repo-url> /opt/instagram-dm-ai
cd /opt/instagram-dm-ai

# Inštalácia závislostí
npm install --omit=dev

# Build TypeScript
npm run build

# Nastav .env
cp .env.example .env
nano .env  # vyplň všetky hodnoty
```

### 3. Spusti s PM2

```bash
# Spusti
pm2 start dist/index.js --name "mia-dm" --env production

# Auto-start po reboote
pm2 save
pm2 startup  # skopíruj a spusti príkaz, ktorý PM2 vypíše

# Logy
pm2 logs mia-dm
pm2 monit
```

### 4. Nginx reverse proxy

```bash
sudo nano /etc/nginx/sites-available/mia-dm
```

```nginx
server {
    listen 80;
    server_name mymia.xyz www.mymia.xyz;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mia-dm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL s Certbot

```bash
sudo certbot --nginx -d mymia.xyz -d www.mymia.xyz
# Certbot automaticky upraví nginx konfig pre HTTPS
sudo systemctl reload nginx
```

### 6. Nastav Webhook v Meta

V Meta Developer Console → Webhooks:
- **Callback URL:** `https://mymia.xyz/webhook`
- **Verify Token:** rovnaká hodnota ako v `.env`

---

## Admin Dashboard

Prístupný na: `https://mymia.xyz/`

Funkcie (SaaS dashboard, prihlásenie cez e-mail/heslo, JWT):
- **Dashboard** — prehľad účtu
- **Personas** — vytváranie a úprava AI person
- **Avatars** — generovanie AI avatarov
- **Content** — generovanie obsahu
- **Instagram** — pripojenie Instagram účtu
- **Billing** — Stripe fakturácia a správa predplatného

Pôvodný samostatný admin panel chránený `ADMIN_SECRET` (Stats/Conversations/Block-Unblock/Queue Override) bol nahradený vyššie uvedeným SaaS rozhraním; jeho backend endpointy (`src/server/routes/admin.ts`) ostávajú dostupné len priamym HTTP volaním.

---

## Bezpečnosť

| Hrozba | Ochrana |
|--------|---------|
| Falošné webhook requesty | HMAC-SHA256 overenie (`X-Hub-Signature-256`) |
| Spam správy | Pattern matching (regex) pred generovaním odpovede |
| Nevhodné požiadavky | Sensitive request detection + šablónová odpoveď |
| Flood od jedného usera | Rate limit: max N odpovedí / hodinu (konfigurovateľné) |
| Server flood | Fastify rate limit: 300 req/min per IP |
| Admin API | Bearer token autentifikácia |
| Citlivé dáta v DB | Ukladajú sa len správy, nie osobné údaje |
| Duplikátne spracovanie | `processed_messages` tabuľka s dedup logikom |

---

## Prispôsobenie persony

Edituj `src/prompts/systemPrompt.ts`:

- **Meno a vek** persony
- **Tón a štýl** komunikácie
- **Cenník** content balíčkov
- **Produkty** ktoré upselluje
- **Hranice** — čo persona nikdy nerobí

Po zmene rebuildi: `npm run build && pm2 restart mia-dm`

---

## Licencia

MIT — použite zodpovedne. Táto aplikácia je určená pre legitímny business use.
Uistite sa, že spĺňate [Meta Platform Terms](https://developers.facebook.com/terms/) a [Instagram Community Guidelines](https://help.instagram.com/477434105621119).
