import type { EventName, PlatformEvent } from "@pm/contracts";
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

/**
 * Event Bus em memória — desacoplamento, não distribuição (sem Redis/broker).
 * Componentes publicam eventos; assinantes (Métricas, Knowledge) reagem, em vez
 * de serem chamados diretamente. Facilita a evolução: adicionar um assinante
 * não toca em quem publica.
 *
 * Síncrono por design (processo único): a publicação retorna após todos os
 * handlers rodarem, o que mantém a ordem determinística para o modo replay.
 * Um handler que lança não derruba os demais.
 */

export type EventHandler = (event: PlatformEvent) => void;

export class EventBus {
  private readonly handlers = new Map<EventName | "*", Set<EventHandler>>();

  /** Assina um evento específico. Retorna função para cancelar a assinatura. */
  on(name: EventName, handler: EventHandler): () => void {
    return this.addHandler(name, handler);
  }

  /** Assina todos os eventos (ex.: coletor de métricas, auditoria). */
  onAny(handler: EventHandler): () => void {
    return this.addHandler("*", handler);
  }

  publish(event: PlatformEvent): void {
    // Garante eventId para idempotência/persistência (EventLog).
    const enriched: PlatformEvent = event.eventId
      ? event
      : { ...event, eventId: `evt_${randomUUID().slice(0, 12)}` };

    const specific = this.handlers.get(enriched.name);
    const wildcard = this.handlers.get("*");
    for (const set of [specific, wildcard]) {
      if (!set) continue;
      for (const handler of set) {
        try {
          handler(enriched);
        } catch (err) {
          log.warn(`Handler de evento falhou (${enriched.name})`, err);
        }
      }
    }
  }

  private addHandler(key: EventName | "*", handler: EventHandler): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }
}
