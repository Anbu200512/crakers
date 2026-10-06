import { socialLinkFor } from '../data/siteContent';
import { buildEnquiryPdf, enquiryPdfFileName, pdfMoney } from '../utils/enquiryDocument';

/**
 * Handing an enquiry to WhatsApp.
 *
 * One flow on every device: the PDF is built, uploaded once
 * (api/enquiry-pdf.js, Vercel Blob), and the shop's chat opens with the link
 * riding in the message. A wa.me URL takes text only, so the link is how the
 * document reaches the chat - phones and computers take the same path, always
 * landing on the shop's number. No server reachable: the chat still opens and
 * the PDF downloads beside it for a paperclip attach.
 */

const MAX_TEXT = 1800;
const PDF_UPLOAD_ENDPOINT = '/api/enquiry-pdf';
const UPLOAD_TIMEOUT_MS = 8000;

/** The link rides in the message itself, since only text fits in a wa.me URL. */
export const withPdfLink = (message, url) => (url ? `${message}\n\nPDF: ${url}` : message);

/** The prefilled chat message: the whole enquiry in readable, scannable form. */
export const enquiryMessageText = (enquiry) => {
  const items = Array.isArray(enquiry?.items) ? enquiry.items : [];
  const value = (text) => String(text || '').trim();

  const lines = [`Enquiry ${value(enquiry?.reference)}`.trim(), ''];
  if (value(enquiry?.name)) lines.push(`Name: ${value(enquiry?.name)}`);
  if (value(enquiry?.mobile)) lines.push(`Mobile: ${value(enquiry?.mobile)}`);
  if (value(enquiry?.city)) lines.push(`City: ${value(enquiry?.city)}`);
  if (value(enquiry?.occasion)) lines.push(`Occasion: ${value(enquiry?.occasion)}`);
  if (value(enquiry?.preferredContact)) lines.push(`Reply by: ${value(enquiry?.preferredContact)}`);

  if (items.length) {
    lines.push('', 'Items:');
    items.forEach((item, index) => {
      const pack = value(item.packSize) ? ` (${value(item.packSize)})` : '';
      lines.push(`${index + 1}. ${value(item.name) || 'Item'} x${Number(item.quantity) || 0}${pack}`);
    });
    lines.push('', `Listings: ${items.length}`);
  }

  if (enquiry?.indicativeTotal) lines.push(`Indicative total: ${pdfMoney(enquiry.indicativeTotal)}`);
  if (value(enquiry?.notes)) lines.push('', `Notes: ${value(enquiry.notes)}`);

  return clampMessage(lines.join('\n'));
};

const clampMessage = (text) => {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.slice(0, MAX_TEXT);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return `${cut.slice(0, lastBreak > 0 ? lastBreak : MAX_TEXT)}\n\n...details are in the PDF.`;
};

/** wa.me links carry the message as a query parameter; the base may already have one. */
export const whatsappChatHref = (whatsappLink, text) => {
  const base = String(whatsappLink || '').trim();
  if (!base) return '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}text=${encodeURIComponent(text)}`;
};

const downloadBlob = (blob, fileName) => {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
};

const openChat = (href) => {
  if (typeof document === 'undefined') return false;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
};

/**
 * The shop logo for the PDF header, fetched once per session and downscaled -
 * the nav logo is 1.25 MB, which would travel with every enquiry, while the
 * header draws it at 24 mm. Returns { dataUrl, width, height } or null; null
 * (no browser, failed fetch, no canvas) just leaves the PDF without its logo.
 */
let logoPromise = null;
const enquiryLogo = () => {
  // No location means no browser (smoke tests, SSR) - never fetch there.
  if (typeof location === 'undefined') return Promise.resolve(null);
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const response = await fetch('/images/logo/logo.png');
        if (!response.ok) return null;
        const file = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const image = new Image();
        const loaded = await new Promise((resolve) => {
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = dataUrl;
        });
        if (!loaded || !image.naturalWidth) return null;

        const MAX_WIDTH = 520;
        const scale = Math.min(1, MAX_WIDTH / image.naturalWidth);
        if (scale === 1) return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
      } catch {
        return null;
      }
    })();
  }
  return logoPromise;
};

/**
 * Uploads the PDF and returns its public URL, or null when the server is not
 * reachable (local dev without `vercel dev`, upload blocked, Blob store not
 * linked yet). The caller treats null as "fall back to downloading the file".
 */
export const uploadEnquiryPdf = async (blob, fileName) => {
  if (!blob || typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS) : null;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    // 32k windows keep the spread inside any engine's argument limit.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const response = await fetch(PDF_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({ name: fileName, data: btoa(binary) }),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const url = payload && typeof payload.url === 'string' ? payload.url : '';
    return /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Sends the enquiry: the PDF uploads once, then the shop's chat opens with its
 * link in the message - the same sequence on a phone and on a computer.
 *
 * Returns 'linked' (chat open with the PDF link in the message), 'opened'
 * (chat open, PDF downloaded beside it), 'downloaded' (PDF saved, no WhatsApp
 * link configured) or 'failed'.
 */
export const sendEnquiryToWhatsApp = async (enquiry, siteContent = {}) => {
  const contact = siteContent.contact || {};
  const message = enquiryMessageText(enquiry);
  const fileName = enquiryPdfFileName(enquiry);

  let blob = null;
  try {
    const logo = await enquiryLogo();
    blob = buildEnquiryPdf(enquiry, contact, logo).output('blob');
  } catch {
    // The prefilled message already carries every detail, so the chat below
    // still sends a complete enquiry even without the document.
  }

  // 1. The PDF goes up once and the chat opens with its link in the message.
  const pdfUrl = blob ? await uploadEnquiryPdf(blob, fileName) : null;
  const chatHref = whatsappChatHref(
    socialLinkFor('whatsapp', siteContent.social?.whatsapp),
    withPdfLink(message, pdfUrl),
  );
  const opened = chatHref ? openChat(chatHref) : false;

  // 2. No server reachable: the PDF downloads beside the open chat so the
  //    customer can attach it with the paperclip instead.
  let downloaded = false;
  if (blob && !pdfUrl) {
    try {
      downloaded = downloadBlob(blob, fileName);
    } catch {
      downloaded = false;
    }
  }

  if (opened) return pdfUrl ? 'linked' : 'opened';
  return downloaded ? 'downloaded' : 'failed';
};
