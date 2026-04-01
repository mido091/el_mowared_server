const trimText = (value) => `${value ?? ''}`.trim();

export function parseRfqItemsInput(input) {
  if (Array.isArray(input)) return input;

  if (typeof input === 'string') {
    const normalized = input.trim();
    if (!normalized) return [];

    try {
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function normalizeRfqItems(items) {
  return parseRfqItemsInput(items)
    .map((item, index) => ({
      label: trimText(item?.label),
      details: trimText(item?.details),
      order: Number(item?.order) > 0 ? Number(item.order) : index + 1
    }))
    .filter((item) => item.label && item.details)
    .map((item, index) => ({
      ...item,
      order: index + 1
    }));
}

export function buildRfqTitle(items) {
  const normalizedItems = normalizeRfqItems(items);
  if (!normalizedItems.length) return 'RFQ';

  const [firstItem, ...restItems] = normalizedItems;
  if (!restItems.length) return firstItem.label;

  return `${firstItem.label} +${restItems.length}`;
}

export function buildLegacyDescription(items) {
  const normalizedItems = normalizeRfqItems(items);
  if (!normalizedItems.length) return null;

  return normalizedItems
    .map((item) => `${item.label}: ${item.details}`)
    .join('\n\n');
}

export function buildFallbackRfqItems(record) {
  const label = trimText(record?.title) || 'RFQ';
  const details = trimText(record?.description);

  if (!label && !details) return [];

  return [
    {
      label: label || 'RFQ',
      details: details || label || 'RFQ',
      order: 1
    }
  ];
}

export function hydrateRfqRecord(record) {
  if (!record || typeof record !== 'object') return record;

  const parsedItems = normalizeRfqItems(record.rfq_items);
  return {
    ...record,
    rfq_items: parsedItems.length ? parsedItems : buildFallbackRfqItems(record)
  };
}

export function hydrateRfqRecords(records) {
  return Array.isArray(records) ? records.map(hydrateRfqRecord) : [];
}
