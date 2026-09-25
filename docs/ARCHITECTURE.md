# Docuna — Architecture

Date: 2026-09-25 · Status: **approved; Phase 2 in progress**

## 0. Decisions (2026-09-25)

| Topic | Decision |
|---|---|
| Brand | **Docuna** ("doc" + *una*, "one": one app for all your documents). Almost no namespace collisions (no Play Store app with that name); `docuna.app` and `docuna.io` unregistered; `docuna.com` parked for sale |
| Play Store title (≤30 chars) | **Docuna: PDF Scanner & OCR**, putting the two highest-volume keywords in the title, which carries the most ASO weight |
| Short description (≤80 chars) | *Scan to PDF, edit & search documents offline. No watermark, no account.* |
| Android package | `com.variety_tech.docuna` (publisher: Variety Tech, variety-tech.com). **Permanent once published** |
| Backend | **Supabase**: Edge Functions (Deno) as the AI gateway + Postgres for usage/entitlements + Supabase Auth **anonymous sign-in** (no account) |
| Billing | **expo-iap + our own Google Play verification** in an Edge Function. No revenue share and no third-party vendor; the cheapest option long-term. RevenueCat was rejected (1% of revenue above $2.5k MTR) |
| Styling | **NativeWind v4** (stable, Tailwind 3.4). Compatibility with RN 0.86 / Reanimated 4 is verified at install time |

The native module lives in `modules/docuna-native`.

---

## 1. Current project state

| Item | Finding |
|---|---|
| Repository | Empty git repo on `main`, no commits, no files |
| package.json | None — greenfield |
| Expo SDK | Target **57.0.25** (current `latest` on npm; SDK 58 is in preview — do not adopt) |
| React Native | **0.86.3** (bundled with SDK 57) |
| React | **19.2.3** |
| Router | None yet → Expo Router **~57.0.23** |
| Installed deps | None → no conflicts, nothing to remove |
| Toolchain | Node 24.20, npm 11.19, JDK 17, `eas` CLI installed. **`ANDROID_HOME` not set** → local `expo run:android` needs the Android SDK installed; otherwise use EAS Build for dev builds |

Everything below is therefore a design, not a migration.

---

## 2. Key technical decisions

### 2.1 One local native module instead of several wrappers

`modules/docuna-native` — a single Kotlin **Expo Module** (expo-modules-core, New Architecture compatible) wrapping Android/Google APIs directly:

| Capability | Android API used | Why not a JS/npm package |
|---|---|---|
| Scanner (detect, auto-capture, multipage, crop, perspective, filters, shadow removal) | **ML Kit Document Scanner** (`play-services-mlkit-document-scanner`) | Does all of §7 on-device, no camera permission needed, Google-maintained. Existing RN wrappers are thin and lag releases |
| OCR | **ML Kit Text Recognition v2**, bundled Latin model | Fully offline (covers English, Swahili, most Latin-script languages). `react-native-mlkit-ocr` is abandoned (2023); others are single-purpose wrappers |
| PDF page rendering (reader, thumbnails) | `android.graphics.pdf.PdfRenderer` → cached JPEG tiles on disk | Zero APK cost, never loads the PDF into JS memory |
| PDF merge / split / extract / rotate / delete / compress / import | **PdfBox-Android** (Apache-2.0) streaming from file to file | `pdf-lib` loads the whole PDF into the JS heap (violates §25/§26) and is unmaintained since 2022 |
| Images → PDF | PdfBox-Android (JPEG pass-through, no re-encode) | Keeps scans sharp and small; `expo-print` (HTML→PDF) re-rasterises and bloats files |
| Manual-crop fallback: perspective warp, rotation, filters, thumbnails | `Matrix.setPolyToPoly`, `ColorMatrix`, `BitmapFactory` inSampleSize | **No OpenCV needed** (saves ~10–20 MB). Processing is one page at a time, off the JS thread |

All methods take and return **file URIs** and run on a background coroutine dispatcher. No base64 crosses the bridge.

**Scanner fallback:** the ML Kit scanner needs Google Play services, and on first use it downloads its module through Play services. If it's unavailable (non-GMS devices, or offline on first use), the app falls back to `expo-camera` manual capture plus our own corner-adjust screen (`scan/crop`), then the native perspective warp. That fallback has no live edge detection, and the UI says so.

### 2.2 Deviations from the suggested stack

| Suggestion | Decision | Reason |
|---|---|---|
| NativeWind | **Adopted: v4 (stable) + Tailwind 3.4** | Owner's decision. Theme tokens live in `tailwind.config.js` as CSS variables, so light and dark mode are one class set. Move to v5 once it's stable |
| OpenCV / VisionCamera / TFLite | **Not adopted** | ML Kit scanner covers detection, and Android `Matrix` covers the fallback warp. VisionCamera would pull in Nitro and frame processors just to duplicate ML Kit |
| `react-native-pdf` | **Not adopted** | Pulls `react-native-blob-util` + PdfiumAndroid (~5 MB). Our PdfRenderer tile approach + a FlashList page list covers reading, and OCR text covers search |
| Single `OCRDocument` row per document | **Per-page OCR rows** | Needed for "Source: Page 8" answers, per-page search hits, and re-OCR of single pages |

### 2.3 Known limitations (stated up front, per §42)

- **Text selection in arbitrary imported PDFs**: PdfRenderer text APIs only exist on Android 15+ (API 35). Plan: select from OCR text for scans everywhere; native text selection is **pending** and API-35+ only.
- **Non-Latin scripts** (Devanagari, Chinese, Japanese, Korean): available later as optional downloadable ML Kit models, not bundled.
- **Advanced OCR (Pro)**: see §7 for its definition. It is not a different engine; it's AI-assisted correction plus layout/table extraction.

---

## 3. Proposed file/folder architecture

Changes vs. the brief, with reasons:
- `app/index.tsx` + `(tabs)/home.tsx` duplicate each other → Home is `(tabs)/index.tsx`.
- `document/reader.tsx` etc. have no document id → nested dynamic segment `document/[id]/…`.
- `scan/capture|filters|complete` are handled inside the ML Kit scanner UI → removed. The **Scan tab button launches the scanner directly** (custom tab button), so there are no extra screens (§31).
- Generic `ai/index|ask|summarize|extract` chat area → contextual `document/[id]/ai` (§33). Only `ai/compare` is top-level, since it spans two documents.
- Routes live in `src/app/` (the SDK 57 convention); non-route code lives elsewhere in `src/` so Expo Router never treats it as a route. Routes are added phase by phase, so a route exists only once its screen works.

```text
src/app/
├── _layout.tsx                 # DB migrate, theme, error boundary, root Stack
├── (tabs)/
│   ├── _layout.tsx             # Home · Documents · [Scan] · Search · Settings
│   ├── index.tsx               # Home: scan CTA, inbox, recent, folders, storage
│   ├── documents.tsx           # all docs, folders, sort/filter, multi-select
│   ├── scan.tsx                # route stub; tab button intercepts → scanner
│   ├── search.tsx              # local FTS search
│   └── settings.tsx
├── scan/
│   ├── review.tsx              # batch review: grid, reorder, rename, folder, save
│   └── crop.tsx                # manual corner adjust (fallback + re-crop)
├── document/[id]/
│   ├── index.tsx               # overview + actions (Read, Pages, OCR, ✨ AI, Export)
│   ├── reader.tsx              # virtualised page reader, zoom, bookmarks
│   ├── pages.tsx               # page workspace (§9)
│   ├── page/[pageId].tsx       # single-page editor: crop/rotate/filter/enhance
│   ├── annotate.tsx
│   ├── ocr.tsx                 # view/copy/re-run OCR text
│   └── ai.tsx                  # Ask / Summarize / Extract / Translate / Explain
├── tools/                      # presented as modals
│   ├── merge.tsx
│   ├── split.tsx
│   ├── compress.tsx
│   └── export.tsx
├── folders/[id].tsx
├── inbox.tsx
├── ai/compare.tsx
├── paywall.tsx                 # modal
└── settings/
    ├── storage.tsx
    ├── privacy.tsx
    └── subscription.tsx

src/   (non-route code)
├── config/                     # env (EXPO_PUBLIC_*), feature flags, limits
├── theme/                      # tokens, light/dark, typography
├── domain/                     # pure TS models + rules (platform-independent, unit-tested)
│   ├── document.ts  page.ts  folder.ts  entitlement.ts  errors.ts
├── db/
│   ├── client.ts  migrations/  repositories/   # documents, pages, folders, ocr, search…
├── services/                   # typed interfaces + Android implementations
│   ├── scanner/  image/  pdf/  ocr/  search/  filesystem/  export/
│   ├── ai/  ads/  billing/  entitlement/  network/  analytics/
├── components/                 # PageThumb, PageGrid, Toolbar, EmptyState, ErrorView…
└── hooks/

modules/docuna-native/          # local Expo Module (Kotlin): scanner, ocr, pdf, image
server/                         # AI gateway (Cloudflare Worker) — separate package
docs/
```

State management: SQLite is the source of truth. Screens read through repository hooks with a small invalidation event emitter. No Redux/Zustand, and only two React contexts (theme, entitlement snapshot).

---

## 4. Dependency table

### App — Expo SDK 57 packages (versions from SDK 57 `bundledNativeModules.json`)

| Package | Version | Why it's needed | Phase |
|---|---|---|---|
| expo, react, react-native | 57.0.25 / 19.2.3 / 0.86.3 | Platform | 1 |
| expo-router (+ screens, safe-area-context, linking, constants) | ~57.0.23 | Navigation (§4) | 1 |
| react-native-gesture-handler | ~2.32.0 | Drag-reorder, pinch-zoom, crop handles | 1 |
| react-native-reanimated / react-native-worklets | 4.5.1 / 0.10.1 | 60 fps drag/zoom; required by gesture-driven UI | 1 |
| expo-sqlite | ~57.0.3 | Local DB; **FTS5 compiled in by default** | 1 |
| expo-file-system | ~57.0.7 | Page/PDF files, SAF folder picking for user-chosen export dirs | 1 |
| expo-image | ~57.0.5 | Disk-cached, downsampled thumbnails (memory-safe) | 1 |
| expo-crypto | ~57.0.3 | `randomUUID` for ids | 1 |
| expo-status-bar, expo-system-ui, expo-splash-screen, expo-font | SDK 57 | Theming / startup | 1 |
| expo-dev-client | ~57.0.19 | Dev builds (native module required from Phase 2) | 2 |
| expo-image-picker | ~57.0.20 | Photo import (Android photo picker, multi-select, no storage permission) + system-camera **fallback** on non-GMS devices. Replaces the planned expo-camera + expo-image-manipulator: the native module does resize/rotate/crop | 2 |
| react-native-svg | 15.15.4 | Crop outline now; annotations in Phase 3 | 2 |
| expo-document-picker | ~57.0.2 | Import PDFs | 3 |
| expo-sharing | ~57.0.22 | Share sheet | 3 |
| expo-intent-launcher | ~57.0.1 | "Open with…" another app | 3 |
| expo-media-library | ~57.0.5 | Save page images to the gallery | 3 |
| expo-network | ~57.0.2 | Offline detection before AI / ads | 5 |
| expo-secure-store | ~57.0.4 | Gateway auth token (Keystore-backed) | 5 |
| expo-application | ~57.0.3 | App/version info for gateway attestation | 5 |
| expo-build-properties | ~57.0.22 | minSdk / R8 / ABI settings | 2 |

### App — third party

| Package | Version | Why | Native? | Phase |
|---|---|---|---|---|
| @shopify/flash-list | 2.3.2 | Virtualised lists and reader pages (low-end devices) | JS only (v2) | 1 |
| react-native-sortables | 1.10.0 | Drag-reorder in a **grid** of pages on Reanimated 4 (reorderable-list only supports single-column lists) | JS only | 2 |
| react-native-google-mobile-ads | 17.2.0 | AdMob banner / interstitial / rewarded + UMP consent; peer `react-native >=0.86` fits SDK 57 exactly | Yes + config plugin | 6 |
| expo-iap | 5.6.3 | Google Play Billing (OpenIAP), Expo config plugin | Yes + config plugin | 7 |

### Native (Gradle, inside `modules/docuna-native`)

| Artifact | Why | APK impact (approx.) |
|---|---|---|
| `com.google.android.gms:play-services-mlkit-document-scanner` | Scanner | Small; the model is delivered by Play services |
| `com.google.mlkit:text-recognition` (bundled Latin) | Offline OCR | ~4 MB per ABI |
| `com.tom-roush:pdfbox-android` | Merge/split/extract/rotate/compress, images→PDF | ~3–4 MB (verify exact version in Phase 3) |
| Kotlin coroutines | Background work | Negligible |

Size controls: AAB with ABI splits (Play handles them), R8 minify + resource shrinking, and no OpenCV/Pdfium/VisionCamera.

### Explicitly rejected
`pdf-lib` (JS-heap PDFs, unmaintained), `@cantoo/pdf-lib` (same memory model), `react-native-pdf` + `react-native-blob-util` (duplicates PdfRenderer), `react-native-vision-camera` (duplicates ML Kit), OpenCV (size), `react-native-mlkit-ocr` (abandoned), RevenueCat (revenue share), Redux/Zustand (SQLite is the store), a third-party analytics SDK (see §10).

Added for the chosen stack: `nativewind` 4.x + `tailwindcss` ^3.4 (styling, Phase 1), and `@supabase/supabase-js` (anonymous auth session + calling Edge Functions; JS only; Phase 5; sessions stored in `expo-secure-store`).

### Server (Supabase)
- **Edge Functions (Deno)**: `session`, `ai`, `billing-verify`, `billing-rtdn`, `ads-ssv`, `events`. They use the `openai` SDK (Responses API, structured outputs) and `jose` to sign the Google service-account JWT.
- **Postgres**: tables in §5 with **RLS enabled and no client policies**. Only Edge Functions (service role) read or write them. Rate limiting and credit debits run as `SECURITY DEFINER` SQL functions in one transaction each, so there are no races and no separate KV store.
- **Auth**: Supabase anonymous sign-in gives a `user_id` + JWT with no account. Later it can be upgraded to email login for optional cloud sync without losing the Pro entitlement.
- **Cost note**: the Free plan pauses a project after a week of inactivity, which is fine for development. Production should run on Pro ($25/mo) once there are real users; Edge Function invocations and Postgres storage for this schema stay well within it.

---

## 5. SQLite schema (on device)

Migrations are keyed on `PRAGMA user_version`. Pragmas: `journal_mode=WAL`, `foreign_keys=ON`.

```sql
CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('scan','import_pdf','import_image')),
  page_count     INTEGER NOT NULL DEFAULT 0,
  thumbnail_uri  TEXT,
  pdf_uri        TEXT,               -- derived artifact
  pdf_stale      INTEGER NOT NULL DEFAULT 1, -- regenerate lazily on export/read
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  in_inbox       INTEGER NOT NULL DEFAULT 1,
  suggested_json TEXT,               -- optional AI suggestion {category, folder, filename}
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER             -- soft delete → trash, purged after 30 days
);
CREATE INDEX idx_documents_folder  ON documents(folder_id, updated_at DESC);
CREATE INDEX idx_documents_recent  ON documents(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE pages (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,   -- 0-based; rewritten in one transaction on reorder
  original_uri   TEXT NOT NULL,      -- never modified
  processed_uri  TEXT,               -- crop/filter output (NULL = use original)
  thumbnail_uri  TEXT NOT NULL,      -- ~300px JPEG
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  rotation       INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
  crop_json      TEXT,               -- 4 normalised corner points
  filter         TEXT NOT NULL DEFAULT 'original', -- original|color|grayscale|bw|enhanced
  adjust_json    TEXT,               -- brightness/contrast/sharpen
  ocr_status     TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed','skipped')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_pages_doc ON pages(document_id, position);
CREATE INDEX idx_pages_ocr_pending ON pages(ocr_status) WHERE ocr_status = 'pending';

CREATE TABLE ocr_pages (
  page_id       TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  blocks_json   TEXT,                -- line boxes for highlight/select (optional)
  language      TEXT,
  engine        TEXT NOT NULL,       -- 'mlkit-latin-v2' | 'ai-corrected'
  processed_at  INTEGER NOT NULL
);
CREATE INDEX idx_ocr_doc ON ocr_pages(document_id);

-- Full-text search (external content, kept in sync by triggers)
CREATE VIRTUAL TABLE ocr_fts USING fts5(
  text, content='ocr_pages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
-- + AFTER INSERT/UPDATE/DELETE triggers on ocr_pages
-- Titles searched via a second small fts5 table `title_fts(title)` with the same trigger pattern.
-- Query builder: user input → quoted phrase/prefix query, so "KSh 25,000" → "ksh 25 000"
-- (unicode61 splits on the comma) and "univ" → univ*. Results ranked by bm25 with snippet().

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  label TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ink','highlight','text','signature')),
  data_json TEXT NOT NULL,           -- normalised coordinates
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE ai_results (              -- local cache: never pay twice for the same summary
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  input_hash TEXT NOT NULL,           -- hash of (action, params, content revision)
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(document_id, action, input_hash)
);

CREATE TABLE ai_usage (                -- local mirror for UI only; server is authoritative
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  document_id TEXT,
  credits_used INTEGER NOT NULL,
  status TEXT NOT NULL,               -- ok|failed|refunded
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

### File layout on device

```text
<documentDirectory>/docs/<docId>/
    pages/<pageId>/original.jpg     # from scanner, untouched
    pages/<pageId>/processed.jpg    # after crop/filter (optional)
    pages/<pageId>/thumb.jpg        # ~300px
    document.pdf                    # derived, regenerated when pdf_stale=1
<cacheDirectory>/render/<docId>/<page>@<scale>.jpg   # reader tiles, evictable
```

The canonical copy is app-private: this keeps it intact under scoped storage. Users stay in control of their files through:
- **Export / Save to…**: SAF picker (any folder, including Downloads, Documents, SD card or Drive), plus Share and Open with…
- **Auto-save folder (setting)**: pick a SAF folder once, and each saved or changed document's PDF is mirrored there.
- **Import**: PDFs and images from anywhere via the document picker.

### Server (Supabase Postgres) schema

`user_id` references `auth.users(id)` (the anonymous user). RLS is on for every table, with no client policies.

```sql
profiles     (user_id uuid PK, integrity_ok bool, banned bool DEFAULT false, created_at timestamptz)
entitlements (user_id uuid PK, product_id text, purchase_token_hash text UNIQUE,
              state text, expires_at timestamptz, verified_at timestamptz)
credit_ledger(id uuid PK, user_id uuid, delta int, reason text,     -- welcome|ad_reward|pro_monthly|ai_action|refund
              ref text, created_at timestamptz)                    -- balance = SUM(delta)
ad_rewards   (transaction_id text PK, user_id uuid, created_at timestamptz) -- AdMob SSV idempotency
ai_requests  (id uuid PK, user_id uuid, action text, model text, input_tokens int,
              output_tokens int, cost_micros int, status text, created_at timestamptz)
rate_limits  (user_id uuid, bucket text, window_start timestamptz, count int, PK(user_id,bucket,window_start))
```

No document content is stored server-side, and prompts and responses are not logged.

---

## 6. Local / cloud responsibility matrix

| Capability | Device | Gateway | OpenAI | Google | Works offline |
|---|:-:|:-:|:-:|:-:|:-:|
| Scan, detect, crop, filters | ✅ | | | Play services delivers the scanner module | ✅ (fallback if module missing) |
| Page management, annotations | ✅ | | | | ✅ |
| Images→PDF, merge, split, rotate, extract, compress | ✅ | | | | ✅ |
| PDF reading | ✅ | | | | ✅ |
| OCR | ✅ | | | | ✅ |
| Full-text search | ✅ | | | | ✅ |
| Folders, inbox, rename, trash | ✅ | | | | ✅ |
| Export / share / open with | ✅ | | | | ✅ |
| Rule-based filename/category hints (dates, "Invoice", course codes) | ✅ | | | | ✅ |
| AI: ask, summarize, extract, classify, filename, translate, explain, compare, OCR correction | builds minimal context | auth, limits, prompt, model routing, metering | ✅ | | ❌ ("AI requires an internet connection.") |
| Credits balance / AI limits | display only | ✅ authoritative | | | cached display |
| Rewarded ad → credits | shows ad | ✅ verifies AdMob SSV callback | | AdMob | ❌ |
| Banner / interstitial ads | ✅ | | | AdMob | fail silently |
| Subscription purchase | ✅ Play Billing UI | ✅ verifies token (Play Developer API) + RTDN | | Play | cached entitlement, grace period |
| Analytics (allowlisted events, no content) | queues events | ✅ tiny `/events` endpoint | | | queued |

**AI context minimisation** (in `src/services/ai`, run on the device before any request):
1. Text questions → retrieve the top-k OCR pages locally using FTS5 bm25 on the question's keywords, and send only those pages' text with page numbers (answers cite pages).
2. Summaries of long documents → send per-page text capped at a token budget. Above the budget, use map-reduce on the gateway.
3. Visual questions, or pages where OCR confidence is low → send only the needed page images, downscaled to ~1600 px long edge as JPEG. Never the whole PDF.
4. Show a confirmation sheet listing the pages that will be sent (§24).

---

## 7. Free / Rewarded / Pro feature matrix

| Feature | Free | Free + rewarded ad | Pro ($2.99/mo) |
|---|:-:|:-:|:-:|
| Unlimited scanning, pages, documents | ✅ | | ✅ |
| Auto-detect, crop, filters, enhance | ✅ | | ✅ |
| PDF create / edit / merge / split / compress / export | ✅ | | ✅ |
| Local OCR + full-text search | ✅ | | ✅ |
| Folders, inbox, annotations, bookmarks | ✅ | | ✅ |
| No watermark, no account, offline | ✅ | | ✅ |
| Ads | Banner on list screens; interstitial at most 1 per ~5 min, only after export/share, never in scanner/editor | — | **None** |
| AI actions | 3 welcome credits | **1 ad = 10-min AI session, up to 5 actions** (max 3 ad sessions/day) | 300 credits/month (heavy actions cost more; see below) |
| AI batch (classify/rename whole inbox) | ❌ | ❌ | ✅ |
| Advanced OCR (AI correction, tables → CSV, handwriting via vision model) | ❌ | single page | ✅ |
| AI compare, translate full document | ❌ | ✅ (counts as 3 actions) | ✅ |
| Export extras: PDF password, custom page size/margins, OCR text layer in exported PDF | basic PDF | | ✅ |

Credit weights (tunable server-side, never hard-coded in the app): summarize/ask/classify/filename = 1; extract = 1; explain page = 1; translate = 1 per ~2 pages; compare = 3; vision page = 2. All limits are **config values on the gateway**, to be tuned from real `ai_requests` cost data.

Monetization flow (§46) runs through `services/entitlement.ensureAIAccess(action)`: Pro → allow; credits → consume on the server; otherwise → sheet with **[Watch ad] [Go Pro]**. The client only asks; the gateway decides.

---

## 8. Identity, entitlement & abuse (no account required)

- On first AI use (not at install), the app calls Supabase `signInAnonymously()`, then the `session` function with a **Play Integrity** token. Welcome credits are granted only after the integrity check passes. The Supabase session (a JWT that auto-refreshes) is kept in `expo-secure-store`.
- **Purchase**: `obfuscatedAccountId = user_id`. The app sends the purchase token to `/v1/billing/verify`. The gateway checks it with `purchases.subscriptionsv2.get` and acknowledges it. Google Real-Time Developer Notifications (Pub/Sub push → gateway) keep renewals and cancellations current.
- **Restore on a new device**: Play returns the active purchase token → the gateway re-binds it to the new `user_id`.
- **Rewarded ads**: credits are granted **only** by AdMob **server-side verification** callbacks (signed; `custom_data = user_id`; idempotent on `transaction_id`). The client's "reward earned" event only updates the UI optimistically.
- **Per-request checks**: JWT valid → not banned → entitlement/credits → action allowlisted → payload ≤ size cap → per-user and per-IP rate limit (KV) → call OpenAI → meter tokens and cost → debit credits (refunded on failure).
- Model names, prompts and limits live in gateway config. The app sends `action` + minimal context, never a prompt or a model name.

---

## 9. Native code / config plugins & Expo Go

| Item | Kind | Needs a dev build? |
|---|---|---|
| `modules/docuna-native` (ML Kit scanner, ML Kit OCR, PdfRenderer, PdfBox, image ops) | Local Expo Module (Kotlin) | **Yes** |
| react-native-google-mobile-ads | Native + config plugin (App ID in manifest) | **Yes** |
| expo-iap | Native + config plugin (Play Billing) | **Yes** |
| expo-build-properties | Config plugin (minSdk, R8, shrink resources) | Build-time |
| expo-sqlite FTS5 | Enabled by default in the build | Works in Expo Go too |
| expo-camera, file-system, sharing, image, secure-store… | In Expo Go | No |

**Conclusion:** Phase 1 runs in Expo Go. From Phase 2 on, the project uses a **development build** (`expo-dev-client`), built either through EAS Build (`eas build --profile development -p android`) or locally once the Android SDK is installed and `ANDROID_HOME` is set.

Proposed `minSdkVersion` is **24** (Android 7), the SDK 57 default. Verify this in Phase 1, together with the requirements of ML Kit and PdfBox.

---

## 10. Configuration & analytics

- `app.config.ts` + `eas.json` profiles: **development / preview / production**.
- Client env (`EXPO_PUBLIC_*`, not secret): `API_BASE_URL`, `ADMOB_APP_ID`, `ADMOB_BANNER_ID`, `ADMOB_INTERSTITIAL_ID`, `ADMOB_REWARDED_ID`, `PLAY_SUBSCRIPTION_ID`. Development uses Google's test ad IDs.
- Client also gets `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The anon key is public by design, and the data is protected by RLS plus the Edge Function checks.
- Server secrets (`supabase secrets set` only): `OPENAI_API_KEY`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `RTDN_PUSH_TOKEN`. The service-role key never leaves Supabase.
- Analytics: no third-party SDK. The app batches allowlisted events (`scan_completed`, `document_created`, `pdf_exported`, `ocr_completed`, `ai_used`, `rewarded_ad_completed`, `subscription_started`) with counts and durations only, and never text, titles or filenames. They go to `/v1/events`, and there is an opt-out in Settings → Privacy. Crash reporting is a decision for Phase 8 (options: Sentry with PII scrubbing, or Play Console vitals only).

---

## 11. Implementation phases (each ends runnable)

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Foundation** | SDK 57 app scaffold, strict TS, ESLint, Jest; router tree with real (empty-state) screens; theme light/dark; SQLite client + migrations + repositories; filesystem service; error boundary; config/env | Runs in Expo Go; unit tests for repositories (create doc, add/reorder/delete pages) pass |
| **2. Scanner & pages** | Local native module skeleton; ML Kit scanner; batch review; page workspace (reorder/delete/duplicate/rotate/replace/add); manual crop + filters fallback; image import; dev build | Scan 10 pages → review → save in < 3 taps after capture; memory stays flat across 30 pages on a low-end device |
| **3. PDF engine & reader** | images→PDF, merge, split, extract, rotate, compress, import PDF; reader (virtualised, zoom, fit, thumbnails, bookmarks); export (SAF), share, open with, auto-save folder; basic annotations | 200-page PDF opens and scrolls without OOM; merge/split tested |
| **4. OCR & search** | Background OCR queue (one page at a time, resumable); FTS5 search with snippets and page jumps; inbox + rule-based suggestions | Search "KSh 25,000" finds the page offline |
| **5. AI gateway & features** | Worker, D1, session/integrity, limits, metering; ask/summarize/extract/classify/filename/translate/explain/compare; consent sheet; result cache | Server rejects over-limit/forged requests; per-request cost is logged |
| **6. AdMob** | UMP consent, banner, capped interstitials, rewarded + SSV credits | Ads never block core flows; offline = no ads, no errors |
| **7. Play subscription** | expo-iap, verify endpoint, RTDN, restore, paywall, entitlement cache with grace period | Pro removes all ads and prompts; entitlement survives reinstall |
| **8. Hardening** | Perf pass on low/mid/high devices, crash reporting, R8, AAB size budget, E2E (Maestro) flows, Play listing / data safety form | Release AAB within size budget; test matrix green |

---

## 12. Decisions

All resolved; see §0.

---

## 13. Phase 1 — as built (2026-09-25)

**Routes:** `(tabs)/{index,documents,scan,search,settings}`, `scan/index`, `document/[id]/{index,move}`, `folders/[id]`, `inbox`, `trash`, `settings/{storage,privacy}`, `+not-found`.

**Working now (Expo Go):**
- Documents: rename, favourite, archive, move to folder, mark as filed, trash with 30-day retention, restore, empty trash.
- Folders: create, rename, delete (documents become unfiled).
- Search over titles, using FTS5, with OCR page text wired in and awaiting Phase 4.
- Light, dark or system theme; storage usage; clearing the cache; privacy statement; error boundary.

**Explicitly pending:** the Scan screen says the scanner needs the Phase 2 native build. A development-only "Create empty test document" row in Settings lets the flows be exercised until then.

**Key implementation notes**
- Routes live in `src/app/`. Tabs use `expo-router/js-tabs`, because plain `Tabs` from `expo-router` is deprecated in SDK 57.
- NativeWind v4: colours are CSS variables set once on the root view from `src/theme/palette.js`. Tailwind, the navigation theme and icons all read that one palette. The theme preference is applied through `Appearance.setColorScheme`.
- Data flow: repositories are plain functions over the `SqlDb` interface and call `notifyChanged(topic)` after writes. `useDbQuery` re-runs queries for the topics it watches.
- Tests: repositories run against Node 24's built-in `node:sqlite`, which includes FTS5, so there's no native test dependency (`npm test`).
- Tooling: TypeScript 6 defaults `types` to `[]`, so `tsconfig.json` lists `jest` and `node` explicitly. `react-dom` is pinned to 19.2.3 in devDependencies to stop npm pulling a React 19.3 peer.
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (19 tests), `npx expo export --platform android`, `npx expo-doctor` (21/21). Not yet run on a device or emulator.

---

## 14. Phase 2 — as built (2026-09-25)

**Native module** `modules/docuna-native` (Kotlin Expo Module, Android only; loaded with `requireOptionalNativeModule`, so Expo Go still runs and shows an honest "not available in this preview"):

| Function | What it does |
|---|---|
| `isScannerAvailableAsync()` | Google Play services check (ML Kit scanner needs it) |
| `scanDocumentAsync({ pageLimit, allowGalleryImport })` | Opens the ML Kit Document Scanner (full mode: auto-capture, edge detection, crop, filters, multi-page, gallery import). Returns temp JPEG URIs or `null` on cancel |
| `processImageAsync({ sourceUri, outputUri, quad, rotation, filter, maxDimension, quality })` | Bounded decode (≤3000 px, `inSampleSize`), EXIF orientation, perspective warp (`Matrix.setPolyToPoly`), rotation, filters (enhanced colour matrix, grayscale, B&W via Otsu threshold), JPEG encode. One bitmap at a time, recycled eagerly |
| `getImageInfoAsync(uri)` | Oriented pixel size without decoding |

Gradle deps: `play-services-mlkit-document-scanner:16.0.0`, `androidx.exifinterface:1.4.2`. No OpenCV.

**Flows**
- **Scan:** Scan tab → ML Kit scanner opens immediately → pages are saved one at a time (with a progress count) → a document is created in the inbox → Review (name, folder, Add pages, Discard, Done). Pages are persisted before Review, so backing out never loses a scan.
- **Fallback** (no Play services): system camera or photo picker, then the manual Crop screen.
- **Page workspace** (`document/[id]/pages`): 3-column drag-to-reorder grid (react-native-sortables), with auto-scroll.
- **Page editor** (`document/[id]/page/[pageId]`): Crop, Rotate, Filter (Original / Enhanced / Grayscale / B&W), Duplicate, Replace, Delete. Includes a page strip, "Page n of N" and Saving…/Saved status.
- **Crop** (`…/crop`): four draggable corners on the untouched original (Reanimated 4 `get`/`set`, SVG outline); a convexity check blocks folded quads.

**Page file model:** every page has an untouched `original-*` file. Edits always re-render from the original (crop → rotate → filter), so quality never compounds; the result goes to `processed-*` plus `thumb-*`. File names are versioned on every write, so image caches never show stale pages. Superseded files are deleted after the DB commit, and new files are deleted if the commit fails. Any image change resets that page's OCR.

**Imports are all-or-nothing:** pages are prepared one by one, then inserted in one transaction. On failure, every written file is removed; a brand-new document is removed entirely.

**Permissions:**
- CAMERA: fallback capture only.
- RECORD_AUDIO: blocked.
- Storage permissions: capped at API 32; needed only by the camera fallback on Android 9 and older.
- `SYSTEM_ALERT_WINDOW`: blocked in production (dev-menu only).

**Tests:** 29 in total. They include page-service rollback and file clean-up (native image processing and the filesystem mocked, real SQLite) and the page-edit rules (rotation, crop normalisation, quad validity).

**Dev machine note:** the dev PC has 7.8 GB RAM. Don't run a Gradle native build and the emulator at the same time. Build first, then boot the emulator (or use a USB phone, or `eas build --profile development`).
