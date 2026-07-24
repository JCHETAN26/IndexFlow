import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Basic OTel setup logging to console to satisfy the "simple observability" requirement without
// overbuilding massive infrastructure. Spans like retrieval and RAG latency will print here.
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "indexflow-web",
  }),
  traceExporter: new ConsoleSpanExporter(),
});

sdk.start();
