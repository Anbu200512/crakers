import { socialLinkFor } from '../data/siteContent';
import { buildEnquiryPdf, enquiryPdfFileName, pdfMoney } from '../utils/enquiryDocument';

/**
 * Handing an enquiry to WhatsApp.
 *
 * A browser cannot attach a file to a wa.me link - the URL takes text only - so
 * the PDF reaches the shop one of two ways. On a phone the system share sheet
 * carries the file: the customer taps WhatsApp, then the shop, and the PDF
 * arrives in that chat alongside the message. Everywhere else the shop's chat
 * opens on the published number with the message pre-typed while the PDF
 * downloads beside it for a paperclip attach.
 */

const MAX_TEXT = 1800;

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
 * Hands the PDF to the phone's share sheet, which is the only way a file can
 * reach WhatsApp from a web page. Resolves true when the sheet accepted it; a
 * cancel, a failure or a browser without file sharing all resolve false so the
 * caller can fall back to the direct chat rather than dead-ending.
 */
const shareEnquiryPdf = async (enquiry, blob, fileName, message) => {
  const file = typeof File === 'function' ? new File([blob], fileName, { type: 'application/pdf' }) : null;
  const supported = Boolean(
    file &&
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] }),
  );
  if (!supported) return false;
  try {
    await navigator.share({ files: [file], title: `Enquiry ${enquiry?.reference || ''}`, text: message });
    return true;
  } catch {
    return false;
  }
};

/**
 * Sends the enquiry: the share sheet first where it exists, otherwise the
 * shop's chat opens on the published number and the PDF downloads beside it.
 *
 * Returns 'shared' (the sheet took the PDF), 'opened' (chat open, PDF
 * downloaded), 'downloaded' (PDF saved, no WhatsApp link configured) or
 * 'failed', so the caller can report what actually happened.
 */
export const sendEnquiryToWhatsApp = async (enquiry, siteContent = {}) => {
  const contact = siteContent.contact || {};
  const message = enquiryMessageText(enquiry);
  const chatHref = whatsappChatHref(socialLinkFor('whatsapp', siteContent.social?.whatsapp), message);
  const fileName = enquiryPdfFileName(enquiry);

  let blob = null;
  try {
    blob = buildEnquiryPdf(enquiry, contact).output('blob');
  } catch {
    // The prefilled message already carries every detail, so the chat below
    // still sends a complete enquiry even without the document.
  }

  if (blob && (await shareEnquiryPdf(enquiry, blob, fileName, message))) return 'shared';

  // Fallback - and the whole story on a computer. The chat opens first so that
  // landing on the published number is never held up by the download.
  const opened = chatHref ? openChat(chatHref) : false;
  let downloaded = false;
  if (blob) {
    try {
      downloaded = downloadBlob(blob, fileName);
    } catch {
      downloaded = false;
    }
  }

  if (opened) return 'opened';
  return downloaded ? 'downloaded' : 'failed';
};
