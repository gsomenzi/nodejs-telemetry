# API Reference

## Tipos

### `TelemetryConfig`

Configuração principal da biblioteca.

```typescript
interface TelemetryConfig {
  serviceName: string;          // Obrigatório — identifica o serviço
  serviceVersion?: string;      // Default: "unknown"
  environment: string;          // Obrigatório — ex: "production", "staging"
  logLevel?: LogLevel;          // Default: "info"
  exporter: ExporterConfig;
}
```

### `ExporterConfig`

Configuração do exporter OTLP.

```typescript
interface ExporterConfig {
  endpoint: string;                   // Obrigatório — URL do endpoint OTLP
  headers?: Record<string, string>;   // Headers de autenticação
  protocol?: 'http' | 'grpc';        // Default: "http"
  timeout?: number;                   // Timeout em ms. Default: 30000
  retry?: RetryConfig;
}
```

### `RetryConfig`

Configuração da política de retry.

```typescript
interface RetryConfig {
  maxAttempts: number;    // Default: 3 (range 1-10)
  baseInterval: number;   // Default: 1000ms
  maxInterval: number;    // Default: 60000ms (1 min)
}
```

### `LogLevel`

Níveis de log suportados (ordenados por severidade).

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

Severidade: `debug(0) < info(1) < warn(2) < error(3) < fatal(4)`

### `CorrelationContext`

Contexto de correlação propagado entre operações.

```typescript
interface CorrelationContext {
  traceId: string;        // ID do trace (32 hex chars ou UUID)
  spanId: string;         // ID do span (16 hex chars ou UUID)
  traceFlags?: number;    // Flags W3C (ex: 1 = sampled)
  traceState?: string;    // Estado vendor-specific opcional
}
```

### `StructuredLog`

Representação interna de uma entrada de log.

```typescript
interface StructuredLog {
  timestamp: string;                    // ISO 8601 UTC
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  resource: ResourceAttributes;
  correlation?: CorrelationContext;
}
```

### `ResourceAttributes`

Atributos de recurso associados a toda telemetria.

```typescript
interface ResourceAttributes {
  'service.name': string;
  'service.version': string;
  'deployment.environment': string;
}
```

### `SpanData`

Representação interna de um span completado.

```typescript
interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  status: SpanStatus;
  startTime: string;                    // ISO 8601 UTC
  endTime: string;                      // ISO 8601 UTC
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  resource: ResourceAttributes;
}
```

### `SpanEvent`

Evento registrado em um span.

```typescript
interface SpanEvent {
  name: string;
  timestamp: string;                    // ISO 8601 UTC
  attributes?: Record<string, unknown>;
}
```

### `SpanStatus`

Status de um span.

```typescript
type SpanStatus = 'OK' | 'ERROR' | 'UNSET';
```

### `MetricDataPoint`

Ponto de dados de uma métrica.

```typescript
interface MetricDataPoint {
  name: string;
  type: MetricType;
  value: number;
  timestamp: string;                    // ISO 8601 UTC
  attributes?: Record<string, string | number | boolean>;
  resource: ResourceAttributes;
}

type MetricType = 'counter' | 'histogram' | 'gauge';
```

### `SpanOptions`

Opções para criação de um span.

```typescript
interface SpanOptions {
  attributes?: Record<string, string | number | boolean>;
  parentSpan?: SpanPort;
}
```

### `TelemetryInstance`

Resultado de `TelemetryFactory.create()`.

```typescript
interface TelemetryInstance {
  logger: LoggerPort;
  tracer: TracerPort;
  metrics: MetricsPort;
}
```

---

## Ports (Interfaces)

### `LoggerPort`

Interface para emissão de logs estruturados.

```typescript
interface LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
}
```

Token: `LOGGER_PORT`

**Comportamento:**
- Métodos nunca lançam exceção — erros são capturados internamente
- Logs abaixo do nível mínimo configurado são descartados silenciosamente
- Quando um span está ativo, `traceId` e `spanId` são incluídos automaticamente

### `TracerPort`

Interface para criação e gerenciamento de traces distribuídos.

```typescript
interface TracerPort {
  startSpan(name: string, options?: SpanOptions): SpanPort;
  getActiveSpan(): SpanPort | null;
}
```

Token: `TRACER_PORT`

**Comportamento:**
- `startSpan` nunca lança exceção — retorna `NoopSpan` em caso de erro interno
- Se há um span ativo, o novo span herda o `traceId` (child span)
- Se não há span ativo, um novo `traceId` é gerado (root span)
- O novo span é automaticamente definido como span ativo no `ContextManager`

### `SpanPort`

Interface de um span individual.

```typescript
interface SpanPort {
  readonly spanId: string;
  readonly traceId: string;
  readonly name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  recordError(error: Error): void;
  setStatus(status: SpanStatus): void;
  end(): void;
}
```

**Comportamento:**
- `end()` é idempotente — chamadas subsequentes são no-op
- `end()` restaura o span pai como span ativo no `ContextManager`
- Métodos mutáveis (`setAttribute`, `addEvent`, etc.) são no-op após `end()`
- `recordError` adiciona um evento "exception" e define status como `ERROR`

### `MetricsPort`

Interface para registro de métricas.

```typescript
interface MetricsPort {
  incrementCounter(
    name: string,
    value?: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;

  recordHistogram(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;

  recordGauge(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;
}
```

Token: `METRICS_PORT`

**Comportamento:**
- Métodos nunca lançam exceção — erros são capturados internamente
- `incrementCounter` usa valor 1 como default quando `value` não é fornecido
- Resource attributes (`service.name`, `service.version`, `deployment.environment`) são anexados automaticamente

### `ContextPropagatorPort`

Interface para propagação de contexto entre serviços via HTTP headers.

```typescript
interface ContextPropagatorPort {
  extract(headers: Record<string, string | string[] | undefined>): CorrelationContext | null;
  inject(context: CorrelationContext): Record<string, string>;
}
```

**Comportamento:**
- `extract` retorna `null` se o header `traceparent` está ausente ou inválido
- `inject` serializa o contexto no formato W3C Trace Context
- Suporta headers como string ou string[] (usa primeiro elemento)

### `MessageContextHandlerPort`

Interface para propagação de contexto de trace em sistemas de mensageria/eventos. Projetada para ser implementada por adapters de telemetria e consumida por libs de mensageria como um "slot" de propagação.

```typescript
interface MessageContextHandlerPort {
  onPublish(metadata: Record<string, string>): Record<string, string>;
  onConsume(metadata: Record<string, string>, eventName: string): void;
  onConsumeEnd(error?: Error): void;
}
```

**Comportamento:**
- `onPublish` injeta headers de trace (`traceparent`) nos metadata da mensagem a partir do span ativo
- `onConsume` extrai o contexto de trace dos metadata e cria um span filho na mesma trace
- `onConsumeEnd` encerra o span com status `OK` ou `ERROR`
- Se não há span ativo no momento do publish, retorna metadata inalterado
- Se não há contexto propagado no consume, cria uma trace nova

---

## Classes

### `TelemetryFactory`

Factory para uso standalone (sem NestJS). Cria instâncias configuradas de todos os ports.

```typescript
class TelemetryFactory {
  static create(config: TelemetryConfig): TelemetryInstance;
  static shutdown(): Promise<void>;
}
```

#### `create(config)`

1. Valida config via `ConfigValidator` — lança `InvalidConfigurationError` se inválida
2. Cria `OtlpLogExporter`, `OtlpTraceExporter`, `OtlpMetricsExporter` com a config resolvida
3. Retorna `TelemetryInstance` com os três ports prontos para uso

#### `shutdown()`

1. Faz flush de todos os dados pendentes nos exporters
2. Aplica timeout de 5 segundos (best-effort)
3. Nunca lança exceção — erros são capturados internamente
4. Limpa referências internas após conclusão

---

### `ConfigValidator`

Valida e resolve configuração com defaults.

```typescript
class ConfigValidator {
  static validate(config: TelemetryConfig): ResolvedTelemetryConfig;
}
```

#### Defaults aplicados

| Campo | Default |
|-------|---------|
| `serviceVersion` | `"unknown"` |
| `logLevel` | `"info"` |
| `exporter.protocol` | `"http"` |
| `exporter.timeout` | `30000` |
| `exporter.retry.maxAttempts` | `3` |
| `exporter.retry.baseInterval` | `1000` |
| `exporter.retry.maxInterval` | `60000` |

#### Validação

| Campo | Regra |
|-------|-------|
| `serviceName` | String não-vazia (trim) |
| `environment` | String não-vazia (trim) |
| `exporter.endpoint` | String não-vazia (trim) |

Lança `InvalidConfigurationError` com `field` e `reason` quando inválido.

---

### `OtlpLogExporter`

Implementa `LoggerPort`. Envia logs via OTLP HTTP para o endpoint configurado.

```typescript
new OtlpLogExporter(config: ResolvedTelemetryConfig, options?: {
  flushIntervalMs?: number;   // Default: 5000
  maxBatchSize?: number;      // Default: 100
})
```

| Método | Descrição |
|--------|-----------|
| `debug/info/warn/error/fatal(message, context?)` | Emite log estruturado com correlação automática |
| `flush(): Promise<void>` | Força envio dos logs bufferizados |
| `shutdown(): Promise<void>` | Para flush periódico e envia logs pendentes |
| `getBufferSize(): number` | Retorna quantidade de logs no buffer |

**Comportamento:**
- Filtra logs abaixo do nível mínimo configurado
- Enriquece com `traceId`/`spanId` do span ativo via `ContextManager`
- Batch automático com flush periódico (5s) ou quando buffer atinge `maxBatchSize`
- Retry com backoff exponencial em erros de rede
- Após tentativas esgotadas: discard + `console.error`
- Timer é `unref()`'d — não impede encerramento do processo

---

### `OtlpTraceExporter`

Implementa `TracerPort`. Cria spans e exporta via OTLP HTTP.

```typescript
new OtlpTraceExporter(config: ResolvedTelemetryConfig)
```

| Método | Descrição |
|--------|-----------|
| `startSpan(name, options?): SpanPort` | Cria span e define como ativo no contexto |
| `getActiveSpan(): SpanPort \| null` | Retorna span ativo ou null |
| `flush(): Promise<void>` | Força envio dos spans bufferizados |
| `shutdown(): Promise<void>` | Para flush periódico e envia spans pendentes |
| `getSpanBuffer(): SpanData[]` | Retorna spans no buffer (para testes) |

**Comportamento:**
- Quando span.end() é chamado, os dados são bufferizados para export
- Flush periódico a cada 5s ou quando buffer atinge 512 spans
- Inclui `parentSpanId` para spans filhos
- Serializa em formato OTLP JSON com resource attributes
- Retry com backoff exponencial em erros de rede

---

### `OtlpMetricsExporter`

Implementa `MetricsPort`. Registra métricas e exporta via OTLP HTTP.

```typescript
new OtlpMetricsExporter(config: ResolvedTelemetryConfig)
```

| Método | Descrição |
|--------|-----------|
| `incrementCounter(name, value?, attributes?)` | Registra counter |
| `recordHistogram(name, value, attributes?)` | Registra histogram |
| `recordGauge(name, value, attributes?)` | Registra gauge |
| `flush(): Promise<void>` | Força envio das métricas bufferizadas |
| `shutdown(): Promise<void>` | Para flush periódico e envia métricas pendentes |
| `getBufferSize(): number` | Retorna quantidade de métricas no buffer |

**Comportamento:**
- Flush periódico a cada 60s
- Serializa em formato OTLP JSON (sum para counters, histogram, gauge)
- Resource attributes anexados automaticamente
- Não aceita métricas após `shutdown()`

---

### `ConsoleLogAdapter`

Implementa `LoggerPort`. Saída JSON estruturada em stdout para desenvolvimento/testes.

```typescript
new ConsoleLogAdapter()
```

Cada chamada emite uma linha JSON em `process.stdout` com:
- `timestamp` (ISO 8601)
- `level`
- `message`
- `context` (quando fornecido)

---

### `NoopAdapter`

Implementa `LoggerPort`, `TracerPort` e `MetricsPort`. Todos os métodos são no-ops.

```typescript
new NoopAdapter()
```

- `startSpan` retorna um `NoopSpan` (todos os métodos são no-op)
- `getActiveSpan` retorna `null`
- Útil para desabilitar telemetria em testes ou ambientes específicos

---

### `ContextPropagator`

Implementa `ContextPropagatorPort`. Segue a especificação W3C Trace Context.

```typescript
new ContextPropagator()
```

| Método | Descrição |
|--------|-----------|
| `extract(headers)` | Parseia `traceparent`/`tracestate` → `CorrelationContext` ou `null` |
| `inject(context)` | Serializa `CorrelationContext` → headers `traceparent`/`tracestate` |

---

### `TelemetryContextHandler`

Implementa `MessageContextHandlerPort`. Adapter para propagação automática de trace em sistemas de mensageria/eventos.

```typescript
new TelemetryContextHandler(tracer: TracerPort)
```

| Método | Descrição |
|--------|-----------|
| `onPublish(metadata)` | Injeta `traceparent` nos metadata a partir do span ativo no contexto |
| `onConsume(metadata, eventName)` | Extrai contexto e cria span filho `consume:{eventName}` |
| `onConsumeEnd(error?)` | Encerra o span com status OK ou ERROR |

**Comportamento:**
- `onPublish` lê o span ativo via `ContextManager` (AsyncLocalStorage) — se não há span ativo, retorna metadata inalterado
- `onConsume` cria um span com o `traceId` extraído dos metadata, mantendo a trace distribuída
- `onConsumeEnd` é idempotente — chamadas sem span ativo são no-op
- O span criado por `onConsume` é definido como ativo no `ContextManager`, então logs e spans filhos herdam o contexto automaticamente

#### Formato traceparent

```
{version}-{trace-id}-{parent-id}-{trace-flags}
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- `version`: 2 hex chars (atualmente "00")
- `trace-id`: 32 hex chars lowercase
- `parent-id`: 16 hex chars lowercase
- `trace-flags`: 2 hex chars (01 = sampled)

#### Conversão UUID ↔ W3C

- `inject`: remove hyphens do UUID para gerar hex puro
- `extract`: armazena hex puro (sem hyphens) no `CorrelationContext`

---

### `TelemetryModule` (NestJS)

Módulo global que registra todos os providers de telemetria.

```typescript
@Global()
@Module({})
class TelemetryModule {
  static forRoot(options: TelemetryModuleOptions): DynamicModule;
  static forRootAsync(options: TelemetryModuleAsyncOptions): DynamicModule;
}
```

#### `TelemetryModuleOptions`

```typescript
interface TelemetryModuleOptions {
  serviceName: string;
  serviceVersion?: string;
  environment: string;
  logLevel?: LogLevel;
  exporter: ExporterConfig;
}
```

#### `TelemetryModuleAsyncOptions`

```typescript
interface TelemetryModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
  inject?: any[];
}
```

**Comportamento:**
- `forRoot` valida config, cria exporters OTLP, registra como providers globais
- `forRootAsync` resolve config via factory antes de criar exporters
- Registra `LOGGER_PORT`, `TRACER_PORT`, `METRICS_PORT` como tokens de injeção
- Módulo `@Global()` — ports disponíveis em todos os módulos sem re-importação

---

### `TelemetryInterceptor` (NestJS)

Interceptor que cria spans automaticamente para requisições HTTP.

```typescript
@Injectable()
class TelemetryInterceptor implements NestInterceptor {
  constructor(tracer: TracerPort);
  intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}
```

**Comportamento:**
- Extrai `traceparent`/`tracestate` de headers de entrada
- Cria child span (se contexto extraído) ou root span
- Define atributos: `http.method`, `http.url`, `http.route`, `http.status_code`, `http.duration_ms`
- Injeta headers de propagação na resposta
- Em caso de erro: registra erro no span, define status `ERROR`
- Usa `contextManager.run()` para isolar contexto por requisição

---

## Retry Policy

### Funções exportadas

```typescript
function calculateDelay(attempt: number, config: RetryConfig): number;
function shouldRetry(attempt: number, config: RetryConfig): boolean;
function isRetryableError(error: unknown): boolean;
function executeWithRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T | undefined>;
```

#### `calculateDelay`

Fórmula: `min(baseInterval * 2^(attempt-1), maxInterval)`

| Tentativa | Delay (config padrão) |
|-----------|----------------------|
| 1 | 1000ms |
| 2 | 2000ms |
| 3 | 4000ms |
| 4 | 8000ms |
| ... | capped em 60000ms |

#### `isRetryableError`

| Condição | Resultado |
|----------|-----------|
| `error.code === 'ECONNREFUSED'` | Retryable ✓ |
| `error.code === 'ETIMEDOUT'` | Retryable ✓ |
| `error.code === 'ECONNRESET'` | Retryable ✓ |
| `error.code === 'ENOTFOUND'` | Retryable ✓ |
| Qualquer outro erro | Não retryable ✗ |

#### `executeWithRetry`

1. Executa a função
2. Se sucesso → retorna resultado
3. Se erro retryable e `shouldRetry` → aguarda delay, tenta novamente
4. Se erro não-retryable ou tentativas esgotadas → `console.error` + retorna `undefined`

---

## Erros

Todos estendem `TelemetryError` (que estende `Error`).

| Classe | Quando é lançado | Campos extras |
|--------|-----------------|---------------|
| `TelemetryError` | Base — não lançado diretamente | `cause?: Error` |
| `ExporterConnectionError` | Falha de conexão com endpoint OTLP | `cause?: Error` |
| `ExporterTimeoutError` | Timeout na requisição OTLP | `cause?: Error` |
| `InvalidConfigurationError` | Config inválida no `TelemetryFactory.create()` ou `TelemetryModule.forRoot()` | `field: string`, `reason: string` |
| `SpanContextError` | Operação inválida em span (uso interno) | `cause?: Error` |

### Exemplo de tratamento

```typescript
import { TelemetryFactory, InvalidConfigurationError } from '@gsomenzi/nodejs-telemetry';

try {
  const telemetry = TelemetryFactory.create(config);
} catch (error) {
  if (error instanceof InvalidConfigurationError) {
    console.error(`Campo inválido: ${error.field} — ${error.reason}`);
  }
}
```
