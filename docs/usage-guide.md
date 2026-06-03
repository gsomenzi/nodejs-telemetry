# Guia de Uso

## Setup com NestJS

### Básico (OTLP para Grafana Cloud)

```typescript
import { Module } from '@nestjs/common';
import { TelemetryModule } from '@gsomenzi/nodejs-telemetry';

@Module({
  imports: [
    TelemetryModule.forRoot({
      serviceName: 'order-service',
      environment: 'production',
      exporter: {
        endpoint: 'https://otlp.grafana.net/otlp',
        headers: { Authorization: 'Basic <token>' },
      },
    }),
  ],
})
export class AppModule {}
```

Isso registra automaticamente:
- `OtlpLogExporter` como `LOGGER_PORT`
- `OtlpTraceExporter` como `TRACER_PORT`
- `OtlpMetricsExporter` como `METRICS_PORT`
- Todos como providers globais (disponíveis em qualquer módulo)
- Registra `NodeTracerProvider` e `W3CTraceContextPropagator` globalmente via `@opentelemetry/api`

### Configuração assíncrona (via ConfigService)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemetryModule } from '@gsomenzi/nodejs-telemetry';

@Module({
  imports: [
    TelemetryModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        serviceName: config.getOrThrow('SERVICE_NAME'),
        serviceVersion: config.get('SERVICE_VERSION'),
        environment: config.getOrThrow('NODE_ENV'),
        logLevel: config.get('LOG_LEVEL', 'info'),
        exporter: {
          endpoint: config.getOrThrow('OTLP_ENDPOINT'),
          headers: {
            Authorization: config.getOrThrow('OTLP_AUTH_HEADER'),
          },
          timeout: config.get('OTLP_TIMEOUT', 30000),
          retry: {
            maxAttempts: config.get('RETRY_MAX_ATTEMPTS', 3),
            baseInterval: config.get('RETRY_BASE_INTERVAL', 1000),
            maxInterval: config.get('RETRY_MAX_INTERVAL', 60000),
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Opções de configuração

| Opção | Tipo | Obrigatório | Default | Descrição |
|-------|------|:-----------:|---------|-----------|
| `serviceName` | `string` | ✓ | — | Identifica o serviço nos dados de telemetria |
| `serviceVersion` | `string` | | `"unknown"` | Versão do serviço |
| `environment` | `string` | ✓ | — | Ambiente de execução (production, staging, etc.) |
| `logLevel` | `LogLevel` | | `"info"` | Nível mínimo de log (debug, info, warn, error, fatal) |
| `exporter.endpoint` | `string` | ✓ | — | URL do endpoint OTLP |
| `exporter.headers` | `Record<string, string>` | | — | Headers de autenticação |
| `exporter.protocol` | `'http' \| 'grpc'` | | `"http"` | Protocolo de transporte |
| `exporter.timeout` | `number` | | `30000` | Timeout em ms |
| `exporter.retry.maxAttempts` | `number` | | `3` | Máximo de tentativas |
| `exporter.retry.baseInterval` | `number` | | `1000` | Intervalo base em ms |
| `exporter.retry.maxInterval` | `number` | | `60000` | Intervalo máximo em ms |

---

## Logs Estruturados

### Emitindo logs

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { LoggerPort, LOGGER_PORT } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class OrderService {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  async createOrder(orderId: string, customerId: string, total: number) {
    this.logger.info('Pedido criado', { orderId, customerId, total });
  }

  async processPayment(orderId: string) {
    try {
      await this.chargeCard(orderId);
      this.logger.debug('Pagamento processado', { orderId });
    } catch (error) {
      this.logger.error('Falha no pagamento', {
        orderId,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
```

### Correlação automática

Quando um span está ativo, os logs são automaticamente enriquecidos com `traceId` e `spanId`:

```typescript
const span = tracer.startSpan('processOrder');

// Este log terá traceId e spanId do span ativo
logger.info('Processando pedido', { orderId: '123' });

span.end();
```

O log exportado inclui:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Processando pedido",
  "context": { "orderId": "123" },
  "resource": {
    "service.name": "order-service",
    "service.version": "1.0.0",
    "deployment.environment": "production"
  },
  "correlation": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7"
  }
}
```

### Filtragem por nível

Logs abaixo do nível configurado são descartados silenciosamente:

```typescript
// Com logLevel: 'warn' configurado:
logger.debug('Não será enviado');  // descartado
logger.info('Não será enviado');   // descartado
logger.warn('Será enviado');       // ✓
logger.error('Será enviado');      // ✓
logger.fatal('Será enviado');      // ✓
```

---

## Traces Distribuídos

### Criando spans (API flat)

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { TracerPort, TRACER_PORT } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class PaymentService {
  constructor(@Inject(TRACER_PORT) private readonly tracer: TracerPort) {}

  async processPayment(orderId: string, amount: number) {
    const span = this.tracer.startSpan('processPayment');
    span.setAttribute('orderId', orderId);
    span.setAttribute('amount', amount);

    try {
      const result = await this.gateway.charge(amount);
      span.setAttribute('transactionId', result.id);
      span.setStatus('OK');
      return result;
    } catch (error) {
      span.recordError(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
}
```

### Spans aninhados (propagação automática)

Spans criados dentro do mesmo fluxo async herdam o `traceId` automaticamente:

```typescript
async function handleRequest(order: Order) {
  const span = tracer.startSpan('handleRequest');

  // Este span herda o traceId do parent automaticamente
  await validateOrder(order);

  // Este também
  await processPayment(order);

  span.end();
}

async function validateOrder(order: Order) {
  const span = tracer.startSpan('validateOrder'); // child span
  // ... validação ...
  span.end(); // restaura handleRequest como span ativo
}

async function processPayment(order: Order) {
  const span = tracer.startSpan('processPayment'); // child span
  // ... pagamento ...
  span.end();
}
```

### Adicionando eventos a um span

```typescript
const span = tracer.startSpan('processOrder');

span.addEvent('validation_started');
await validate(order);
span.addEvent('validation_completed', { valid: true });

span.addEvent('payment_started', { amount: order.total });
await charge(order);
span.addEvent('payment_completed', { transactionId: 'tx-123' });

span.end();
```

### Registrando erros

```typescript
const span = tracer.startSpan('riskyOperation');

try {
  await doSomethingRisky();
  span.setStatus('OK');
} catch (error) {
  // Adiciona evento "exception" com detalhes do erro
  // E define status como ERROR automaticamente
  span.recordError(error as Error);
  throw error;
} finally {
  span.end();
}
```

### Span com parent explícito

Útil quando o parent não está no contexto async atual:

```typescript
const parentSpan = tracer.startSpan('batchProcess');
parentSpan.end(); // encerra mas mantém referência

// Mais tarde, em outro contexto:
const childSpan = tracer.startSpan('processItem', {
  parentSpan: parentSpan, // herda traceId do parent
});
childSpan.end();
```

---

## Métricas

### Contadores (Counters)

Para valores que só incrementam:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { MetricsPort, METRICS_PORT } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class OrderMetrics {
  constructor(@Inject(METRICS_PORT) private readonly metrics: MetricsPort) {}

  orderCreated(region: string, paymentMethod: string) {
    this.metrics.incrementCounter('orders_created_total', 1, {
      region,
      payment_method: paymentMethod,
    });
  }

  orderFailed(reason: string) {
    this.metrics.incrementCounter('orders_failed_total', 1, { reason });
  }
}
```

### Histogramas

Para distribuições de valores (latência, tamanhos):

```typescript
recordRequestDuration(durationMs: number, endpoint: string, method: string) {
  this.metrics.recordHistogram('http_request_duration_ms', durationMs, {
    endpoint,
    method,
  });
}

recordPayloadSize(bytes: number, contentType: string) {
  this.metrics.recordHistogram('http_request_size_bytes', bytes, {
    content_type: contentType,
  });
}
```

### Gauges

Para valores que podem subir e descer:

```typescript
setActiveConnections(count: number) {
  this.metrics.recordGauge('active_connections', count);
}

setCpuUsage(percentage: number, host: string) {
  this.metrics.recordGauge('cpu_usage_percent', percentage, { host });
}

setQueueDepth(depth: number, queueName: string) {
  this.metrics.recordGauge('queue_depth', depth, { queue: queueName });
}
```

---

## Interceptor HTTP Automático

### Registrando como interceptor global

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TelemetryModule, TelemetryInterceptor, TracerPort, TRACER_PORT } from '@gsomenzi/nodejs-telemetry';

@Module({
  imports: [
    TelemetryModule.forRoot({
      serviceName: 'order-service',
      environment: 'production',
      exporter: { endpoint: 'https://otlp.grafana.net/otlp' },
    }),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useFactory: (tracer: TracerPort) => new TelemetryInterceptor(tracer),
      inject: [TRACER_PORT],
    },
  ],
})
export class AppModule {}
```

### O que o interceptor faz automaticamente

Para cada requisição HTTP:

1. **Extrai contexto** — Parseia `traceparent`/`tracestate` dos headers de entrada
2. **Cria span** — Child span (se contexto extraído) ou root span
3. **Define atributos** — `http.method`, `http.url`, `http.route`
4. **Isola contexto** — Usa `AsyncLocalStorage` para que spans criados dentro do handler sejam filhos
5. **Na resposta** — Registra `http.status_code`, `http.duration_ms`, define status `OK`
6. **No erro** — Registra erro no span, define status `ERROR`, registra status code
7. **Injeta headers** — Adiciona `traceparent` na resposta para propagação

### Exemplo de trace gerado

```
GET /api/orders/123
├── [TelemetryInterceptor] GET /api/orders/:id (root span)
│   ├── http.method = GET
│   ├── http.url = /api/orders/123
│   ├── http.route = /api/orders/:id
│   ├── http.status_code = 200
│   └── http.duration_ms = 45
│
│   ├── [OrderService] findOrder (child span)
│   │   └── orderId = 123
│   │
│   └── [CacheService] getFromCache (child span)
│       └── cache.hit = true
```

---

## Propagação de Contexto entre Serviços

### Como funciona

Quando o `TelemetryInterceptor` está ativo:

1. **Serviço A** recebe requisição → cria span → processa → injeta `traceparent` na resposta
2. **Serviço A** faz chamada HTTP para **Serviço B** → precisa injetar `traceparent` no request

Para propagar contexto em chamadas de saída, use o `ContextPropagator`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { TracerPort, TRACER_PORT, ContextPropagator } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class HttpClient {
  private readonly propagator = new ContextPropagator();

  constructor(@Inject(TRACER_PORT) private readonly tracer: TracerPort) {}

  async get(url: string): Promise<Response> {
    const span = this.tracer.startSpan(`HTTP GET ${url}`);

    // Injeta headers de propagação
    const activeSpan = this.tracer.getActiveSpan();
    const propagationHeaders = activeSpan
      ? this.propagator.inject({ traceId: activeSpan.traceId, spanId: activeSpan.spanId })
      : {};

    try {
      const response = await fetch(url, {
        headers: { ...propagationHeaders },
      });
      span.setAttribute('http.status_code', response.status);
      span.setStatus('OK');
      return response;
    } catch (error) {
      span.recordError(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
}
```

### Formato dos headers propagados

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: (opcional, vendor-specific)
```

---

## Propagação de Contexto em Eventos/Mensageria

### O problema

Em arquiteturas orientadas a eventos, a trace precisa atravessar brokers de mensagem (Kafka, SQS, RabbitMQ, etc.). Diferente de HTTP, não há um mecanismo padrão de headers — cada broker tem seu próprio conceito de metadata.

### A solução: TelemetryContextHandler

O `TelemetryContextHandler` é um adapter que pode ser plugado em qualquer lib de mensageria que aceite um handler de contexto. Ele injeta/extrai o `traceparent` automaticamente nos metadata dos eventos.

### Setup

```typescript
import { TelemetryFactory, TelemetryContextHandler } from '@gsomenzi/nodejs-telemetry';

const { tracer } = TelemetryFactory.create({
  serviceName: 'order-service',
  environment: 'production',
  exporter: { endpoint: 'https://otlp.grafana.net/otlp' },
});

// Cria o handler de contexto
const contextHandler = new TelemetryContextHandler(tracer);

// Plugar na lib de mensageria
const broker = new MessageBroker({
  contextHandler, // aceita MessageContextHandlerPort
});
```

### Como funciona

```
Serviço A (publish)                    Serviço B (consume)
─────────────────                      ─────────────────
span ativo no contexto                 recebe evento
        │                                      │
        ▼                                      ▼
onPublish(metadata)                    onConsume(metadata, eventName)
        │                                      │
        ▼                                      ▼
injeta traceparent nos metadata        extrai traceId do traceparent
        │                                      │
        ▼                                      ▼
broker envia com metadata              cria span filho com mesmo traceId
                                               │
                                               ▼
                                       handler executa (logs correlacionados)
                                               │
                                               ▼
                                       onConsumeEnd() → span.end()
```

### Exemplo completo: Serviço A publica

```typescript
import { TelemetryFactory, TelemetryContextHandler } from '@gsomenzi/nodejs-telemetry';

const { tracer, logger } = TelemetryFactory.create({ ... });
const contextHandler = new TelemetryContextHandler(tracer);

async function createOrder(orderData: any) {
  const span = tracer.startSpan('create-order');
  span.setAttribute('order.id', orderData.id);

  // O contextHandler.onPublish() é chamado internamente pela lib de mensageria
  // Ele pega o span ativo e injeta traceparent nos metadata automaticamente
  await broker.publish('order.created', orderData);

  logger.info('Pedido criado e evento publicado', { orderId: orderData.id });
  span.end();
}
```

### Exemplo completo: Serviço B consome

```typescript
import { TelemetryFactory, TelemetryContextHandler } from '@gsomenzi/nodejs-telemetry';

const { tracer, logger } = TelemetryFactory.create({ ... });
const contextHandler = new TelemetryContextHandler(tracer);

// A lib de mensageria chama onConsume/onConsumeEnd automaticamente
broker.subscribe('order.created', async (event) => {
  // Span "consume:order.created" já está ativo com traceId propagado
  // Logs emitidos aqui terão correlação automática com a trace original
  logger.info('Processando pedido', { orderId: event.orderId });

  await processPayment(event);

  logger.info('Pagamento processado', { orderId: event.orderId });
});
```

### Interface que a lib de mensageria precisa implementar

A lib de mensageria precisa aceitar um `MessageContextHandlerPort` e chamar os métodos nos momentos certos:

```typescript
// No publish
async publish(topic: string, payload: any, metadata = {}) {
  const enrichedMetadata = this.contextHandler?.onPublish(metadata) ?? metadata;
  await this.broker.send(topic, payload, { headers: enrichedMetadata });
}

// No consume
async handleMessage(event: BrokerMessage) {
  this.contextHandler?.onConsume(event.headers, event.topic);
  try {
    await this.handler(event.payload);
    this.contextHandler?.onConsumeEnd();
  } catch (error) {
    this.contextHandler?.onConsumeEnd(error as Error);
    throw error;
  }
}
```

### Sem dependência direta

A lib de mensageria não precisa depender de `@gsomenzi/nodejs-telemetry`. Basta aceitar qualquer objeto que implemente a interface `MessageContextHandlerPort`. Se nenhum handler for fornecido, a lib funciona normalmente sem telemetria.

---

## Uso Standalone (sem NestJS)

### Setup básico

```typescript
import { TelemetryFactory } from '@gsomenzi/nodejs-telemetry';

const telemetry = TelemetryFactory.create({
  serviceName: 'order-worker',
  serviceVersion: '1.2.0',
  environment: 'production',
  logLevel: 'info',
  exporter: {
    endpoint: 'https://otlp.grafana.net/otlp',
    headers: { Authorization: 'Basic <token>' },
    timeout: 10000,
    retry: { maxAttempts: 5, baseInterval: 2000, maxInterval: 30000 },
  },
});

const { logger, tracer, metrics } = telemetry;
```

### Exemplo completo: Worker

```typescript
import { TelemetryFactory } from '@gsomenzi/nodejs-telemetry';

const { logger, tracer, metrics } = TelemetryFactory.create({
  serviceName: 'order-worker',
  environment: 'production',
  exporter: { endpoint: 'https://otlp.grafana.net/otlp' },
});

async function processJob(job: Job) {
  const span = tracer.startSpan('processJob');
  span.setAttribute('jobId', job.id);
  span.setAttribute('jobType', job.type);

  try {
    logger.info('Processando job', { jobId: job.id, type: job.type });

    await executeJob(job);

    metrics.incrementCounter('jobs_processed', 1, { type: job.type, status: 'success' });
    span.setStatus('OK');
  } catch (error) {
    logger.error('Job falhou', { jobId: job.id, error: (error as Error).message });
    metrics.incrementCounter('jobs_processed', 1, { type: job.type, status: 'error' });
    span.recordError(error as Error);
  } finally {
    span.end();
  }
}

// Shutdown graceful
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await TelemetryFactory.shutdown();
  process.exit(0);
});
```

### Exemplo: Lambda

```typescript
import { TelemetryFactory } from '@gsomenzi/nodejs-telemetry';

const { logger, tracer, metrics } = TelemetryFactory.create({
  serviceName: 'order-lambda',
  environment: process.env.STAGE ?? 'development',
  exporter: {
    endpoint: process.env.OTLP_ENDPOINT!,
    headers: { Authorization: process.env.OTLP_AUTH! },
  },
});

export async function handler(event: APIGatewayEvent) {
  const span = tracer.startSpan('lambda.handler');
  span.setAttribute('http.method', event.httpMethod);
  span.setAttribute('http.path', event.path);

  try {
    const result = await processRequest(event);
    span.setStatus('OK');
    metrics.incrementCounter('lambda_invocations', 1, { status: 'success' });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    span.recordError(error as Error);
    metrics.incrementCounter('lambda_invocations', 1, { status: 'error' });
    return { statusCode: 500, body: 'Internal Server Error' };
  } finally {
    span.end();
    await TelemetryFactory.shutdown(); // flush antes do cold start
  }
}
```

---

## Desabilitando Telemetria

### Com NoopAdapter

Para desabilitar telemetria completamente (ex: testes unitários):

```typescript
import { NoopAdapter } from '@gsomenzi/nodejs-telemetry';

const noop = new NoopAdapter();

// Use como logger, tracer e metrics — tudo é no-op
noop.info('Não faz nada');
const span = noop.startSpan('noop'); // retorna NoopSpan
span.end(); // no-op
noop.incrementCounter('noop'); // no-op
```

### Em testes NestJS

```typescript
import { Test } from '@nestjs/testing';
import { NoopAdapter, LOGGER_PORT, TRACER_PORT, METRICS_PORT } from '@gsomenzi/nodejs-telemetry';

const noop = new NoopAdapter();

const module = await Test.createTestingModule({
  providers: [
    { provide: LOGGER_PORT, useValue: noop },
    { provide: TRACER_PORT, useValue: noop },
    { provide: METRICS_PORT, useValue: noop },
    OrderService,
  ],
}).compile();
```

---

## Tratamento de Erros

### Erros de configuração (fail-fast)

```typescript
import { TelemetryFactory, InvalidConfigurationError } from '@gsomenzi/nodejs-telemetry';

try {
  TelemetryFactory.create({
    serviceName: '', // inválido
    environment: 'production',
    exporter: { endpoint: 'https://otlp.example.com' },
  });
} catch (error) {
  if (error instanceof InvalidConfigurationError) {
    console.error(`Campo: ${error.field}, Motivo: ${error.reason}`);
    // Campo: serviceName, Motivo: required field is missing or empty
  }
}
```

### Erros de export (fail-safe)

Erros durante o envio de telemetria **nunca** propagam para a aplicação:

```typescript
// Mesmo se o endpoint OTLP estiver indisponível:
logger.info('Isso não vai lançar exceção'); // ✓ seguro
tracer.startSpan('safe');                   // ✓ seguro
metrics.incrementCounter('safe');           // ✓ seguro

// Erros são logados internamente via console.error e dados são descartados
```

### Hierarquia de erros

```
Error
└── TelemetryError
    ├── ExporterConnectionError    (falha de conexão)
    ├── ExporterTimeoutError       (timeout)
    ├── InvalidConfigurationError  (config inválida — field, reason)
    └── SpanContextError           (operação inválida em span)
```

---

## Observabilidade

### Logs estruturados gerados

**Log com correlação:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Pedido criado",
  "context": { "orderId": "123", "total": 99.9 },
  "resource": {
    "service.name": "order-service",
    "service.version": "1.0.0",
    "deployment.environment": "production"
  },
  "correlation": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7"
  }
}
```

**Log sem correlação (nenhum span ativo):**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "message": "Cache miss",
  "context": { "key": "user:123" },
  "resource": {
    "service.name": "order-service",
    "service.version": "1.0.0",
    "deployment.environment": "production"
  }
}
```

### Rastreamento por Trace ID

Busque por `traceId` nos logs e traces para ver toda a cadeia de processamento de uma requisição, incluindo spans em múltiplos serviços.

### Métricas com resource attributes

Todas as métricas incluem automaticamente:
- `service.name` — identifica o serviço
- `service.version` — versão do serviço
- `deployment.environment` — ambiente de execução

---

## Configuração do Endpoint OTLP

### Grafana Cloud

```typescript
{
  endpoint: 'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${instanceId}:${apiKey}`).toString('base64'),
  },
}
```

### Datadog

```typescript
{
  endpoint: 'https://http-intake.logs.datadoghq.com/api/v2/otlp',
  headers: {
    'DD-API-KEY': '<your-api-key>',
  },
}
```

### Jaeger (local)

```typescript
{
  endpoint: 'http://localhost:4318',
}
```

### Collector OTLP genérico

```typescript
{
  endpoint: 'http://otel-collector:4318',
  headers: {
    'X-Custom-Header': 'value',
  },
}
```

---

## Variáveis de Ambiente Recomendadas

```bash
# .env
SERVICE_NAME=order-service
SERVICE_VERSION=1.2.0
NODE_ENV=production
LOG_LEVEL=info

# OTLP
OTLP_ENDPOINT=https://otlp-gateway-prod-sa-east-1.grafana.net/otlp
OTLP_AUTH_HEADER=Basic <base64-encoded-credentials>
OTLP_TIMEOUT=30000

# Retry
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_INTERVAL=1000
RETRY_MAX_INTERVAL=60000
```
