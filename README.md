# Can My Wheelchair Fit? （我的輪椅進得去嗎）

**Question:** "Can my wheelchair get into the elevator at *this address*?"
**Answer:** one verdict with the evidence behind it, from Taiwan's national elevator registry.

Every new place says "we have an elevator". This tool asks the registry which cars are actually
registered at the address, decodes the registered spec string (capacity class, door, floors served)
into a cabin size, and compares it with your wheelchair.

Built solo in 90 minutes at **Claude Taipei Build Day, 2026-09-20**, typed with one finger. The demo narration is my cloned voice.

## Verdicts

| Verdict | Rule (checked top to bottom, first match wins) |
|---|---|
| ✅ **FITS** | gets through the door, fits inside, and can turn around (cabin short side ≥ 2 × turning radius — our own reference threshold) |
| ⚠️ **STRAIGHT-IN ONLY** | gets in and fits, but cannot turn — ride in, back out |
| ⚠️❌ **SQUEEZE** | cabin depth < chair length — footrests must come off |
| ❌ **CAN'T ENTER** | door width < chair width + 50 mm |
| ❌ **NO ELEVATOR** | nothing registered at the address, only park / car-park lifts, or no car serves that floor |

The card shows *why*: door, cabin, chair numbers, floors served, the registry spec string, device ID
and the building's occupancy permit. Change the wheelchair preset and the verdict recomputes live.

## How it works

1. **Address in** — Chinese (`台北市大安區忠孝東路三段54號`) or Chunghwa Post English
   (`No. 54, Sec. 3, Zhongxiao E. Rd., Da'an Dist., Taipei City`). Display is English, from static
   romanisation tables.
2. **Registry lookup** (`src/els.mjs`) — the national elevator registry
   [ELS](https://cloudbm.nlma.gov.tw/ELS/ELSQuery.do): query page tokens → captcha (solved by the
   human, never by the machine) → list query → page size 200 → one detail page per elevator.
   Every response is stored in a JSON cache keyed by the query (`cache/`); a cache hit needs no captcha.
3. **Address degradation chain** (`src/lookup.mjs`) — registry keys are not postal addresses:
   * exact address → numeral-form variants (`三段` ↔ `3段` are disjoint sets in the registry; the
     clinic at 忠孝東路三段54號 is only found under `3段`);
   * occupancy-permit expansion — cars of the same 使用執照 registered under a sibling number (52號 + 54號);
   * park / car-park lifts (`公園`, `停車場`) are excluded — they pass the device-type filter but are not building elevators;
   * **sideways link** — a mechanical-parking row on the queried number proves the address exists and
     points to the sibling number that holds the elevators (承德路二段215號 parking ↔ 217號 elevators,
     same permit `084-0202` = `084-00202`). Candidates are ranked STRONG (same normalised permit) /
     MEDIUM (name overlap + adjacent same-parity number) / WEAK (proximity only) and **the human confirms**
     before any verdict is shown. If still unsure: the permit sticker inside the car is the ground truth.
4. **Spec decoding** (`src/parse.mjs`) — `P24 1600-CO 150-16 S/1 -16F` = 24 persons / 1600 kg,
   centre-opening door, 150 m/min, 16 stops, floors 1–16. Only `P`/`B` passenger codes count;
   escalators (`C…`) and parking devices (`I`/`K`/`N`/`G…`) are filtered by ID prefix and 設備種類.
5. **Cabin size** (`src/dimensions.mjs`) — JIS A 4301 capacity class → width × depth × door, one table
   for every vendor (P8 = 1400×1030/800 … P24 = 2000×1750/1100). The registry never says
   machine-room (MR) vs machine-room-less (MRL); for small cars the card states the assumption, and a
   permit older than 1999 pins the MR variant.
6. **Judgment** (`src/judge.mjs`) — pure function, shared by server and browser.

## Data sources

* **Taiwan national elevator registry** — 內政部國土管理署 全國建築管理資訊系統 ELS,
  https://cloudbm.nlma.gov.tw/ELS/ELSQuery.do (public, captcha-protected, no login).
* **JIS A 4301** cabin dimensions by capacity class, via public manufacturer catalogs (Mitsubishi MR
  series, cross-checked with Fujitec). Reference estimates: door width and geometry still vary by vendor.
* **Karma** official wheelchair specs: Leon 1060×620 R800, KP-40 1180×665 R900, KP-80 1205×640 R745,
  eFlexx 1085×565 R740, EVO (Altus) 1200×660 R750. Custom L/W/R inputs are supported. The product photos
  in `public/chairs/` are from Karma's official product pages (© Karma Medical), stored locally so the demo
  does not depend on the venue network.

## Fairness note

Prompts, domain research (request sequence, field names, spec-string format, address-resolution
facts), the raw HTML fixtures, public reference data and the dimension table (compiled beforehand from
public manufacturer catalogs) were prepared **before** the event. **Every line of code in this
repository was written during the event** — see the commit log.

The live registry path (`src/els.mjs`) was verified end-to-end with curl on 2026-09-18 (captcha check
→ list → page size 200 with the 302 followed → detail spec). On Build Day itself nothing was queried
live: the cache was seeded from raw HTML responses captured on 2026-09-18 and 2026-09-20
(`npm run seed`), so the demo runs 100 % from cache, and no captcha was typed during the event.

## Run

```bash
npm install          # cheerio only
npm test             # parsers on the raw fixtures + end-to-end over the seeded cache
npm start            # http://localhost:3000  (binds 0.0.0.0)
```

`cache/` ships in the repo, so the five demo addresses work offline. A new address is a cache miss:
the page shows the registry captcha, you type it, and the app runs the live sequence (one session,
5-minute keep-alive). "Live query" bypasses the cache.

API: `GET /api/check?address=&floor=&chair=Leon|KP-40|KP-80|eFlexx|EVO[&length=&width=&radius=][&live=1]`,
`GET /api/session` → `{alive, passedAt}`, `GET /api/captcha`, `POST /api/captcha/check {code}`, `GET /api/recent`.

## Demo-driver contract

The on-stage demo is driven by a Playwright script on the narration's timestamps (my muscle control
is not reliable enough for live clicking). The page provides six `data-testid`s from first paint:
`address-input`, `floor-input`, `wheelchair-select` (native `<select>`, option values `Leon`, `KP-40`,
`KP-80`, `eFlexx`, `EVO`), `check-button`, `result-card`, `result-verdict`.

## Known limitations

* The registry's accessibility flags (無障礙, 設置無障礙設施) are never populated — the tool infers
  everything from the spec string and says so.
* One building's devices may be registered under a neighbouring number, a different numeral form or a
  different name — which is why the tool shows evidence and confidence instead of a bare yes/no.
* No real-estate open data and no 門牌 coordinate layer: candidates are ranked by registry evidence only.
  Listing-site "community" groupings are deliberately not used (they merge different buildings — e.g.
  忠孝東路三段54號 is *not* 至德大樓 at 86/88號: different permit, different floor coverage).
* Cabin sizes are JIS class estimates, not measurements; MR/MRL is stated as an assumption when unknown.
* Taipei City only (district codes); other cities need their city/district codes added.
* Romanisation tables cover the demo roads and all Taipei districts; unknown road names stay in Chinese.
* Open-data advocacy: the national building-management open API defines an elevator dataset but it is
  not published yet and has no spec field — this tool shows what that field would make possible.
