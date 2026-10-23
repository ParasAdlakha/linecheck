// The work order a call produces. The agent sends events; applyEvent folds them into one record.
// The record is a draft until a person signs it on the board: LineCheck never returns a part to service.

export function newWorkOrder(id = `WO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`) {
  return {
    id,
    opened_at: new Date().toISOString(),
    status: 'draft',
    aircraft: { tail: '', type: '' },
    component: '',
    ata_chapter: '',
    discrepancy: '',
    findings: [],
    photos: [],
    references: [],
    airworthiness_directives: [],
    known_failures: null,
    proposed_action: '',
    signoff: null,
    timeline: [],
  };
}

const MAX_TIMELINE = 200;

/** Returns a new work order with the event applied. Unknown event types are only logged. */
export function applyEvent(wo, event) {
  const next = structuredClone(wo);
  const at = event.at || new Date().toISOString();
  const p = event.payload || {};
  switch (event.type) {
    case 'call_started':
      next.timeline = [];
      break;
    case 'aircraft':
      next.aircraft = { tail: p.tail ?? next.aircraft.tail, type: p.type ?? next.aircraft.type };
      break;
    case 'inspection':
      if (p.component && !next.component) next.component = p.component;
      for (const f of p.findings || []) next.findings.push({ ...f, at });
      if (p.photo) next.photos.push({ url: p.photo, at });
      break;
    case 'procedure':
      for (const r of p.results || []) {
        if (!next.references.some(x => x.citation === r.citation)) next.references.push({ citation: r.citation, title: r.title, excerpt: r.text.slice(0, 300) });
      }
      break;
    case 'ads':
      for (const r of p.results || []) {
        if (!next.airworthiness_directives.some(x => x.url === r.url)) next.airworthiness_directives.push({ title: r.title, url: r.url });
      }
      break;
    case 'known_failures':
      next.known_failures = { total: p.total_matches, top_conditions: p.top_conditions, sample_data: p.sample_data };
      break;
    case 'draft':
      for (const k of ['component', 'ata_chapter', 'discrepancy', 'proposed_action']) if (p[k]) next[k] = p[k];
      next.status = 'ready_for_signoff';
      break;
    case 'signoff':
      if (!p.name || !p.certificate) throw new Error('Sign-off needs a name and a certificate number');
      next.signoff = { name: p.name, certificate: p.certificate, decision: p.decision || 'accepted', at };
      next.status = 'signed';
      break;
    case 'reset':
      return newWorkOrder();
  }
  next.timeline.push({ at, type: event.type, note: event.note || '' });
  if (next.timeline.length > MAX_TIMELINE) next.timeline.splice(0, next.timeline.length - MAX_TIMELINE);
  return next;
}
