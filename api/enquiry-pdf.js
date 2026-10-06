import { put } from '@vercel/blob';

/**
 * Stores an enquiry PDF in Vercel Blob and returns its public URL, so the
 * desktop flow can put a real link into the WhatsApp message instead of asking
 * the customer to attach the file by hand.
 *
 * The endpoint is open on purpose (the shop's visitors have no login), so it is
 * narrow about what it accepts: one POST, base64 PDF bodies only, checked by
 * magic bytes and capped in size. Anything else is refused before it can reach
 * the store.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, data } = req.body || {};
  if (typeof name !== 'string' || typeof data !== 'string' || !data) {
    res.status(400).json({ error: 'name and data are required' });
    return;
  }

  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) {
    res.status(400).json({ error: 'the file is empty' });
    return;
  }
  if (buffer.length > 3_000_000) {
    res.status(413).json({ error: 'the file is too large' });
    return;
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    res.status(415).json({ error: 'only PDF files are accepted' });
    return;
  }

  try {
    const safeName = name.replace(/[^\w.-]/g, '').slice(-80) || `enquiry-${Date.now()}.pdf`;
    const blob = await put(`enquiries/${Date.now()}-${safeName}`, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: true,
    });
    res.status(200).json({ url: blob.url });
  } catch {
    // Most often a missing BLOB_READ_WRITE_TOKEN - the store has not been
    // linked yet. The caller reads the failure and downloads the PDF instead.
    res.status(502).json({ error: 'the upload could not be stored' });
  }
}
