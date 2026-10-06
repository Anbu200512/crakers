import assert from 'node:assert/strict';

// The enquiry flow runs in the browser, so the two surfaces it touches -
// local storage and the anchors it clicks - are stubbed with just enough shape.
const store = new Map();
const localStorageStub = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.window = {
  localStorage: localStorageStub,
  atob,
  btoa,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};
globalThis.localStorage = localStorageStub;

const clickedAnchors = [];
globalThis.document = {
  createElement: () => {
    const anchor = {
      href: '',
      download: '',
      target: '',
      rel: '',
      style: {},
      click() {
        clickedAnchors.push({ href: this.href, download: this.download, target: this.target });
      },
      remove() {},
    };
    return anchor;
  },
  body: { appendChild() {} },
};

// The upload endpoint is stubbed offline by default so the download fallback is
// exercised the way a visitor without a reachable server experiences it. The
// link path swaps fetchBehaviour for a successful store response.
const fetchCalls = [];
let fetchBehaviour = async () => {
  throw new Error('no server reachable');
};
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init });
  return fetchBehaviour(url, init);
};
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:stub';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

const siteContent = await import('../src/frontend/data/siteContent.js');
const { submitEnquiry, enquirySubmissionStorageKey } = await import('../src/frontend/services/enquiries.js');
const { enquiryMessageText, whatsappChatHref, sendEnquiryToWhatsApp } = await import('../src/frontend/services/whatsapp.js');
const { buildEnquiryPdf, enquiryPdfFileName } = await import('../src/frontend/utils/enquiryDocument.js');

const results = [];
const check = (name, run) => {
  try {
    run();
    results.push(`PASS  ${name}`);
  } catch (error) {
    results.push(`FAIL  ${name}: ${error.message}`);
  }
};

const enquiry = await submitEnquiry({
  name: 'Ravi Kumar',
  mobile: '9000000000',
  email: 'ravi@example.com',
  address: '12, Main Street, Sivakasi',
  pin: '626189',
  city: 'Sivakasi',
  occasion: 'Diwali',
  preferredContact: 'WhatsApp message',
  notes: 'Deliver after 6pm',
  indicativeTotal: 6340,
  items: [
    // Cart rows carry `price`, not `customerPrice` - the shape the real cart hands over.
    { id: 'flower-pots-big', name: 'Flower Pots (Big)', category: 'Flower Pots', packSize: '1 Box', quantity: 10, price: 450 },
    { id: 'rocket-10', name: '10 Shot Rockets', category: 'Rockets', packSize: '1 Pack', quantity: 2, price: 920 },
  ],
});

const chatBase = siteContent.socialLinkFor('whatsapp', siteContent.siteContentDefaults.social.whatsapp);
const chatHref = whatsappChatHref(chatBase, enquiryMessageText(enquiry));

check('the published WhatsApp line is the shop number', () => {
  assert.equal(siteContent.siteContentDefaults.social.whatsapp, 'https://wa.me/916374114513');
  assert.equal(chatBase, 'https://wa.me/916374114513');
});

check('a stored copy holding the old WhatsApp number is re-seeded', () => {
  const stale = siteContent.mergeSiteContent({
    detailsVersion: 4,
    social: { whatsapp: 'https://wa.me/919442521144' },
  });
  assert.equal(stale.social.whatsapp, 'https://wa.me/916374114513');
});

check('the submitted enquiry is recorded locally with a reference', () => {
  assert.match(enquiry.reference, /^ENQ-[A-Z0-9]+$/);
  const stored = JSON.parse(localStorageStub.getItem(enquirySubmissionStorageKey));
  assert.equal(stored[0].reference, enquiry.reference);
  assert.equal(stored[0].items.length, 2);
  assert.equal(stored[0].items[0].customerPrice, 450, 'the cart price survives into the enquiry the PDF draws');
});

check('the chat message lists the customer, the items and the total', () => {
  const message = enquiryMessageText(enquiry);
  assert.match(message, /Enquiry ENQ-/);
  assert.match(message, /Name: Ravi Kumar/);
  assert.match(message, /Mobile: 9000000000/);
  assert.match(message, /1\. Flower Pots \(Big\) x10 \(1 Box\)/);
  assert.match(message, /Indicative total: Rs 6,340/);
  assert.match(message, /Deliver after 6pm/);
});

check('the chat link opens the shop WhatsApp with that message', () => {
  assert.ok(chatHref.startsWith('https://wa.me/916374114513?text='), chatHref);
  assert.match(decodeURIComponent(chatHref), /Name: Ravi Kumar/);
});

check('the enquiry PDF is a real PDF file', () => {
  const doc = buildEnquiryPdf(enquiry, siteContent.siteContentDefaults.contact);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF');
  assert.ok(bytes.includes('%%EOF'), 'the PDF carries its end marker');
  assert.ok(bytes.length > 4000, `expected a full page, got ${bytes.length} bytes`);
  assert.match(enquiryPdfFileName(enquiry), /^Enquiry-ENQ-[A-Z0-9]+-\d{4}-\d{2}-\d{2}\.pdf$/);
});

// With no server reachable the upload fails fast, so the chat still opens on
// the published number and the PDF downloads beside it to attach by hand.
fetchCalls.length = 0;
clickedAnchors.length = 0;
try {
  const outcome = await sendEnquiryToWhatsApp(enquiry, siteContent.mergeSiteContent(null));
  assert.equal(outcome, 'opened');
  assert.equal(fetchCalls[0]?.url, '/api/enquiry-pdf', 'the upload was attempted first');
  assert.equal(clickedAnchors[0]?.target, '_blank', 'the chat opens');
  assert.ok(clickedAnchors[0].href.startsWith('https://wa.me/916374114513?text='), clickedAnchors[0].href);
  assert.match(decodeURIComponent(clickedAnchors[0].href), /Name: Ravi Kumar/);
  const download = clickedAnchors.find((anchor) => anchor.download);
  assert.ok(download, 'the PDF was downloaded to attach');
  assert.match(download.download, /^Enquiry-ENQ-.+\.pdf$/);
  results.push('PASS  without a server the chat opens and the PDF downloads');
} catch (error) {
  results.push(`FAIL  without a server the chat opens and the PDF downloads: ${error.message}`);
}

// The phone path: when the browser offers a share sheet that accepts files, the
// PDF goes through it - the only way a file can reach WhatsApp from a web page -
// and nothing opens behind it.
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const sharedCalls = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    share: async (data) => sharedCalls.push(data),
    canShare: () => true,
  },
});
try {
  clickedAnchors.length = 0;
  const outcome = await sendEnquiryToWhatsApp(enquiry, siteContent.mergeSiteContent(null));
  assert.equal(outcome, 'shared');
  assert.equal(sharedCalls.length, 1, 'the share sheet was called once');
  assert.equal(sharedCalls[0].files.length, 1, 'the PDF rode along as the only file');
  assert.match(sharedCalls[0].files[0].name, /^Enquiry-ENQ-.+\.pdf$/);
  assert.equal(sharedCalls[0].files[0].type, 'application/pdf');
  assert.match(sharedCalls[0].text, /Name: Ravi Kumar/);
  assert.equal(clickedAnchors.length, 0, 'no chat or download is triggered behind the sheet');
  results.push('PASS  the phone share sheet receives the PDF and the message');
} catch (error) {
  results.push(`FAIL  the phone share sheet receives the PDF and the message: ${error.message}`);
}

// A cancelled share sheet must not dead-end: the direct chat on the published
// number opens anyway, with the PDF downloaded beside it.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    share: async () => {
      const cancelled = new Error('user closed the sheet');
      cancelled.name = 'AbortError';
      throw cancelled;
    },
    canShare: () => true,
  },
});
try {
  clickedAnchors.length = 0;
  const outcome = await sendEnquiryToWhatsApp(enquiry, siteContent.mergeSiteContent(null));
  assert.equal(outcome, 'opened');
  assert.equal(clickedAnchors[0]?.target, '_blank', 'the direct chat still opens');
  assert.ok(clickedAnchors[0].href.startsWith('https://wa.me/916374114513?text='), clickedAnchors[0].href);
  assert.ok(clickedAnchors.some((anchor) => anchor.download), 'the PDF still downloads for a manual attach');
  results.push('PASS  a cancelled share sheet falls back to the direct chat');
} catch (error) {
  results.push(`FAIL  a cancelled share sheet falls back to the direct chat: ${error.message}`);
} finally {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else delete globalThis.navigator;
}

// The computer path: the PDF is uploaded once and the chat opens with its link
// inside the message - no attachment, nothing left to download.
fetchCalls.length = 0;
clickedAnchors.length = 0;
fetchBehaviour = async () => ({
  ok: true,
  json: async () => ({ url: 'https://shop.public.blob.vercel-storage.com/enquiries/1-enquiry.pdf' }),
});
try {
  const outcome = await sendEnquiryToWhatsApp(enquiry, siteContent.mergeSiteContent(null));
  assert.equal(outcome, 'linked');
  assert.equal(fetchCalls.length, 1, 'the PDF was uploaded exactly once');
  assert.equal(fetchCalls[0].url, '/api/enquiry-pdf');
  assert.equal(fetchCalls[0].init.method, 'POST');
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.match(body.name, /^Enquiry-ENQ-.+\.pdf$/);
  assert.ok(body.data.length > 0, 'the PDF rode along as base64');
  assert.equal(clickedAnchors.length, 1, 'only the chat opens - nothing to download');
  assert.equal(clickedAnchors[0].target, '_blank');
  assert.match(
    decodeURIComponent(clickedAnchors[0].href),
    /PDF: https:\/\/shop\.public\.blob\.vercel-storage\.com\/enquiries\/1-enquiry\.pdf/,
  );
  results.push('PASS  the chat message carries an uploaded PDF link');
} catch (error) {
  results.push(`FAIL  the chat message carries an uploaded PDF link: ${error.message}`);
} finally {
  fetchBehaviour = async () => {
    throw new Error('no server reachable');
  };
}

for (const line of results) console.log(line);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
else console.log(`ok - ${results.length} checks passed`);
