import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

type ProcessStep = {
  title: string;
  description: string;
  asset: string;
  assetAlt: string;
};

type FrameworkStep = {
  title: string;
  description: string;
  number: string;
  asset: string;
};

const processSteps: ProcessStep[] = [
  {
    title: 'Record or Upload Audio',
    description: 'Submit a Taglish speech recording for analysis.',
    asset: '/landing/record.svg',
    assetAlt: 'Recording and WAV upload illustration',
  },
  {
    title: 'Generate Transcript',
    description: 'Convert spoken words into text transcription.',
    asset: '/landing/transcript.svg',
    assetAlt: 'Speech transcript illustration',
  },
  {
    title: 'Analyze Emotional Cue',
    description: 'Evaluate both vocal and linguistic patterns.',
    asset: '/landing/waveform.svg',
    assetAlt: 'Audio waveform illustration',
  },
  {
    title: 'Detect Emotion',
    description: 'Classify the speech as Happy, Sad, Angry, or Neutral.',
    asset: '/landing/emotion.svg',
    assetAlt: 'Emotion classification illustration',
  },
  {
    title: 'View Explainable Results',
    description: 'Explore confidence scores and the factors behind the prediction.',
    asset: '/landing/explain.svg',
    assetAlt: 'Explainable result illustration',
  },
];

const frameworkSteps: FrameworkStep[] = [
  {
    title: 'The Neural Analysis',
    description:
      "The CNN-ABLSTM model analyzes acoustic features such as pitch, energy, and speech patterns to identify emotional cues in the speaker's voice.",
    number: '1',
    asset: '/landing/neural.svg',
  },
  {
    title: 'Symbolic Reasoning',
    description:
      'The transcribed speech is examined using symbolic rules to detect emotion-related words, expressions, and contextual patterns in Taglish communication.',
    number: '2',
    asset: '/landing/symbolic.svg',
  },
  {
    title: 'Emotion Prediction',
    description:
      'The neural and symbolic outputs are combined to generate the final emotion prediction, confidence score, and explanation of the detected emotion.',
    number: '3',
    asset: '/landing/prediction.svg',
  },
];

function Logo() {
  return (
    <Link className="thesis-brand" href="/" aria-label="DamdAImin home">
      <span>Damd</span>
      <span className="thesis-brand-accent">AI</span>
      <span>min</span>
      <img src="/landing/brand-mark.svg" alt="" aria-hidden="true" />
    </Link>
  );
}

function ProcessCard({ step }: { step: ProcessStep }) {
  return (
    <article className="thesis-process-card">
      <div className="thesis-process-copy">
        <h3>{step.title}</h3>
        <p>{step.description}</p>
      </div>
      <div className="thesis-process-art">
        <img src={step.asset} alt={step.assetAlt} loading="lazy" />
      </div>
    </article>
  );
}

function FrameworkStep({ step }: { step: FrameworkStep }) {
  return (
    <article className="thesis-framework-step">
      <span className="thesis-framework-number" aria-hidden="true">
        {step.number}
      </span>
      <div className="thesis-framework-step-copy">
        <h3>{step.title}</h3>
        <p>{step.description}</p>
      </div>
    </article>
  );
}

export default function HomePage() {
  return (
    <main className="thesis-landing">
      <header className="thesis-header">
        <Logo />
        <nav className="thesis-nav" aria-label="Account">
          <Link
            className="thesis-button thesis-button-primary thesis-button-small"
            href="/auth/sign-up"
          >
            Sign Up
          </Link>
          <Link
            className="thesis-button thesis-button-dark thesis-button-small"
            href="/auth/sign-in"
          >
            Log In
          </Link>
        </nav>
      </header>

      <section className="thesis-hero" aria-labelledby="hero-title">
        <img
          className="thesis-hero-texture"
          src="/landing/hero-texture.svg"
          alt=""
          aria-hidden="true"
        />
        <div className="thesis-hero-content">
          <div className="thesis-pills" aria-label="Product type">
            <span className="thesis-pill thesis-pill-primary">TSERA</span>
            <span className="thesis-pill">AI-Powered Tool</span>
          </div>
          <h1 id="hero-title">Hear Beyond Speech</h1>
          <p>
            An AI-powered tool that analyzes Taglish speech to identify emotions and explain the
            reasoning behind its predictions.
          </p>
          <div className="thesis-hero-actions">
            <a className="thesis-button thesis-button-outline" href="#how-it-works">
              Learn How it Works
            </a>
            <Link
              className="thesis-button thesis-button-primary thesis-button-large"
              href="/auth/sign-up"
            >
              Start Analysis
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          </div>
          <div className="thesis-marquee" aria-label="DamdAImin capabilities">
            <div className="thesis-marquee-track">
              {[0, 1].map((group) => (
                <span className="thesis-marquee-group" key={group} aria-hidden={group === 1}>
                  <span>Taglish Speech Analysis</span>✦<span>Emotion Classification</span>✦
                  <span>Neuro-Symbolic AI</span>✦<span>Explainable AI</span>✦
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="thesis-process" id="how-it-works" aria-labelledby="process-title">
        <div className="thesis-section-intro">
          <h2 id="process-title">How DamdAImin Analyzes Emotion</h2>
          <p>
            Discover how DamdAImin transforms Taglish speech into explainable emotion insights using
            a multimodal neuro-symbolic approach that combines acoustic and linguistic analysis.
          </p>
        </div>
        <div className="thesis-process-grid">
          {processSteps.map((step) => (
            <ProcessCard key={step.title} step={step} />
          ))}
        </div>
      </section>

      <section className="thesis-framework" aria-labelledby="framework-title">
        <div className="thesis-framework-content">
          <div className="thesis-section-intro">
            <h2 id="framework-title">Our Neurosymbolic Framework</h2>
            <p>
              Follow the journey of a speech recording as it is processed, analyzed, and transformed
              into an explainable emotion prediction.
            </p>
          </div>
          <div className="thesis-framework-stage">
            <div className="thesis-framework-visual" aria-hidden="true">
              <img className="thesis-framework-line" src="/landing/framework-line.png" alt="" />
              {frameworkSteps.map((step, index) => (
                <span className={`thesis-framework-marker marker-${index + 1}`} key={step.number}>
                  <img src={step.asset} alt="" loading="lazy" />
                </span>
              ))}
            </div>
            <div className="thesis-framework-grid">
              {frameworkSteps.map((step) => (
                <FrameworkStep key={step.title} step={step} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
