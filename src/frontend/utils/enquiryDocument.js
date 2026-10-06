import { jsPDF } from 'jspdf';
import { contactLines, contactPhoneLines } from '../data/siteContent';

/**
 * The enquiry sheet the customer sends on WhatsApp.
 *
 * A single A4 page built straight from the enquiry record: a two-column header
 * with the customer's details on the top left and the shop - logo, name,
 * address and phone lines - on the top right, then every cart line with its
 * quantity and indicative amount, and the totals with the "prices confirmed on
 * reply" note. jsPDF draws with the standard Helvetica face, which only covers
 * Latin-1, so every string passes through pdfSafe first - the rupee sign
 * becomes "Rs" and typographic dashes become plain ASCII, rather than landing
 * in the PDF as garbage glyphs.
 *
 * The logo is optional (the third argument): without it - a failed fetch, or a
 * build outside the browser - the header simply starts with the shop name.
 */

const MARGIN = 14;
const RIGHT_EDGE = 210 - MARGIN;
const CONTENT_WIDTH = RIGHT_EDGE - MARGIN;
const BOTTOM_LIMIT = 283;

const INK = [30, 30, 30];
const MUTED = [120, 120, 120];
const RULE = [214, 210, 202];
const HEAD_FILL = [244, 242, 237];

const pdfSafe = (value) =>
  String(value ?? '')
    .replace(/₹/g, 'Rs ')
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xFF]/g, '?');

export const pdfMoney = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const enquiryPdfFileName = (enquiry) => {
  const reference = pdfSafe(enquiry?.reference || 'enquiry').replace(/[^\w-]/g, '');
  const day = new Date().toISOString().slice(0, 10);
  return `Enquiry-${reference}-${day}.pdf`;
};

export const buildEnquiryPdf = (enquiry, contact = {}, logo = null) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let y = MARGIN;

  const ensureRoom = (needed) => {
    if (y + needed <= BOTTOM_LIMIT) return false;
    doc.addPage();
    y = MARGIN + 4;
    return true;
  };

  const rule = (gapAfter = 4) => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, RIGHT_EDGE, y);
    y += gapAfter;
  };

  const wrap = (text, size, style = 'normal', width = CONTENT_WIDTH) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    return doc.splitTextToSize(pdfSafe(text), width);
  };

  const writeWrapped = (text, { size = 9.5, style = 'normal', color = INK, width = CONTENT_WIDTH, leading = 4.6, gapAfter = 0 } = {}) => {
    const lines = wrap(text, size, style, width);
    for (const line of lines) {
      ensureRoom(leading + 2);
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(line, MARGIN, y);
      y += leading;
    }
    y += gapAfter;
    return lines.length;
  };

  const field = (label, value, x, width) => {
    if (!String(value || '').trim()) return;
    const labelText = `${label}: `;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const labelWidth = doc.getTextWidth(pdfSafe(labelText));
    const lines = doc.splitTextToSize(pdfSafe(String(value)), width - labelWidth);
    doc.text(labelText, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(lines[0] || '', x + labelWidth, y);
    let index = 1;
    while (index < lines.length) {
      y += 4.6;
      ensureRoom(8);
      doc.text(lines[index], x + labelWidth, y);
      index += 1;
    }
    y += 5.2;
  };

  const section = (title) => {
    ensureRoom(14);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfSafe(title.toUpperCase()), MARGIN, y);
    y += 4.4;
  };

  const columns = [
    { label: '#', x: MARGIN, width: 8, align: 'left' },
    { label: 'Item', x: MARGIN + 8, width: 84, align: 'left' },
    { label: 'Pack', x: MARGIN + 94, width: 30, align: 'left' },
    { label: 'Qty', x: MARGIN + 132, width: 14, align: 'right' },
    { label: 'Rate', x: MARGIN + 146, width: 24, align: 'right' },
    { label: 'Amount', x: MARGIN + 170, width: 12, align: 'right' },
  ];

  const tableHeader = () => {
    doc.setFillColor(...HEAD_FILL);
    doc.rect(MARGIN, y - 4.2, CONTENT_WIDTH, 6.4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    for (const column of columns) {
      const right = column.align === 'right';
      doc.text(pdfSafe(column.label), right ? column.x + column.width : column.x, y, { align: right ? 'right' : 'left' });
    }
    y += 6.4;
  };

  // ------------------------------------------------- header: customer | shop
  // Top left holds the customer's details, top right the shop under its logo -
  // the two sides of the enquiry, side by side before the table starts. Each
  // column keeps its own cursor so neither side can push the other down.
  const GUTTER = 8;
  const columnWidth = (CONTENT_WIDTH - GUTTER) / 2;

  let leftY = y;
  const leftField = (label, value) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const labelText = `${label}: `;
    const labelWidth = doc.getTextWidth(pdfSafe(labelText));
    doc.text(labelText, MARGIN, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(pdfSafe(text), columnWidth - labelWidth);
    lines.forEach((line, index) => {
      if (index > 0) leftY += 4.6;
      doc.text(line, index === 0 ? MARGIN + labelWidth : MARGIN, leftY);
    });
    leftY += 5.2;
  };

  leftField('Name', enquiry?.name);
  leftField('Mobile', enquiry?.mobile);
  leftField('City', enquiry?.city);
  leftField('PIN', enquiry?.pin);
  leftField('Address', enquiry?.address);
  leftField('Email', enquiry?.email);
  leftField('Occasion', enquiry?.occasion);
  leftField('Reply via', enquiry?.preferredContact);

  let rightY = y;
  const LOGO_WIDTH = 24;
  if (logo?.dataUrl) {
    try {
      const aspect = (Number(logo.height) || 0) / (Number(logo.width) || 1);
      if (aspect > 0) {
        doc.addImage(logo.dataUrl, 'PNG', RIGHT_EDGE - LOGO_WIDTH, rightY, LOGO_WIDTH, LOGO_WIDTH * aspect);
        rightY += LOGO_WIDTH * aspect + 3.5;
      }
    } catch {
      // A logo the decoder cannot read must never sink the enquiry itself.
    }
  }
  const rightLine = (text, { size, style = 'normal', color = MUTED, leading = 4.4 } = {}) => {
    if (!String(text || '').trim()) return;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfSafe(text), columnWidth);
    lines.forEach((line, index) => {
      if (index > 0) rightY += leading;
      doc.text(line, RIGHT_EDGE, rightY, { align: 'right' });
    });
    rightY += leading;
  };

  rightLine(contact.businessName || 'Anish Enterprises', { size: 13, style: 'bold', color: INK, leading: 6 });
  rightLine(contactLines(contact), { size: 8.5, leading: 4.2 });
  rightLine(
    [...contactPhoneLines(contact).map((line) => line.value), contact.email].filter(Boolean).join(' - '),
    { size: 8.5, leading: 4.2 },
  );

  y = Math.max(leftY, rightY) + 2;
  rule(6);

  // ---------------------------------------------------------------- enquiry line
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text('ENQUIRY', MARGIN, y);

  const created = new Date(enquiry?.createdAt || Date.now());
  const stamp = created.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(pdfSafe(`${enquiry?.reference || ''}  ·  ${stamp}`), RIGHT_EDGE, y, { align: 'right' });
  y += 5;
  rule(7);

  // ---------------------------------------------------------------- notes
  // The header already carries the contact details; only free-form notes are
  // still worth a full-width block before the table starts.
  if (String(enquiry?.notes || '').trim()) {
    y += 2;
    field('Notes', enquiry.notes, MARGIN, CONTENT_WIDTH);
  }

  // ---------------------------------------------------------------- items
  section('Items');
  tableHeader();

  const items = Array.isArray(enquiry?.items) ? enquiry.items : [];
  items.forEach((item, index) => {
    const nameLines = doc.splitTextToSize(pdfSafe(item.name || 'Item'), 80).slice(0, 2);
    const rowHeight = Math.max(6, 4.4 * nameLines.length + 2.2);
    if (y + rowHeight > BOTTOM_LIMIT) {
      doc.addPage();
      y = MARGIN + 4;
      tableHeader();
    }

    const baseline = y + 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(String(index + 1), columns[0].x, baseline);

    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    nameLines.forEach((line, lineIndex) => doc.text(line, columns[1].x, baseline + lineIndex * 4.4));

    doc.setTextColor(...MUTED);
    doc.text(pdfSafe(item.packSize || ''), columns[2].x, baseline);
    doc.text(String(item.quantity || 0), columns[3].x + columns[3].width, baseline, { align: 'right' });
    doc.text(pdfMoney(item.customerPrice), columns[4].x + columns[4].width, baseline, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(pdfMoney((Number(item.customerPrice) || 0) * (Number(item.quantity) || 0)), columns[5].x + columns[5].width, baseline, { align: 'right' });

    y += rowHeight;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.1);
    doc.line(MARGIN, y - 0.6, RIGHT_EDGE, y - 0.6);
  });

  if (!items.length) {
    writeWrapped('No items were listed with this enquiry.', { size: 9, color: MUTED, gapAfter: 2 });
  }

  // ---------------------------------------------------------------- totals
  y += 3;
  ensureRoom(24);
  const total = items.reduce(
    (sum, item) => sum + (Number(item.customerPrice) || 0) * (Number(item.quantity) || 0),
    0,
  );
  const listingCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(pdfSafe(`${items.length} listing${items.length === 1 ? '' : 's'} · ${listingCount} units`), MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('INDICATIVE TOTAL', RIGHT_EDGE - 44, y, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(pdfMoney(enquiry?.indicativeTotal || total), RIGHT_EDGE, y + 0.4, { align: 'right' });
  y += 7;
  rule(6);

  writeWrapped(
    'Indicative rates as listed. Final price, stock availability and delivery are confirmed by our team on WhatsApp before anything is dispatched. No payment has been taken with this enquiry.',
    { size: 8, color: MUTED, leading: 4, gapAfter: 3 },
  );
  writeWrapped(pdfSafe(`Enquiry ${enquiry?.reference || ''} · generated ${stamp}`), {
    size: 7.5,
    color: MUTED,
    leading: 3.8,
  });

  doc.setProperties({
    title: `Enquiry ${enquiry?.reference || ''}`,
    subject: 'Storefront enquiry from Anish Enterprises',
    creator: contact.businessName || 'Anish Enterprises',
  });

  return doc;
};
