/**
 * Contract for context propagation in messaging/event systems.
 *
 * This interface is meant to be implemented by telemetry adapters and
 * consumed by messaging libraries as a "slot" for trace propagation.
 *
 * The messaging library calls these methods at the right moments:
 * - onPublish: before sending a message (to inject trace context into metadata)
 * - onConsume: when receiving a message (to extract trace context and create a span)
 * - onConsumeEnd: when message processing finishes (to end the span)
 */
export interface MessageContextHandlerPort {
  /**
   * Called before publishing a message.
   * Injects trace propagation headers into the message metadata.
   *
   * @param metadata - Existing message metadata/headers
   * @returns Enriched metadata with trace context headers merged in
   */
  onPublish(metadata: Record<string, string>): Record<string, string>;

  /**
   * Called when a message is received, before the handler executes.
   * Extracts trace context from metadata and creates a child span.
   *
   * @param metadata - Message metadata/headers containing trace context
   * @param eventName - The event/topic name (used as span name)
   */
  onConsume(metadata: Record<string, string>, eventName: string): void;

  /**
   * Called when message processing completes (success or failure).
   * Ends the active span with the appropriate status.
   *
   * @param error - If provided, the span is marked as ERROR with the error recorded
   */
  onConsumeEnd(error?: Error): void;
}
