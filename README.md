# @gsomenzi/nodejs-telemetry

Biblioteca de telemetria para Node.js/NestJS que abstrai a implementação do OpenTelemetry, expondo contratos próprios (ports) e permitindo a troca de plataforma de observabilidade sem alterar o código dos microsserviços.

## O que é

Uma biblioteca de observabilidade que cobre os três pilares — logs estruturados, traces distribuídos e métricas — através de uma arquitetura hexagonal (ports & adapters). Permite enviar dados de telemetria para qualquer plataforma OTLP-compatível (Grafana Cloud, Datadog, New Relic) apenas alterando a configuração.

## Características

- **Framework-independent core** — O núcleo é TypeScript puro, sem dependências de framework
- **Ports & Adapters** — Troque de plataforma de observabilidade sem alterar lógica de negócio
- **API Flat** — Spans com `startSpan`/`span.end()` explícito, sem wrapping de callbacks
- **Propagação implícita** — `AsyncLocalStorage` propaga contexto automaticamente entre operações async
- **Três pilares** — Logs estruturados, traces distribuídos e métricas em uma API unificada
- **W3C Trace Context** — Propagação de contexto entre serviços via `traceparent`/`tracestate`
- **Global TracerProvider** — Registra `NodeTracerProvider` e `W3CTraceContextPropagator` globalmente via `@opentelemetry/api`, garantindo interoperabilidade com qualquer lib que use a API global do OpenTelemetry (ex: `propagation.inject()` funciona corretamente)
- **Correlation automática** — Logs enriquecidos com `traceId`/`spanId` do span ativo
- **Retry + Discard** — Backoff exponencial para erros transitórios, discard com log para permanentes
- **Fail-safe** — Telemetria nunca crasha a aplicação; erros são capturados internamente
- **NestJS ready** — Módulo global com `forRoot`/`forRootAsync` e interceptor automático
- **Logger adapters** — Escolha entre OTLP, stdout ou noop na configuração; ou injete um adaptador customizado
- **Standalone** — `TelemetryFactory` para uso em scripts, workers e lambdas
- **Consistente** — Segue os mesmos padrões hexagonais do `gsomenzi-eventbus`

## Instalação

```bash
# via npm
npm install @gsomenzi/nodejs-telemetry --save

# via yarn
yarn add @gsomenzi/nodejs-telemetry

# via git (direto do repositório)
npm install git+https://github.com/gsomenzi/nodejs-telemetry.git

# yarn via git
yarn add https://github.com/gsomenzi/nodejs-telemetry.git
```

### Peer Dependencies

Para uso com NestJS, instale também:

```bash
npm install @nestjs/common reflect-metadata rxjs
```

## Uso com NestJS

### Configuração básica (forRoot)

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

### Logs no stdout (desenvolvimento)

```typescript
TelemetryModule.forRoot({
  serviceName: 'order-service',
  environment: 'development',
  loggerAdapter: 'console', // 'otlp' | 'console' | 'noop'
  exporter: {
    endpoint: 'https://otlp.grafana.net/otlp', // ainda usado por traces e metrics
    headers: { Authorization: 'Basic <token>' },
  },
});
```

### Adaptador de logger customizado

```typescript
TelemetryModule.forRoot({
  serviceName: 'order-service',
  environment: 'production',
  logger: new MyPinoLoggerAdapter(), // tem precedência sobre loggerAdapter
  exporter: { endpoint: 'https://otlp.grafana.net/otlp' },
});
```

### Com configuração assíncrona (via ConfigService)

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
        loggerAdapter: config.get('NODE_ENV') === 'development' ? 'console' : 'otlp',
        exporter: {
          endpoint: config.getOrThrow('OTLP_ENDPOINT'),
          headers: { Authorization: config.getOrThrow('OTLP_AUTH_HEADER') },
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Emitindo logs

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { LoggerPort, LOGGER_PORT } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class OrderService {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  async createOrder(orderId: string, total: number) {
    this.logger.info('Pedido criado', { orderId, total });
  }
}
```

### Criando traces

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
      const result = await this.chargeCard(amount);
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

### Registrando métricas

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { MetricsPort, METRICS_PORT } from '@gsomenzi/nodejs-telemetry';

@Injectable()
export class OrderMetrics {
  constructor(@Inject(METRICS_PORT) private readonly metrics: MetricsPort) {}

  orderCreated(region: string) {
    this.metrics.incrementCounter('orders_created', 1, { region });
  }

  recordLatency(durationMs: number, endpoint: string) {
    this.metrics.recordHistogram('request_duration_ms', durationMs, { endpoint });
  }

  setActiveConnections(count: number) {
    this.metrics.recordGauge('active_connections', count);
  }
}
```

### Interceptor automático

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TelemetryInterceptor, TracerPort, TRACER_PORT } from '@gsomenzi/nodejs-telemetry';

@Module({
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

O interceptor automaticamente:
- Cria spans para cada requisição HTTP
- Extrai `traceparent`/`tracestate` de requisições de entrada
- Injeta headers de propagação nas respostas
- Registra método, URL, status code e duração no span

## Uso Standalone (sem NestJS)

### Configuração via TelemetryFactory

```typescript
import { TelemetryFactory } from '@gsomenzi/nodejs-telemetry';

const telemetry = TelemetryFactory.create({
  serviceName: 'order-worker',
  environment: 'production',
  loggerAdapter: 'console',
  exporter: {
    endpoint: 'https://otlp.grafana.net/otlp',
    headers: { Authorization: 'Basic <token>' },
  },
});

const { logger, tracer, metrics } = telemetry;
```

### Exemplo completo

```typescript
import { TelemetryFactory } from '@gsomenzi/nodejs-telemetry';

const { logger, tracer, metrics } = TelemetryFactory.create({
  serviceName: 'order-worker',
  environment: 'production',
  exporter: { endpoint: 'https://otlp.grafana.net/otlp' },
});

// Criar um span
const span = tracer.startSpan('processOrder');
span.setAttribute('orderId', '123');

// Logs são automaticamente enriquecidos com traceId/spanId
logger.info('Processando pedido', { orderId: '123' });

// Registrar métricas
metrics.incrementCounter('orders_processed', 1, { status: 'success' });

// Finalizar span
span.end();

// Shutdown graceful antes de encerrar o processo
await TelemetryFactory.shutdown();
```

### Spans aninhados

```typescript
const parentSpan = tracer.startSpan('handleRequest');

// Spans criados dentro do mesmo contexto async herdam o traceId automaticamente
const dbSpan = tracer.startSpan('queryDatabase');
await db.query('SELECT ...');
dbSpan.end(); // restaura parentSpan como ativo

const cacheSpan = tracer.startSpan('updateCache');
await cache.set('key', 'value');
cacheSpan.end();

parentSpan.end();
```

## Configuração

```typescript
interface TelemetryConfig {
  serviceName: string;          // Obrigatório — identifica o serviço
  serviceVersion?: string;      // Default: "unknown"
  environment: string;          // Obrigatório — ex: "production", "staging"
  logLevel?: LogLevel;          // Default: "info" (debug | info | warn | error | fatal)
  loggerAdapter?: LoggerAdapterType; // Default: "otlp" ('otlp' | 'console' | 'noop')
  exporter: {
    endpoint: string;           // Obrigatório — URL do endpoint OTLP
    headers?: Record<string, string>; // Headers de autenticação
    protocol?: 'http' | 'grpc'; // Default: "http"
    timeout?: number;           // Timeout em ms. Default: 30000
    retry?: {
      maxAttempts: number;      // Default: 3 (range 1-10)
      baseInterval: number;     // Default: 1000ms
      maxInterval: number;      // Default: 60000ms
    };
  };
}
```

## Adapters disponíveis

### Logger adapters

| Adapter | `loggerAdapter` | Uso |
|---------|-----------------|-----|
| `OtlpLogExporter` | `'otlp'` (padrão) | Envia logs via OTLP HTTP para qualquer backend compatível |
| `ConsoleLogAdapter` | `'console'` | Saída JSON estruturada em stdout (dev/testes) |
| `NoopLoggerAdapter` | `'noop'` | Descarta logs; traces e metrics continuam ativos |

Use `createLoggerAdapter()` para instanciar programaticamente, ou passe `logger: LoggerPort` no NestJS/`TelemetryFactory` para um adaptador customizado.

### Outros adapters

| Adapter | Uso |
|---------|-----|
| `OtlpTraceExporter` | Envia traces via OTLP HTTP com batching e retry |
| `OtlpMetricsExporter` | Envia métricas via OTLP HTTP com flush periódico |
| `NoopAdapter` | No-op para todos os ports (desabilitar telemetria) |

## Estrutura

```
src/
├── types/              Tipos base (TelemetryConfig, StructuredLog, SpanData, etc.)
├── ports/              Interfaces/contratos (LoggerPort, TracerPort, MetricsPort)
├── errors/             Hierarquia de erros (TelemetryError e subclasses)
├── adapters/           Implementações dos ports
│   ├── otlp-log-exporter.ts
│   ├── otlp-trace-exporter.ts
│   ├── otlp-metrics-exporter.ts
│   ├── console-log-adapter.ts
│   ├── noop-logger-adapter.ts
│   ├── stdout-log-sink.ts
│   ├── noop-adapter.ts
│   ├── context-propagator.ts
│   └── retry-policy.ts
├── telemetry/          Componentes core
│   ├── config-validator.ts
│   ├── context-manager.ts
│   ├── global-tracer-registration.ts  ← Registro global OTel SDK
│   ├── logger-service.ts
│   ├── logger-adapter.factory.ts
│   ├── tracer-service.ts
│   ├── metrics-service.ts
│   ├── span.ts
│   └── telemetry-factory.ts
├── nestjs/             Integração NestJS (módulo + interceptor)
└── index.ts            Barrel export (entry point único)
```

## Exports

Tudo é exportado de um único entry point:

```typescript
import {
  // Ports
  LoggerPort, LOGGER_PORT,
  TracerPort, TRACER_PORT,
  MetricsPort, METRICS_PORT,

  // Factory (standalone)
  TelemetryFactory, createLoggerAdapter,

  // NestJS
  TelemetryModule, TelemetryInterceptor,

  // Adapters
  OtlpLogExporter, OtlpTraceExporter, OtlpMetricsExporter,
  ConsoleLogAdapter, NoopLoggerAdapter, NoopAdapter, StdoutLogSink,
  ContextPropagator, TelemetryContextHandler,

  // Global TracerProvider (OpenTelemetry API interop)
  registerGlobalTracer, shutdownGlobalTracer, isGlobalTracerRegistered,

  // Errors
  TelemetryError, InvalidConfigurationError, ExporterConnectionError,
  ExporterTimeoutError, SpanContextError,

  // Config
  ConfigValidator,
} from '@gsomenzi/nodejs-telemetry';
```

## Hierarquia de Erros

```typescript
TelemetryError                    // Base — estende Error
├── ExporterConnectionError       // Falha de conexão com endpoint
├── ExporterTimeoutError          // Timeout na requisição
├── InvalidConfigurationError     // Config inválida (field, reason)
└── SpanContextError              // Operação inválida em span
```

## Documentação Detalhada

- [Arquitetura](./docs/architecture.md) — Diagramas, componentes e decisões de design
- [API Reference](./docs/api-reference.md) — Interfaces, classes e métodos
- [Guia de Uso](./docs/usage-guide.md) — Exemplos completos e cenários avançados

## Licença

MIT
