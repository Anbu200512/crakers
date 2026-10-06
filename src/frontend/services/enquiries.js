import { readArray, writeStorage } from '../utils/storage';

export const enquirySubmissionStorageKey = 'spark-shine-enquiries';

const sanitizeEnquiry = (value) => {
  if (!value || typeof value !== 'object' || !value.reference) return null;
  return {
    reference: String(value.reference),
    createdAt: value.createdAt || new Date().toISOString(),
    name: String(value.name || ''),
    mobile: String(value.mobile || ''),
    email: String(value.email || ''),
    address: String(value.address || ''),
    pin: String(value.pin || ''),
    city: String(value.city || ''),
    occasion: String(value.occasion || ''),
    notes: String(value.notes || ''),
    preferredContact: String(value.preferredContact || 'Phone call'),
    items: Array.isArray(value.items)
      ? value.items.map((item) => ({
          id: String(item.id || ''),
          name: String(item.name || ''),
          category: String(item.category || ''),
          packSize: String(item.packSize || ''),
          quantity: Number(item.quantity) || 0,
          // Cart rows carry `price`; older enquiry rows carry `customerPrice`.
          // Both are normalised here so the PDF always has one field to draw.
          customerPrice: Number(item.customerPrice ?? item.price) || 0,
        }))
      : [],
    indicativeTotal: Number(value.indicativeTotal) || 0,
  };
};

const storedEnquiries = () => readArray(enquirySubmissionStorageKey).map(sanitizeEnquiry).filter(Boolean);

const createReference = () => {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `ENQ-${stamp}${suffix}`;
};

/**
 * Records the enquiry in this browser and returns it ready to be handed to
 * WhatsApp. Nothing leaves the page here: sending happens in the caller, so the
 * customer sees the WhatsApp chat open with the enquiry attached as a PDF.
 */
export const submitEnquiry = async (payload) => {
  const enquiry = sanitizeEnquiry({
    ...payload,
    reference: payload.reference || createReference(),
    createdAt: new Date().toISOString(),
  });
  if (!enquiry) throw new Error('Enquiry details are incomplete.');

  writeStorage(enquirySubmissionStorageKey, [enquiry, ...storedEnquiries()]);
  return enquiry;
};
