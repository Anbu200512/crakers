# Anish Enterprises - Crackers Shop

Enquiry-based storefront for a wholesale crackers outlet in Sivakasi. The
customer shortlists products, sends the cart as an enquiry, and the enquiry
reaches the shop **on WhatsApp as a message plus a PDF** - no accounts, no
checkout, no payment on the site.

| Layer | Where it lives | Stack |
|---|---|---|
| Storefront | `src/frontend/` | React 18, Vite 6, Tailwind 3, React Router 6 |
| Enquiry PDF upload | `api/enquiry-pdf.js` | Vercel serverless function + Vercel Blob |

Everything else runs in the browser. The shop's WhatsApp number is configured
once in `src/frontend/data/siteContent.js` (`social.whatsapp`).

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 20 |
| npm | >= 10 |

---

## 2. Quick start

One terminal.

```bash
npm install
npm run dev
```

Then open <http://localhost:5000>.

---

## 3. Running it

```bash
npm run dev        # Vite dev server with hot reload on http://localhost:5000
npm run build      # Vite writes dist/
npm start          # preview the built dist/ on http://localhost:5000
npm run serve:prod # the same preview
```

Plain `npm run dev` serves only the frontend, so the PDF-upload call has
nowhere to go and the enquiry flow falls back to downloading the PDF beside the
opened chat. To exercise the upload locally, run `vercel dev` instead (it
serves Vite *and* the `api/` function).

---

## 4. How an enquiry reaches WhatsApp

The customer adds products to the cart, opens **Send this cart as an enquiry**,
fills the form and presses **Send enquiry**. `src/frontend/services/whatsapp.js`
then runs one sequence on every device, phone and computer alike:

1. **Build the PDF.** `src/frontend/utils/enquiryDocument.js` lays the enquiry
   out as an A4 document (jsPDF, Helvetica): the customer's details on the top
   left, the shop - logo, name, address and phone lines - on the top right.
2. **Upload it once.** The PDF is POSTed to `/api/enquiry-pdf`, stored in
   Vercel Blob, and the chat opens (`wa.me/916374114513`) with `PDF: <url>`
   inside the prefilled message. The button reads "Opening WhatsApp..." during
   the wait, so the click cannot double-fire.
3. **No server reachable.** The chat still opens with the full enquiry as the
   message, and the PDF downloads beside it for a paperclip attach.

A wa.me link can carry text only - a browser can never attach a file to a
specific chat on its own - which is why the PDF travels as a link. Opening the
chat on the shop's number directly is also why there is no "pick a contact"
step.

The enquiry itself is also saved in `localStorage`
(`spark-shine-enquiries`) so the reference stays available on the success
screen.

---

## 5. Data ownership

The browser is the source of truth; clearing site data resets everything.

- **Catalogue** - seeded static data under `src/frontend/data/`.
- **Cart / shortlist** - `spark-shine-cart`.
- **Sent enquiries** - `spark-shine-enquiries` (reference + details, local copy).
- **Site content** - announcement, contact, social links, highlights, FAQs
  (`spark-shine-site-content` and friends).
- **Uploaded PDFs** - Vercel Blob, only when step 2 above succeeds; each file
  gets a random-suffixed public URL.

---

## 6. Common tasks

```bash
# Run and build
npm run dev
npm run build
npm start                   # preview dist/

# Checks
npm run lint                # ESLint over src/frontend
npm run typecheck           # tsc against jsconfig.json
npm test                    # smoke tests (catalog + WhatsApp enquiry flow)
npm run test:whatsapp       # just the enquiry -> WhatsApp flow
npm run verify              # imports + lint + typecheck + test + build
npm run check:images        # renders product artwork through Vite's SSR
npm run check:theme         # theme, contrast, light-surface and encoding audits
```

---

## 7. Repository layout

```
crackers/
├── src/
│   └── frontend/
│       ├── pages/        storefront screens (catalog, cart, enquiry, contact...)
│       ├── components/   shared UI, catalog/ sub-components, WhatsAppButton
│       ├── context/      Content, Catalog, Cart providers
│       ├── hooks/        useCatalog, useCart, useContent, useSeo, ...
│       ├── services/     enquiries (local save), whatsapp (send flow)
│       ├── data/         catalog seed, site content (WhatsApp number), FAQ
│       └── utils/        storage, format, images, enquiryDocument (PDF)
├── api/
│   └── enquiry-pdf.js    Vercel function: stores the PDF, returns its URL
├── public/               images/, bg/, favicons
├── scripts/              image manifest, smoke tests, static audits
├── index.html            Vite entry, loads /src/frontend/main.jsx
├── vite.config.js        root is the repo root, output is dist/, port 5000
└── package.json          the only package.json
```

---

## 8. The one endpoint

| Endpoint | Behaviour |
|---|---|
| `POST /api/enquiry-pdf` | body `{ name, data }` (base64 PDF) -> `{ url }`. PDFs only, 3 MB cap, magic-byte checked. |

It exists purely so the flow can put a link to the PDF into the WhatsApp
message. Without it configured, step 3 above takes over and nothing breaks.

---

## 9. Deploying to Vercel

1. Import the repo - Vercel detects Vite (`npm run build`, output `dist/`).
   The `api/` directory is deployed as serverless functions automatically.
2. In the project dashboard: **Storage -> Create -> Blob**, then attach the
   store to the project so `BLOB_READ_WRITE_TOKEN` is set as an environment
   variable.
3. Redeploy - step 2 (PDF as a link) now works everywhere; without step 2 the
   site still works and always falls back to step 3.

Notes:

- The Blob URLs are public (anyone with the link can open the PDF), so treat
  them as unguessable but not secret.
- `/api/enquiry-pdf` is unauthenticated by design (visitors have no accounts);
  it only accepts small PDF-shaped bodies.
