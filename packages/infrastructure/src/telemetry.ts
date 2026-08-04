import { metrics, trace, type Attributes, type Meter, type Tracer } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

import type { AnalysisTelemetry, AnalysisTelemetryEvent } from '@damdai/application';

export interface AnalysisTelemetryProviders {
  tracer: Tracer;
  meter: Meter;
}

export interface StartedObservability {
  telemetry: AnalysisTelemetry;
  shutdown(): Promise<void>;
}

export function createAnalysisTelemetry(
  providers: AnalysisTelemetryProviders = {
    tracer: trace.getTracer('damdai.analysis'),
    meter: metrics.getMeter('damdai.analysis'),
  },
): AnalysisTelemetry {
  const events = providers.meter.createCounter('damdai.analysis.events', {
    description: 'Analysis lifecycle events by safe correlation metadata',
  });

  return {
    record(event) {
      const attributes = toTelemetryAttributes(event);
      events.add(1, attributes);
      const span = providers.tracer.startSpan(event.name, { attributes });
      span.end();
    },
  };
}

export function toTelemetryAttributes(event: AnalysisTelemetryEvent): Attributes {
  return {
    'damdai.analysis.id': event.analysisId,
    'damdai.analysis.stage': event.stage,
    'damdai.analysis.language': event.language,
    'damdai.contract.version': event.contractVersion,
    ...(event.requestId ? { 'http.request.id': event.requestId } : {}),
    ...(event.jobId ? { 'messaging.job.id': event.jobId } : {}),
  };
}

export function startObservability(options: {
  serviceName: string;
  endpoint?: string;
}): StartedObservability {
  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  let sdk: NodeSDK | undefined;

  if (endpoint) {
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    sdk = new NodeSDK({
      serviceName: options.serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${normalizedEndpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${normalizedEndpoint}/v1/metrics` }),
        exportIntervalMillis: 10_000,
      }),
    });
    sdk.start();
  }

  return {
    telemetry: createAnalysisTelemetry(),
    async shutdown() {
      if (sdk) await sdk.shutdown();
    },
  };
}
