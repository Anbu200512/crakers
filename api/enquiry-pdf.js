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

  // The token appears only once a Blob store is connected to this project, and
  // functions read env vars at deploy time - a missing value means the store is
  // not linked or the project was not redeployed afterwards. Reported as its
  // own status so a dashboard step is never mistaken for a code bug.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error: 'BLOB_READ_WRITE_TOKEN is not set - connect a Blob store to this project and redeploy',
    });
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
  } catch (error) {
    // BlobError subclasses do not override .name (it stays "Error"), so the
    // class name is what tells a bad token (BlobAccessError) apart from a
    // suspended or missing store. Only the class leaves the server; the full
    // message goes to the function logs.
    const reason = error?.constructor?.name || error?.name || 'Error';
    console.error('[enquiry-pdf] upload failed:', reason, error?.message || error);
    res.status(502).json({ error: 'the upload could not be stored', reason });
  }
}
