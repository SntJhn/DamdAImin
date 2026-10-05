import type { AnalysisLanguage, AnalysisOutcome, EmotionClassification } from '@damdai/contracts';

interface AnalysisLanguagePresentation {
  label: string;
  qualification: 'Research-validated' | 'Experimental';
  qualificationDescription: string;
}

interface AnalysisOutcomePresentation {
  label: string;
  description: string;
}

const languagePresentations: Record<AnalysisLanguage, AnalysisLanguagePresentation> = {
  taglish: {
    label: 'Taglish',
    qualification: 'Research-validated',
    qualificationDescription: 'Validated by the thesis research evidence.',
  },
  english: {
    label: 'English',
    qualification: 'Experimental',
    qualificationDescription: 'Separate research validation evidence is not yet available.',
  },
  tagalog: {
    label: 'Tagalog',
    qualification: 'Experimental',
    qualificationDescription: 'Separate research validation evidence is not yet available.',
  },
};

const outcomePresentations: Record<AnalysisOutcome, AnalysisOutcomePresentation> = {
  definitive: {
    label: 'Definitive Classification',
    description: 'The Research System returned a definitive classification of expressed speech.',
  },
  inconclusive: {
    label: 'Inconclusive Result',
    description:
      'The Research System did not return a sufficiently reliable classification for this speech sample.',
  },
};

const classificationLabels: Record<EmotionClassification, string> = {
  anger: 'Angry',
  happiness: 'Happy',
  neutrality: 'Neutral',
  sadness: 'Sad',
};

const classifications = ['happiness', 'sadness', 'anger', 'neutrality'] as const;
type EmotionScores = Readonly<Record<EmotionClassification, number>>;

export function getLeadingClassifications(scores: EmotionScores): EmotionClassification[] {
  const highest = Math.max(...classifications.map((classification) => scores[classification]));
  return classifications.filter((classification) => scores[classification] === highest);
}

export function describeLayerScores(layer: string, scores: EmotionScores): string {
  const leaders = getLeadingClassifications(scores);
  const probability = formatProbability(scores[leaders[0]]);
  if (leaders.length === classifications.length) {
    return `${layer} gave all four emotions equal scores (${probability} each).`;
  }
  if (leaders.length > 1) {
    const labels = new Intl.ListFormat('en', { type: 'conjunction' }).format(
      leaders.map(formatClassification),
    );
    return `${layer} tied ${labels} at ${probability}.`;
  }
  return `${layer} leaned ${formatClassification(leaders[0])} (${probability}).`;
}

export function describeScoreAdjustment(
  reason: string,
  emotion: EmotionClassification,
  delta: number,
): string {
  const lexicalCue = reason.match(
    /^LEXICAL_[A-Z_]+ detected ['"](.+?)['"] and reported an? (increase|decrease)/i,
  );
  if (lexicalCue) {
    return `The word or phrase “${lexicalCue[1]}” ${lexicalCue[2] === 'increase' ? 'raised' : 'lowered'} the ${formatClassification(emotion)} score.`;
  }
  if (/agreement adjustment was added/i.test(reason)) {
    return `The neural model and supporting rules agreed, which ${delta >= 0 ? 'raised' : 'lowered'} the ${formatClassification(emotion)} score.`;
  }
  return reason;
}

export function getAnalysisLanguagePresentation(
  language: AnalysisLanguage,
): AnalysisLanguagePresentation {
  return languagePresentations[language];
}

export function getAnalysisOutcomePresentation(
  outcome: AnalysisOutcome,
): AnalysisOutcomePresentation {
  return outcomePresentations[outcome];
}

export function formatClassification(classification: EmotionClassification): string {
  return classificationLabels[classification];
}

export function formatProbability(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export function formatProbabilityDistribution(probabilities: readonly number[]): string[] {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  if (total <= 0) {
    return probabilities.map(formatProbability);
  }

  const exactPercentages = probabilities.map((probability) => (probability / total) * 100);
  const roundedPercentages = exactPercentages.map(Math.floor);
  const remainingPoints = 100 - roundedPercentages.reduce((sum, value) => sum + value, 0);
  const remainderOrder = exactPercentages
    .map((value, index) => ({ index, remainder: value - roundedPercentages[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let index = 0; index < remainingPoints; index += 1) {
    roundedPercentages[remainderOrder[index].index] += 1;
  }

  return roundedPercentages.map((percentage) => `${percentage}%`);
}

export function formatScoreDelta(delta: number): string {
  const percentage = Math.round(delta * 100);
  return `${percentage > 0 ? '+' : ''}${percentage}%`;
}
