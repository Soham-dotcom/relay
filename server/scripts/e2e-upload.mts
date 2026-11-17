// Manual end-to-end check against a running server with real AI:
//   npx tsx scripts/e2e-upload.mts [baseUrl]
// Uploads a generated multi-section PDF whose key fact sits near the end, then asks about it.
import { makePdf } from '../test/fixtures.js';

const base = process.argv[2] ?? 'http://localhost:4000/api';
const people = await (await fetch(`${base}/auth/people`)).json();
const priya = people.find((p: { name: string }) => p.name.startsWith('Priya'));
const { token } = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: priya.id }) })).json();
const auth = { authorization: `Bearer ${token}` };

const lines: string[] = ['Payments Vendor Agreement - Razorpay (summary for the team)'];
for (let s = 1; s <= 14; s++) lines.push(`Section ${s}. Standard terms about invoicing, data handling and support hours, reviewed by legal in September.`);
lines.push('Section 15. Termination: either side may end the agreement with 60 days written notice.');
lines.push('Section 16. Settlement: funds from UPI autopay payments settle to our account on T+2 working days.');
const pdf = makePdf(lines);

const form = new FormData();
form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'Razorpay_vendor_agreement.pdf');
form.append('visibility', 'ORG');
let t = Date.now();
const up = await (await fetch(`${base}/knowledge/upload`, { method: 'POST', headers: auth, body: form })).json();
console.log('upload', Date.now() - t, 'ms', JSON.stringify(up));

for (const question of ['How long does Razorpay take to settle UPI autopay funds?', 'How much notice is needed to end the Razorpay agreement?']) {
  t = Date.now();
  const r = await (await fetch(`${base}/ask`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ question }) })).json();
  console.log(`\nQ: ${question}\nA (${r.mode}, ${Date.now() - t} ms): ${r.answer ?? '-'}\n   cites: ${r.citations.map((c: { title: string; fileName?: string }) => c.fileName ?? c.title).join('; ')}`);
}
