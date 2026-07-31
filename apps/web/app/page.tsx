import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="landing-page">
      <div className="landing-copy">
        <p className="eyebrow">DamdAImin / private speech research</p>
        <h1>Read the signal. Keep the record.</h1>
        <p>
          A verified account keeps each Analysis Record attached to the person who created it. Start
          with an empty History and make it yours.
        </p>
        <div className="landing-actions">
          <Link className="primary-button" href="/auth/sign-up">
            Create an account
          </Link>
          <Link className="secondary-button" href="/auth/sign-in">
            Sign in
          </Link>
        </div>
      </div>
      <div className="landing-signal" aria-hidden="true">
        <span className="landing-signal-line" />
        <span className="landing-signal-dot landing-signal-dot-one" />
        <span className="landing-signal-dot landing-signal-dot-two" />
        <span className="landing-signal-label">verified / owned / explainable</span>
      </div>
    </main>
  );
}
