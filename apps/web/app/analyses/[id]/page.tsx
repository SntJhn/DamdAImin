import { AnalysisDetailClient } from '../../../components/analysis-detail-client';

export default async function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisDetailClient analysisId={id} />;
}
