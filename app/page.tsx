import Link from 'next/link';

const cards = [
  {
    href: '/kb',
    title: 'Knowledge Base',
    body: 'Upload past RFPs, SIG/CAIQ workbooks, and policy xlsx. These become the grounded source of truth for every draft.',
  },
  {
    href: '/fill',
    title: 'Fill a new RFP',
    body: 'Upload a blank vendor questionnaire. We detect its structure, draft answers against the KB, and hand you a filled xlsx.',
  },
  {
    href: '/ask',
    title: 'Ask a question',
    body: 'Quick one-off lookup. Drop a single question in and get a grounded draft with citations — useful during live calls.',
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Draft RFP responses, grounded in your own answers.
        </h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Upload past responses once. When the next questionnaire arrives, this
          tool fills it out using only what you&apos;ve already said — with
          confidence labels and citations so a sales rep can review before
          sending.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block rounded-lg border border-stone-200 bg-white p-6 transition hover:border-stone-400 hover:shadow-sm"
          >
            <h2 className="text-lg font-medium">{card.title}</h2>
            <p className="mt-2 text-sm text-stone-600">{card.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
